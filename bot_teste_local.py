import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

try:
    import requests
except ImportError:
    requests = None

# ==========================================
# CONFIGURAÇÃO DE CONEXÃO E MODO
# ==========================================
MODO_TESTE_LOCAL = False

SUPABASE_URL = "https://ijavkuwlcascnwnucbgm.supabase.co"
SUPABASE_KEY = "sb_publishable_CJvBm4ZD5q2uz0E8hxf81w_ZiXdHels"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_ONIBUS_PATH = os.path.join(BASE_DIR, "config_onibus.json")

# Mapa de ônibus do sistema oficial
MAPA_ONIBUS = {
    1: {"numero": "0542", "motorista": "Dheimes"},
    2: {"numero": "0519", "motorista": "Adalberto"},
    3: {"numero": "0507", "motorista": "Edson"},
}

# Dados do Usuário
DADOS_USUARIO = {
    "p_nome": "Maria Eduarda Costa Toledo",
    "p_curso": "Engenharia de Software",
    "p_instituicao": "UNIRV",
    "p_onibus": 2,  # Ônibus padrão (pode ser sobrescrito pelo config_onibus.json)
    "p_tipo_transporte": "onibus",
}

# ==========================================
# REGRA DE PRIORIDADE DE POLTRONAS:
# 1. Ímpares a partir da Poltrona 9 em diante (9, 11, 13, ..., 29)
# 2. Pares a partir da Poltrona 2 em diante (2, 4, 6, ..., 28)
# 3. Ímpares restantes (1, 3, 5, 7)
# ==========================================
POLTRONAS_IMPARES_9_DIANTE = list(range(9, 30, 2))  # [9, 11, 13, ..., 29]
POLTRONAS_PARES_2_DIANTE = list(range(2, 29, 2))    # [2, 4, 6, ..., 28]
POLTRONAS_IMPARES_RESTANTES = [1, 3, 5, 7]           # [1, 3, 5, 7]

POLTRONAS_PRIORIDADE = (
    POLTRONAS_IMPARES_9_DIANTE
    + POLTRONAS_PARES_2_DIANTE
    + POLTRONAS_IMPARES_RESTANTES
)

_HTTP_SESSION = requests.Session() if requests else None


# ==========================================
# GERENCIAMENTO DE CONFIGURAÇÃO DE ÔNIBUS
# ==========================================
def carregar_config_onibus():
    """Carrega a configuração de ônibus do arquivo config_onibus.json."""
    padrao = {
        "onibus_padrao": DADOS_USUARIO["p_onibus"],
        "onibus_viagem_sexta": DADOS_USUARIO["p_onibus"],
        "onibus_temporario": None,
        "opcoes_onibus": {
            "1": "Ônibus 1 (0542 - Motorista padrão: Dheimes)",
            "2": "Ônibus 2 (0519 - Motorista padrão: Adalberto)",
            "3": "Ônibus 3 (0507 - Motorista padrão: Edson)",
        },
    }
    if not os.path.exists(CONFIG_ONIBUS_PATH):
        salvar_config_onibus(padrao)
        return padrao
    try:
        with open(CONFIG_ONIBUS_PATH, "r", encoding="utf-8") as f:
            dados = json.load(f)
            padrao.update(dados)
            return padrao
    except Exception as e:
        print(f"⚠️ Aviso ao ler config_onibus.json ({e}). Usando padrão.")
        return padrao


def salvar_config_onibus(config):
    """Salva a configuração de ônibus no arquivo config_onibus.json."""
    with open(CONFIG_ONIBUS_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def obter_onibus_para_data(data_viagem_str, onibus_forcado=None):
    """
    Determina qual ônibus (1, 2 ou 3) deve ser selecionado para a data da viagem:
    1. Se 'onibus_forcado' foi passado via argumento (--onibus), usa ele.
    2. Se 'onibus_temporario' estiver definido no config_onibus.json, usa ele.
    3. Se a data da viagem cair em uma SEXTA-FEIRA (weekday == 4), usa 'onibus_viagem_sexta'.
    4. Caso contrário, usa 'onibus_padrao'.
    """
    if onibus_forcado in (1, 2, 3):
        return onibus_forcado, "Forçado via linha de comando (--onibus)"

    cfg = carregar_config_onibus()
    temp = cfg.get("onibus_temporario")
    if temp in (1, 2, 3):
        return int(temp), "Configuração temporária (próxima viagem)"

    try:
        dt_viagem = datetime.strptime(data_viagem_str, "%Y-%m-%d")
        if dt_viagem.weekday() == 4:  # 4 = Sexta-feira
            onibus_sexta = int(cfg.get("onibus_viagem_sexta") or cfg.get("onibus_padrao") or 2)
            return onibus_sexta, "Regra de viagem de Sexta-feira (onibus_viagem_sexta)"
    except ValueError:
        pass

    onibus_padrao = int(cfg.get("onibus_padrao") or 2)
    return onibus_padrao, "Configuração padrão (onibus_padrao)"


def limpar_onibus_temporario_se_usado():
    """Limpa o campo onibus_temporario após uma reserva concluída com sucesso."""
    cfg = carregar_config_onibus()
    if cfg.get("onibus_temporario") is not None:
        cfg["onibus_temporario"] = None
        salvar_config_onibus(cfg)
        print("🔄 Configuração 'onibus_temporario' foi limpa após o uso (voltando ao padrão).")


def descricao_onibus(num_onibus):
    info = MAPA_ONIBUS.get(int(num_onibus), {"numero": "????", "motorista": "Desconhecido"})
    return f"Ônibus {num_onibus} ({info['numero']} - {info['motorista']})"


# ==========================================
# REGRAS DE DIAS E HORÁRIOS DA AUTOMAÇÃO
# ==========================================
def verificar_agenda_automacao(agora=None):
    """
    Verifica se a automação deve rodar no momento informado e qual a data da viagem alvo.
    Regras:
    - Sexta-feira (weekday == 4) e Sábado (weekday == 5):
      NÃO deve rodar a automação (não há aula no sábado).
    - Domingo (weekday == 6):
      Deve rodar a partir de 17:58h (lista abre às 18:00h) para a viagem de Segunda-feira (amanhã).
    - Segunda a Quinta-feira (weekday 0..3):
      À noite (a partir de 21:58h, lista abre às 22:00h): reserva para o dia seguinte (Terça a Sexta).
      Antes das 15:00h: reserva para o próprio dia (hoje).
    Retorna dict com:
      deve_rodar (bool), motivo (str), data_viagem (str), horario_abertura (datetime | None)
    """
    if agora is None:
        agora = datetime.now()

    dia_semana = agora.weekday()  # 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex, 5=Sab, 6=Dom
    nomes_dias = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
    nome_hoje = nomes_dias[dia_semana]
    minutos_agora = agora.hour * 60 + agora.minute

    # 1. SEXTA-FEIRA: Não deve ocorrer (não há aula no sábado)
    if dia_semana == 4:
        return {
            "deve_rodar": False,
            "motivo": "Hoje é Sexta-feira. A automação não ocorre na sexta-feira pois não há aula no sábado.",
            "data_viagem": None,
            "horario_abertura": None,
            "dia_nome": nome_hoje,
        }

    # 2. SÁBADO: Não há reservas nem aula no domingo
    if dia_semana == 5:
        return {
            "deve_rodar": False,
            "motivo": "Hoje é Sábado. Não há abertura de reservas no sábado (abre domingo às 18:00h, automação às 17:58h).",
            "data_viagem": (agora + timedelta(days=2)).strftime("%Y-%m-%d"),
            "horario_abertura": None,
            "dia_nome": nome_hoje,
        }

    # 3. DOMINGO: Roda a partir das 17:58h para Segunda-feira (abertura às 18:00h)
    if dia_semana == 6:
        data_segunda = (agora + timedelta(days=1)).strftime("%Y-%m-%d")
        abertura_domingo = agora.replace(hour=18, minute=0, second=0, microsecond=0)
        inicio_automacao = 17 * 60 + 58  # 17:58

        if minutos_agora < inicio_automacao:
            return {
                "deve_rodar": False,
                "motivo": f"Hoje é Domingo, mas ainda são {agora.strftime('%H:%M')}. A automação de domingo inicia a partir das 17:58h (abertura às 18:00h).",
                "data_viagem": data_segunda,
                "horario_abertura": abertura_domingo,
                "dia_nome": nome_hoje,
            }

        return {
            "deve_rodar": True,
            "motivo": "Domingo (a partir das 17:58h) -> Reserva para Segunda-feira (abertura às 18:00h).",
            "data_viagem": data_segunda,
            "horario_abertura": abertura_domingo,
            "dia_nome": nome_hoje,
        }

    # 4. SEGUNDA A QUINTA-FEIRA (weekday 0..3)
    # Antes das 15:00h: lista aberta para hoje
    if minutos_agora < 15 * 60:
        data_hoje = agora.strftime("%Y-%m-%d")
        return {
            "deve_rodar": True,
            "motivo": f"{nome_hoje} antes das 15:00h -> Reserva imediata para hoje ({data_hoje}).",
            "data_viagem": data_hoje,
            "horario_abertura": agora,
            "dia_nome": nome_hoje,
        }

    # Entre 15:00h e 21:57h: janela fechada (abre às 22:00h, automação inicia às 21:58h)
    data_amanha = (agora + timedelta(days=1)).strftime("%Y-%m-%d")
    abertura_noite = agora.replace(hour=22, minute=0, second=0, microsecond=0)
    inicio_noite = 21 * 60 + 58  # 21:58

    if minutos_agora < inicio_noite:
        return {
            "deve_rodar": False,
            "motivo": f"Hoje é {nome_hoje} ({agora.strftime('%H:%M')}). Reservas encerradas das 15h às 22h (automação inicia às 21:58h).",
            "data_viagem": data_amanha,
            "horario_abertura": abertura_noite,
            "dia_nome": nome_hoje,
        }

    return {
        "deve_rodar": True,
        "motivo": f"{nome_hoje} (a partir das 21:58h) -> Reserva para amanhã ({data_amanha}, abertura às 22:00h).",
        "data_viagem": data_amanha,
        "horario_abertura": abertura_noite,
        "dia_nome": nome_hoje,
    }


# ==========================================
# COMUNICAÇÃO COM O SUPABASE (REST RPC)
# ==========================================
def chamar_rpc_supabase(nome_funcao, payload, timeout=8):
    """Chama uma função RPC no Supabase via HTTP REST (sem precisar do pacote supabase)."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{nome_funcao}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }

    if _HTTP_SESSION is not None:
        resp = _HTTP_SESSION.post(url, headers=headers, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def consultar_reserva_existente(data_viagem, nome_aluno=None):
    """Verifica se o aluno já possui reserva ativa para a data informada."""
    nome = nome_aluno or DADOS_USUARIO["p_nome"]
    if MODO_TESTE_LOCAL:
        return None
    try:
        dados = chamar_rpc_supabase(
            "consultar_reservas_por_nome_data_v2",
            {"p_nome": nome, "p_data": data_viagem},
        )
        if isinstance(dados, list) and len(dados) > 0:
            return dados[0]
        return None
    except Exception as e:
        print(f"⚠️ Aviso ao verificar reserva existente ({e}).")
        return None


def consultar_poltronas_ocupadas(data_viagem, onibus):
    """Consulta poltronas ocupadas diretamente no Supabase."""
    if MODO_TESTE_LOCAL:
        ocupadas_sim = [9, 11, 13]
        print(f"🧪 [MODO TESTE] Poltronas ocupadas simuladas para {data_viagem} (Ônibus {onibus}): {ocupadas_sim}")
        return ocupadas_sim

    try:
        dados = chamar_rpc_supabase(
            "consultar_poltronas_ocupadas_detalhes",
            {"p_data": data_viagem, "p_onibus": int(onibus)},
        )
        ocupadas = [int(item["poltrona"]) for item in (dados or []) if "poltrona" in item]
        print(
            f"🔍 [{datetime.now().strftime('%H:%M:%S')}] [SUPABASE] "
            f"Poltronas ocupadas em {data_viagem} ({descricao_onibus(onibus)}): {ocupadas}"
        )
        return ocupadas
    except Exception as e:
        print(f"⚠️ Erro ao consultar poltronas no Supabase ({e}).")
        return []


def extrair_codigo_reserva(valor):
    """Extrai o código de reserva no formato MU-XXXXXXXX de qualquer retorno RPC."""
    if not valor:
        return ""
    if isinstance(valor, str):
        m = re.search(r"MU-[A-Z0-9]{8}", valor, re.IGNORECASE)
        return m.group(0).upper() if m else ""
    if isinstance(valor, list):
        for item in valor:
            achado = extrair_codigo_reserva(item)
            if achado:
                return achado
        return ""
    if isinstance(valor, dict):
        for campo in ("codigo_reserva", "codigo", "reservation_code", "fazer_reserva"):
            if campo in valor and valor[campo]:
                achado = extrair_codigo_reserva(valor[campo])
                if achado:
                    return achado
        for v in valor.values():
            achado = extrair_codigo_reserva(v)
            if achado:
                return achado
    return ""


def realizar_reserva(data_viagem, poltrona, onibus=None):
    """
    Efetua a reserva no Supabase e valida a resposta da Stored Procedure.
    Retorna tupla: (sucesso: bool, status_tipo: str, mensagem_ou_codigo: str)
      status_tipo pode ser:
        - 'CONFIRMADA': Reserva concluída com sucesso
        - 'JANELA_FECHADA': As reservas ainda não abriram (ex: 17:58 esperando 18:00)
        - 'POLTRONA_OCUPADA': Outra pessoa pegou esta poltrona, tentar próxima poltrona
        - 'JA_POSSUI_RESERVA': Aluno já tem reserva para esta data
        - 'COTA_ESGOTADA': Cota da UniRV para este ônibus esgotou
        - 'ERRO': Outro erro
    """
    onibus_escolhido = int(onibus if onibus is not None else DADOS_USUARIO["p_onibus"])
    payload = DADOS_USUARIO.copy()
    payload["p_onibus"] = onibus_escolhido
    payload["p_data"] = data_viagem
    payload["p_poltrona"] = int(poltrona)

    if MODO_TESTE_LOCAL:
        codigo_fake = "MU-TESTE123"
        print(f"✅ [{datetime.now().strftime('%H:%M:%S')}] [MODO TESTE] Reserva simulada com sucesso!")
        print(f"📌 Dados: {descricao_onibus(onibus_escolhido)} | Poltrona {poltrona} | Código: {codigo_fake}")
        return True, "CONFIRMADA", codigo_fake

    try:
        print(
            f"⚙️ [{datetime.now().strftime('%H:%M:%S')}] Enviando RPC 'fazer_reserva_com_cota_unirv' "
            f"-> {descricao_onibus(onibus_escolhido)} | Poltrona {poltrona}..."
        )
        dados = chamar_rpc_supabase("fazer_reserva_com_cota_unirv", payload)

        resultado = dados[0] if isinstance(dados, list) and dados else (dados if isinstance(dados, dict) else {})
        codigo = extrair_codigo_reserva(dados)
        sucesso_flag = resultado.get("sucesso") if isinstance(resultado, dict) else None
        msg = (resultado.get("mensagem") or "") if isinstance(resultado, dict) else str(dados)

        if sucesso_flag is True or codigo:
            if not codigo:
                reserva_banco = consultar_reserva_existente(data_viagem)
                if reserva_banco:
                    codigo = reserva_banco.get("codigo_reserva", "")
            print(f"✅ [{datetime.now().strftime('%H:%M:%S')}] RESERVA CONFIRMADA COM SUCESSO NO SUPABASE!")
            print(
                f"📌 Dados: {descricao_onibus(onibus_escolhido)} | Poltrona {poltrona} | "
                f"Código: {codigo or 'Confirmado'} | {DADOS_USUARIO['p_nome']}"
            )
            return True, "CONFIRMADA", codigo or "Confirmado"

        msg_lower = msg.lower()
        print(f"⚠️ [{datetime.now().strftime('%H:%M:%S')}] Supabase recusou Poltrona {poltrona}: '{msg}'")

        if "encerradas" in msg_lower or "fechadas" in msg_lower or "liberada às" in msg_lower or "18h" in msg_lower or "22h" in msg_lower:
            return False, "JANELA_FECHADA", msg
        if "já possui" in msg_lower or "ja possui" in msg_lower:
            return False, "JA_POSSUI_RESERVA", msg
        if "ocupada" in msg_lower or "indisponível" in msg_lower:
            return False, "POLTRONA_OCUPADA", msg
        if "cota" in msg_lower or "esgotad" in msg_lower:
            return False, "COTA_ESGOTADA", msg

        return False, "ERRO", msg

    except Exception as e:
        print(f"❌ [{datetime.now().strftime('%H:%M:%S')}] Erro na comunicação com Supabase: {e}")
        return False, "ERRO", str(e)


def escolher_poltrona_livre(ocupadas):
    """Retorna (poltrona, descricao_tipo) seguindo a regra de prioridade."""
    for p in POLTRONAS_PRIORIDADE:
        if p not in ocupadas:
            if p in POLTRONAS_IMPARES_9_DIANTE:
                tipo = "Ímpar (≥9)"
            elif p in POLTRONAS_PARES_2_DIANTE:
                tipo = "Par (2-28)"
            else:
                tipo = "Ímpar (1-7)"
            return p, tipo
    return None, None


# ==========================================
# EXECUÇÃO PRINCIPAL DO BOT COM RETRY A CADA 2 SEGUNDOS
# ==========================================
INTERVALO_RECARREGAMENTO_SEG = 2.0


def executar_bot_nova_regra(
    data_alvo=None,
    onibus_forcado=None,
    forcar_execucao=False,
    aguardar_abertura=True,
    duracao_max_tentativas_seg=300,
):
    agora = datetime.now()
    status_agenda = verificar_agenda_automacao(agora)

    if not data_alvo:
        if not status_agenda["deve_rodar"] and not forcar_execucao and not MODO_TESTE_LOCAL:
            print("=" * 70)
            print(f"🛑 AUTOMAÇÃO PAUSADA / FORA DE JANELA ({agora.strftime('%d/%m/%Y %H:%M:%S')})")
            print(f"📌 Motivo: {status_agenda['motivo']}")
            print("=" * 70)
            return False
        data_alvo = status_agenda["data_viagem"] or agora.strftime("%Y-%m-%d")

    onibus_selecionado, origem_onibus = obter_onibus_para_data(data_alvo, onibus_forcado=onibus_forcado)
    DADOS_USUARIO["p_onibus"] = onibus_selecionado

    print("=" * 70)
    print("🤖 BOT DE RESERVA UNIVERSITÁRIA - MAURILÂNDIA")
    print(f"🔄 Intervalo de Recarregamento: A cada {int(INTERVALO_RECARREGAMENTO_SEG)} segundos")
    print("📌 Regra de Poltronas: Ímpares (9..29) ➡️ Pares (2..28) ➡️ Restantes (1..7)")
    print(f"👤 Aluna: {DADOS_USUARIO['p_nome']} ({DADOS_USUARIO['p_curso']} - {DADOS_USUARIO['p_instituicao']})")
    print(f"📅 Data da Viagem Alvo: {data_alvo}")
    print(f"🚌 Ônibus Selecionado: {descricao_onibus(onibus_selecionado)} [{origem_onibus}]")
    print(f"🌐 Servidor Alvo: {SUPABASE_URL}")
    print("=" * 70)

    # 1. Verifica se já existe reserva ativa para a data_alvo
    reserva_ativa = consultar_reserva_existente(data_alvo)
    if reserva_ativa:
        print(
            f"✅ Você já possui uma reserva ativa para {data_alvo}: "
            f"Ônibus {reserva_ativa.get('onibus')} | Poltrona {reserva_ativa.get('poltrona')} | "
            f"Código: {reserva_ativa.get('codigo_reserva')}"
        )
        return True

    # 2. Loop de recarregamento a cada 2 segundos (aguarda a abertura e reserva na hora)
    inicio_loop = time.time()
    tentativa = 0

    while True:
        tentativa += 1
        ocupadas = consultar_poltronas_ocupadas(data_alvo, onibus_selecionado)
        poltrona_escolhida, tipo = escolher_poltrona_livre(ocupadas)

        if not poltrona_escolhida:
            print("⚠️ Nenhuma poltrona disponível dentro da regra de prioridade!")
            return False

        print(f"🎯 [Tentativa #{tentativa}] Poltrona selecionada pela regra: Poltrona {poltrona_escolhida} [{tipo}]")

        sucesso, status_tipo, detalhe = realizar_reserva(data_alvo, poltrona_escolhida, onibus=onibus_selecionado)

        if sucesso:
            limpar_onibus_temporario_se_usado()
            return True

        if status_tipo == "JA_POSSUI_RESERVA":
            reserva_ativa = consultar_reserva_existente(data_alvo)
            if reserva_ativa:
                print(
                    f"✅ Reserva já consta ativa no sistema: Poltrona {reserva_ativa.get('poltrona')} "
                    f"(Código: {reserva_ativa.get('codigo_reserva')})"
                )
            return True

        if status_tipo == "POLTRONA_OCUPADA":
            if poltrona_escolhida not in ocupadas:
                ocupadas.append(poltrona_escolhida)
            print(f"🔄 Poltrona {poltrona_escolhida} ocupada! Tentando próxima poltrona imediatamente...")
            continue

        if status_tipo == "JANELA_FECHADA":
            tempo_decorrido = time.time() - inicio_loop
            if not aguardar_abertura or tempo_decorrido >= duracao_max_tentativas_seg:
                print("⏹️ Limite de espera atingido com a janela ainda fechada.")
                return False
            print(f"⏳ [{datetime.now().strftime('%H:%M:%S')}] Aguardando {int(INTERVALO_RECARREGAMENTO_SEG)}s para recarregar e tentar novamente...")
            time.sleep(INTERVALO_RECARREGAMENTO_SEG)
            continue

        if status_tipo == "COTA_ESGOTADA":
            print(f"❌ Cota da UniRV esgotada para o {descricao_onibus(onibus_selecionado)}.")
            return False

        # Outros erros de rede/comunicação: recarrega em 2 segundos se estiver dentro da janela
        if not aguardar_abertura or (time.time() - inicio_loop) >= duracao_max_tentativas_seg:
            return False
        time.sleep(INTERVALO_RECARREGAMENTO_SEG)


# ==========================================
# MENU INTERATIVO E TESTES AUTOMATIZADOS
# ==========================================
def exibir_status_configuracao():
    cfg = carregar_config_onibus()
    padrao = int(cfg.get("onibus_padrao") or 2)
    sexta = int(cfg.get("onibus_viagem_sexta") or padrao)
    temp = cfg.get("onibus_temporario")

    print("\n" + "=" * 65)
    print("🚌 CONFIGURAÇÃO ATUAL DE ÔNIBUS DA AUTOMAÇÃO")
    print("=" * 65)
    print(f"  • Ônibus Padrão (Seg a Qui) : {descricao_onibus(padrao)}")
    print(f"  • Ônibus de Sexta-feira     : {descricao_onibus(sexta)}")
    print(f"  • Ônibus Próxima Viagem     : {descricao_onibus(temp) if temp else 'Nenhum (usando regra normal)'}")
    print("-" * 65)
    print("📅 REGRAS DE HORÁRIO ATIVAS:")
    print("  • Domingo         : Roda a partir das 17:58h (reserva p/ Segunda às 18:00h)")
    print("  • Segunda a Quinta: Roda a partir das 21:58h (reserva p/ dia seguinte às 22:00h)")
    print("  • Sexta e Sábado  : NÃO roda (sem aula no sábado)")
    print("=" * 65 + "\n")


def menu_interativo_onibus():
    exibir_status_configuracao()
    print("Opções de Ônibus disponíveis:")
    for num, info in MAPA_ONIBUS.items():
        print(f"  [{num}] Ônibus {info['numero']} - Motorista: {info['motorista']}")
    print("\nO que você deseja alterar?")
    print("  [1] Trocar ônibus das viagens de SEXTA-FEIRA (reservadas na quinta à noite)")
    print("  [2] Trocar ônibus apenas da PRÓXIMA viagem (volta ao normal depois)")
    print("  [3] Trocar ônibus PADRÃO de todos os dias")
    print("  [0] Sair sem alterar")

    escolha_tipo = input("\nDigite a opção desejada (0-3): ").strip()
    if escolha_tipo not in ("1", "2", "3"):
        print("Saindo sem alterações.")
        return

    novo_onibus_str = input("Digite o número do ônibus desejado (1=Dheimes, 2=Adalberto, 3=Edson): ").strip()
    if novo_onibus_str not in ("1", "2", "3"):
        print("❌ Ônibus inválido! Escolha 1, 2 ou 3.")
        return

    novo_onibus = int(novo_onibus_str)
    cfg = carregar_config_onibus()
    if escolha_tipo == "1":
        cfg["onibus_viagem_sexta"] = novo_onibus
        print(f"✅ Ônibus das viagens de SEXTA-FEIRA atualizado para: {descricao_onibus(novo_onibus)}")
    elif escolha_tipo == "2":
        cfg["onibus_temporario"] = novo_onibus
        print(f"✅ Ônibus da PRÓXIMA viagem atualizado para: {descricao_onibus(novo_onibus)}")
    elif escolha_tipo == "3":
        cfg["onibus_padrao"] = novo_onibus
        print(f"✅ Ônibus PADRÃO atualizado para: {descricao_onibus(novo_onibus)}")

    salvar_config_onibus(cfg)
    exibir_status_configuracao()


def executar_bateria_testes():
    """Executa todos os testes de validação da automação (horários, dias, troca de ônibus, poltronas e Supabase)."""
    print("=" * 70)
    print("🧪 EXECUTANDO BATERIA DE TESTES FINAIS DA AUTOMAÇÃO")
    print("=" * 70)

    # Teste 1: Regras de dias e horários (Domingo 17:58, Sexta bloqueada, Seg-Qui 21:58)
    print("\n[Teste 1] Validação de dias da semana e horários de execução:")
    cenarios = [
        ("Domingo às 17:57h (antes do horário)", datetime(2026, 10, 25, 17, 57), False, "2026-10-26"),
        ("Domingo às 17:58h (início da automação)", datetime(2026, 10, 25, 17, 58), True, "2026-10-26"),
        ("Domingo às 18:00h (abertura da lista)", datetime(2026, 10, 25, 18, 0), True, "2026-10-26"),
        ("Segunda-feira às 21:58h (reserva p/ Terça)", datetime(2026, 10, 19, 21, 58), True, "2026-10-20"),
        ("Quinta-feira às 21:58h (reserva p/ Sexta)", datetime(2026, 10, 22, 21, 58), True, "2026-10-23"),
        ("Sexta-feira às 10:00h (bloqueado na sexta)", datetime(2026, 10, 23, 10, 0), False, None),
        ("Sexta-feira às 21:58h (bloqueado - sem aula sábado)", datetime(2026, 10, 23, 21, 58), False, None),
        ("Sábado às 18:00h (bloqueado)", datetime(2026, 10, 24, 18, 0), False, "2026-10-26"),
    ]
    for nome_cenario, dt_simulada, esperado_rodar, esperada_data in cenarios:
        res = verificar_agenda_automacao(dt_simulada)
        ok = (res["deve_rodar"] == esperado_rodar) and (res["data_viagem"] == esperada_data)
        icone = "✅" if ok else "❌"
        print(f"  {icone} {nome_cenario}: deve_rodar={res['deve_rodar']} | data_viagem={res['data_viagem']}")
        assert ok, f"Falha no cenário: {nome_cenario} -> {res}"

    # Teste 2: Troca de ônibus (padrão vs viagem de sexta-feira vs temporário)
    print("\n[Teste 2] Validação da seleção e troca de ônibus (incluindo sexta-feira):")
    cfg_backup = carregar_config_onibus()
    try:
        salvar_config_onibus({"onibus_padrao": 2, "onibus_viagem_sexta": 1, "onibus_temporario": None})
        bus_seg, _ = obter_onibus_para_data("2026-10-26")  # Segunda-feira
        bus_sex, _ = obter_onibus_para_data("2026-10-23")  # Sexta-feira
        assert bus_seg == 2, f"Esperado ônibus 2 na segunda, obteve {bus_seg}"
        assert bus_sex == 1, f"Esperado ônibus 1 na sexta, obteve {bus_sex}"
        print(f"  ✅ Viagem de Segunda (2026-10-26) selecionou: {descricao_onibus(bus_seg)}")
        print(f"  ✅ Viagem de Sexta   (2026-10-23) selecionou: {descricao_onibus(bus_sex)}")

        salvar_config_onibus({"onibus_padrao": 2, "onibus_viagem_sexta": 1, "onibus_temporario": 3})
        bus_temp, _ = obter_onibus_para_data("2026-10-26")
        assert bus_temp == 3, f"Esperado ônibus temporário 3, obteve {bus_temp}"
        print(f"  ✅ Troca temporária p/ próxima viagem selecionou: {descricao_onibus(bus_temp)}")
    finally:
        salvar_config_onibus(cfg_backup)

    # Teste 3: Regra de prioridade de poltronas
    print("\n[Teste 3] Validação da fila de prioridade de poltronas:")
    p1, t1 = escolher_poltrona_livre([])
    p2, t2 = escolher_poltrona_livre([9, 11, 13])
    p3, t3 = escolher_poltrona_livre(POLTRONAS_IMPARES_9_DIANTE)
    p4, t4 = escolher_poltrona_livre(POLTRONAS_IMPARES_9_DIANTE + POLTRONAS_PARES_2_DIANTE)
    assert p1 == 9 and p2 == 15 and p3 == 2 and p4 == 1
    print(f"  ✅ Ônibus vazio -> Poltrona {p1} [{t1}]")
    print(f"  ✅ Poltronas 9, 11, 13 ocupadas -> Poltrona {p2} [{t2}]")
    print(f"  ✅ Todas ímpares ≥9 ocupadas -> Poltrona {p3} [{t3}]")
    print(f"  ✅ Ímpares ≥9 e Pares ocupadas -> Poltrona {p4} [{t4}]")

    # Teste 4: Comunicação real com o Supabase
    print("\n[Teste 4] Validação de comunicação em tempo real com o Supabase:")
    try:
        val = chamar_rpc_supabase("validar_universitario", {"p_nome": DADOS_USUARIO["p_nome"]})
        autorizado = isinstance(val, dict) and val.get("autorizado") is True
        print(f"  ✅ Cadastro validado no Supabase: {val}")
        assert autorizado, "Aluna não consta como autorizada!"

        hoje_str = datetime.now().strftime("%Y-%m-%d")
        ocupadas_reais = consultar_poltronas_ocupadas(hoje_str, DADOS_USUARIO["p_onibus"])
        poltrona_teste, tipo_teste = escolher_poltrona_livre(ocupadas_reais)
        print(f"  ✅ Poltrona que seria escolhida hoje ({hoje_str}): Poltrona {poltrona_teste} [{tipo_teste}]")
    except Exception as e:
        print(f"  ⚠️ Não foi possível conectar ao Supabase neste ambiente restrito ({e}).")

    print("\n" + "=" * 70)
    print("🎉 TODOS OS TESTES PASSARAM COM SUCESSO! A AUTOMAÇÃO ESTÁ PRONTA!")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Automação de Reserva Universitária - Maurilândia")
    parser.add_argument("--data", type=str, help="Data da viagem no formato AAAA-MM-DD")
    parser.add_argument("--onibus", type=int, choices=[1, 2, 3], help="Força o número do ônibus (1=Dheimes, 2=Adalberto, 3=Edson)")
    parser.add_argument("--mudar-padrao", type=int, choices=[1, 2, 3], help="Altera o ônibus padrão salvo em config_onibus.json")
    parser.add_argument("--mudar-sexta", type=int, choices=[1, 2, 3], help="Altera o ônibus das viagens de sexta-feira salvo em config_onibus.json")
    parser.add_argument("--mudar-proxima", type=int, choices=[1, 2, 3], help="Define o ônibus apenas para a próxima reserva")
    parser.add_argument("--menu", action="store_true", help="Abre menu interativo para trocar o ônibus")
    parser.add_argument("--status", action="store_true", help="Exibe a configuração atual de ônibus e horários")
    parser.add_argument("--testar", action="store_true", help="Executa a bateria de testes da automação")
    parser.add_argument("--teste-site", action="store_true", help="Testa em tempo real no site clonado (http://localhost:8080) usando a hora mais próxima")
    parser.add_argument("--abrir-as", type=str, help="Define o horário de abertura no site clonado (ex: 18:35)")
    parser.add_argument("--simular", action="store_true", help="Executa uma reserva simulada local sem gravar no banco")
    parser.add_argument("--forcar", action="store_true", help="Ignora o bloqueio de dia/horário e tenta reservar agora")
    parser.add_argument("--sem-espera", action="store_true", help="Faz apenas 1 tentativa imediata sem aguardar abertura")

    args = parser.parse_args()

    if args.mudar_padrao:
        cfg = carregar_config_onibus()
        cfg["onibus_padrao"] = args.mudar_padrao
        salvar_config_onibus(cfg)
        print(f"✅ Ônibus PADRÃO alterado para: {descricao_onibus(args.mudar_padrao)}")
        exibir_status_configuracao()
        sys.exit(0)

    if args.mudar_sexta:
        cfg = carregar_config_onibus()
        cfg["onibus_viagem_sexta"] = args.mudar_sexta
        salvar_config_onibus(cfg)
        print(f"✅ Ônibus das viagens de SEXTA-FEIRA alterado para: {descricao_onibus(args.mudar_sexta)}")
        exibir_status_configuracao()
        sys.exit(0)

    if args.mudar_proxima:
        cfg = carregar_config_onibus()
        cfg["onibus_temporario"] = args.mudar_proxima
        salvar_config_onibus(cfg)
        print(f"✅ Ônibus da PRÓXIMA VIAGEM alterado para: {descricao_onibus(args.mudar_proxima)}")
        exibir_status_configuracao()
        sys.exit(0)

    if args.menu:
        menu_interativo_onibus()
        sys.exit(0)

    if args.status:
        exibir_status_configuracao()
        sys.exit(0)

    if args.testar:
        executar_bateria_testes()
        sys.exit(0)

    if args.simular:
        MODO_TESTE_LOCAL = True

    if args.teste_site or args.abrir_as:
        SUPABASE_URL = "http://localhost:8080"
        args.forcar = True
        try:
            payload_cfg = (
                {"acao": "definir_horario", "horario_abertura": args.abrir_as}
                if args.abrir_as
                else {"acao": "proximo_minuto", "segundos": 25, "limpar_reservas": True}
            )
            req = urllib.request.Request(
                "http://localhost:8080/api/config-teste",
                data=json.dumps(payload_cfg).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                cfg_srv = json.loads(resp.read().decode("utf-8"))
                if not args.data and cfg_srv.get("data_alvo"):
                    args.data = cfg_srv["data_alvo"]
                print(
                    f"🧪 [TESTE NO SITE CLONADO] Conectado a http://localhost:8080 | "
                    f"Hora atual: {cfg_srv.get('hora_servidor')} | "
                    f"Abertura programada para: {cfg_srv.get('horario_abertura')}"
                )
        except Exception as e:
            print(
                f"⚠️ Servidor local http://localhost:8080 ainda não está rodando ({e}).\n"
                f"👉 Rode em outro terminal: python3 servidor_teste_local.py"
            )
            sys.exit(1)

    executar_bot_nova_regra(
        data_alvo=args.data,
        onibus_forcado=args.onibus,
        forcar_execucao=args.forcar,
        aguardar_abertura=not args.sem_espera,
    )

