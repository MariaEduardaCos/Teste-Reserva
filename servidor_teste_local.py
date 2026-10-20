import json
import os
import random
import string
import time
import urllib.request
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    import requests
except ImportError:
    requests = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ESTADO_TESTE_PATH = os.path.join(BASE_DIR, "estado_teste_local.json")
CONFIG_ONIBUS_PATH = os.path.join(BASE_DIR, "config_onibus.json")

SUPABASE_REAL_URL = "https://ijavkuwlcascnwnucbgm.supabase.co"
SUPABASE_KEY = "sb_publishable_CJvBm4ZD5q2uz0E8hxf81w_ZiXdHels"

_SESSION = requests.Session() if requests else None
_CACHE_SUPABASE = {}


def obter_proximo_horario_abertura(segundos_minimos=30):
    """Calcula a hora:minuto mais próxima no futuro para testar sem esperar."""
    agora = datetime.now()
    alvo = agora + timedelta(seconds=segundos_minimos)
    if alvo.minute == agora.minute:
        alvo = alvo + timedelta(minutes=1)
    return alvo.strftime("%H:%M")


def calcular_data_viagem_padrao():
    agora = datetime.now()
    if agora.weekday() == 5:  # Sábado -> Segunda
        return (agora + timedelta(days=2)).strftime("%Y-%m-%d")
    if agora.weekday() == 6 or agora.hour >= 15:
        return (agora + timedelta(days=1)).strftime("%Y-%m-%d")
    return agora.strftime("%Y-%m-%d")


def carregar_estado_teste():
    padrao = {
        "ativo": True,
        "horario_abertura": obter_proximo_horario_abertura(40),
        "data_alvo": calcular_data_viagem_padrao(),
        "reservas_locais": [],
    }
    if not os.path.exists(ESTADO_TESTE_PATH):
        salvar_estado_teste(padrao)
        return padrao
    try:
        with open(ESTADO_TESTE_PATH, "r", encoding="utf-8") as f:
            dados = json.load(f)
            padrao.update(dados)
            return padrao
    except Exception:
        return padrao


def salvar_estado_teste(estado):
    with open(ESTADO_TESTE_PATH, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False, indent=2)


def carregar_config_onibus():
    if os.path.exists(CONFIG_ONIBUS_PATH):
        try:
            with open(CONFIG_ONIBUS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"onibus_padrao": 2, "onibus_viagem_sexta": 2, "onibus_temporario": None}


def salvar_config_onibus(cfg):
    with open(CONFIG_ONIBUS_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def janela_teste_aberta(horario_abertura_str):
    """Retorna True se a hora atual (HH:MM) já atingiu o horário de abertura configurado."""
    agora_str = datetime.now().strftime("%H:%M")
    return agora_str >= horario_abertura_str


def chamar_supabase_real(fn_name, payload, cache_ttl=15):
    """Chama o Supabase real com cache leve para respostas rápidas a cada 2s."""
    chave_cache = f"{fn_name}:{json.dumps(payload, sort_keys=True)}"
    agora_ts = time.time()
    if cache_ttl > 0 and chave_cache in _CACHE_SUPABASE:
        ts_salvo, dados_salvos = _CACHE_SUPABASE[chave_cache]
        if agora_ts - ts_salvo < cache_ttl:
            return dados_salvos

    url = f"{SUPABASE_REAL_URL}/rest/v1/rpc/{fn_name}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    try:
        if _SESSION is not None:
            r = _SESSION.post(url, headers=headers, json=payload, timeout=5)
            r.raise_for_status()
            dados = r.json()
        else:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                dados = json.loads(resp.read().decode("utf-8"))
        if cache_ttl > 0:
            _CACHE_SUPABASE[chave_cache] = (agora_ts, dados)
        return dados
    except Exception as e:
        print(f"⚠️ [Proxy] Fallback local para {fn_name} ({e})")
        if chave_cache in _CACHE_SUPABASE:
            return _CACHE_SUPABASE[chave_cache][1]
        return None


def obter_poltronas_combinadas(p_data, p_onibus):
    """Combina as poltronas reais do Supabase com as reservas feitas no teste local."""
    reais = chamar_supabase_real(
        "consultar_poltronas_ocupadas_detalhes",
        {"p_data": p_data, "p_onibus": int(p_onibus)},
        cache_ttl=15,
    )
    if not isinstance(reais, list):
        # Fallback caso sem internet: simula algumas poltronas ocupadas
        reais = [
            {"poltrona": 9, "nome": "Gabriel Aparecido"},
            {"poltrona": 11, "nome": "Anna Júlia"},
        ]

    estado = carregar_estado_teste()
    mapa = {int(item["poltrona"]): item for item in reais if "poltrona" in item}
    for r in estado.get("reservas_locais", []):
        if r.get("data_viagem") == p_data and int(r.get("onibus") or 0) == int(p_onibus):
            mapa[int(r["poltrona"])] = {
                "poltrona": int(r["poltrona"]),
                "nome": r.get("nome", ""),
            }
    return [mapa[k] for k in sorted(mapa.keys())]


class ServidorTesteHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        # Silencia logs estáticos repetitivos para manter o terminal limpo
        caminho = getattr(self, "path", "")
        if caminho.startswith("/api/config-teste") or caminho.endswith(".css") or caminho.endswith(".js"):
            return
        super().log_message(format, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, apikey, Authorization, x-client-info, prefer")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _enviar_json(self, dados, status=200):
         corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
         self.send_response(status)
         self.send_header("Content-Type", "application/json; charset=utf-8")
         self.send_header("Content-Length", str(len(corpo)))
         self.end_headers()
         self.wfile.write(corpo)

    def _ler_json_body(self):
        tamanho = int(self.headers.get("Content-Length", 0))
        if tamanho <= 0:
            return {}
        raw = self.rfile.read(tamanho).decode("utf-8")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_GET(self):
        if self.path.startswith("/api/config-teste"):
            estado = carregar_estado_teste()
            cfg_onibus = carregar_config_onibus()
            agora = datetime.now()
            aberta = janela_teste_aberta(estado["horario_abertura"])
            resposta = {
                "ativo": estado.get("ativo", True),
                "hora_servidor": agora.strftime("%H:%M:%S"),
                "horario_abertura": estado["horario_abertura"],
                "aberta_agora": aberta,
                "data_alvo": estado.get("data_alvo") or calcular_data_viagem_padrao(),
                "reservas_locais": estado.get("reservas_locais", []),
                "config_onibus": cfg_onibus,
            }
            self._enviar_json(resposta)
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/config-teste"):
            body = self._ler_json_body()
            acao = body.get("acao")
            estado = carregar_estado_teste()
            cfg_onibus = carregar_config_onibus()

            if acao == "proximo_minuto":
                segundos = int(body.get("segundos", 35))
                estado["horario_abertura"] = obter_proximo_horario_abertura(segundos)
                if body.get("limpar_reservas", True):
                    estado["reservas_locais"] = []
                salvar_estado_teste(estado)
                print(f"⏱️ [Painel de Teste] Novo horário de abertura definido para: {estado['horario_abertura']}")

            elif acao == "definir_horario":
                novo_h = str(body.get("horario_abertura", "")).strip()
                if len(novo_h) == 5 and ":" in novo_h:
                    estado["horario_abertura"] = novo_h
                    salvar_estado_teste(estado)
                    print(f"⏱️ [Painel de Teste] Horário de abertura alterado para: {novo_h}")

            elif acao == "abrir_agora":
                agora_menos_1 = (datetime.now() - timedelta(minutes=1)).strftime("%H:%M")
                estado["horario_abertura"] = agora_menos_1
                salvar_estado_teste(estado)
                print(f"🔓 [Painel de Teste] Lista liberada imediatamente (horário: {agora_menos_1})")

            elif acao == "limpar_reservas":
                estado["reservas_locais"] = []
                salvar_estado_teste(estado)
                print("🧹 [Painel de Teste] Reservas locais de teste foram limpas!")

            elif acao == "mudar_onibus":
                if "onibus_padrao" in body and body["onibus_padrao"] in (1, 2, 3):
                    cfg_onibus["onibus_padrao"] = int(body["onibus_padrao"])
                if "onibus_viagem_sexta" in body and body["onibus_viagem_sexta"] in (1, 2, 3):
                    cfg_onibus["onibus_viagem_sexta"] = int(body["onibus_viagem_sexta"])
                if "onibus_temporario" in body:
                    val = body["onibus_temporario"]
                    cfg_onibus["onibus_temporario"] = int(val) if val in (1, 2, 3, "1", "2", "3") else None
                salvar_config_onibus(cfg_onibus)
                print(f"🚌 [Painel de Teste] Configuração de ônibus atualizada: {cfg_onibus}")

            aberta = janela_teste_aberta(estado["horario_abertura"])
            self._enviar_json({
                "sucesso": True,
                "hora_servidor": datetime.now().strftime("%H:%M:%S"),
                "horario_abertura": estado["horario_abertura"],
                "aberta_agora": aberta,
                "data_alvo": estado.get("data_alvo"),
                "reservas_locais": estado.get("reservas_locais", []),
                "config_onibus": cfg_onibus,
            })
            return

        if self.path.startswith("/rest/v1/rpc/"):
            fn_name = self.path.split("/rest/v1/rpc/")[1].split("?")[0]
            payload = self._ler_json_body()
            self._tratar_rpc(fn_name, payload)
            return

        self._enviar_json({"erro": "Rota não encontrada"}, status=404)

    def _tratar_rpc(self, fn_name, payload):
        estado = carregar_estado_teste()

        # 1. Consulta de poltronas ocupadas
        if fn_name in ("consultar_poltronas_ocupadas_detalhes", "consultar_poltronas_detalhadas"):
            p_data = payload.get("p_data")
            p_onibus = payload.get("p_onibus")
            combinadas = obter_poltronas_combinadas(p_data, p_onibus)
            self._enviar_json(combinadas)
            return

        # 2. Validação de universitário
        if fn_name == "validar_universitario":
            res = chamar_supabase_real(fn_name, payload, cache_ttl=60)
            if res is None:
                res = {"autorizado": True, "mensagem": "Aluno cadastrado (modo local)."}
            self._enviar_json(res)
            return

        # 3. Verificação de cota UniRV
        if fn_name == "verificar_cota_unirv":
            res = chamar_supabase_real(fn_name, payload, cache_ttl=15)
            if res is None:
                res = {"liberada": True, "limite": 38, "utilizadas": 10, "restantes": 28, "mensagem": ""}
            self._enviar_json(res)
            return

        # 4. Consulta de reservas por nome / data / código
        if fn_name == "consultar_reservas_por_nome":
            p_nome = str(payload.get("p_nome") or "").strip().lower()
            locais = [
                r for r in estado.get("reservas_locais", [])
                if str(r.get("nome") or "").strip().lower() == p_nome
            ]
            reais = chamar_supabase_real(fn_name, payload, cache_ttl=15) or []
            self._enviar_json(locais + (reais if isinstance(reais, list) else []))
            return

        if fn_name == "consultar_reservas_por_nome_data_v2":
            p_nome = str(payload.get("p_nome") or "").strip().lower()
            p_data = payload.get("p_data")
            locais = [
                r for r in estado.get("reservas_locais", [])
                if str(r.get("nome") or "").strip().lower() == p_nome and r.get("data_viagem") == p_data
            ]
            self._enviar_json(locais)
            return

        if fn_name == "consultar_minha_reserva_por_codigo_v2":
            p_codigo = str(payload.get("p_codigo") or "").strip().upper()
            achadas = [
                r for r in estado.get("reservas_locais", [])
                if str(r.get("codigo_reserva") or "").strip().upper() == p_codigo
            ]
            if achadas:
                self._enviar_json(achadas)
                return
            reais = chamar_supabase_real(fn_name, payload, cache_ttl=0) or []
            self._enviar_json(reais)
            return

        if fn_name == "cancelar_minha_reserva_por_codigo":
            p_codigo = str(payload.get("p_codigo") or "").strip().upper()
            novas = []
            cancelada = None
            for r in estado.get("reservas_locais", []):
                if str(r.get("codigo_reserva") or "").strip().upper() == p_codigo:
                    cancelada = r
                else:
                    novas.append(r)
            if cancelada:
                estado["reservas_locais"] = novas
                salvar_estado_teste(estado)
                self._enviar_json({
                    "sucesso": True,
                    "mensagem": "Reserva de teste cancelada com sucesso!",
                    "data_viagem": cancelada.get("data_viagem"),
                    "onibus": cancelada.get("onibus"),
                    "poltrona": cancelada.get("poltrona"),
                })
                return
            self._enviar_json({"sucesso": False, "mensagem": "Reserva não encontrada no ambiente de teste."})
            return

        # 5. Realizar reserva (fazer_reserva_com_cota_unirv / fazer_reserva)
        if fn_name in ("fazer_reserva_com_cota_unirv", "fazer_reserva"):
            horario_abertura = estado.get("horario_abertura", "22:00")
            if not janela_teste_aberta(horario_abertura):
                self._enviar_json({
                    "sucesso": False,
                    "mensagem": f"As novas reservas estão encerradas neste momento. A lista será liberada às {horario_abertura}.",
                    "codigo_reserva": None,
                })
                return

            p_data = payload.get("p_data")
            p_nome = str(payload.get("p_nome") or "").strip()
            p_curso = payload.get("p_curso")
            p_instituicao = payload.get("p_instituicao")
            p_onibus = int(payload.get("p_onibus") or 2)
            p_poltrona = int(payload.get("p_poltrona") or 9)
            p_tipo = payload.get("p_tipo_transporte") or "onibus"

            # Verifica se já tem reserva local nessa data
            for r in estado.get("reservas_locais", []):
                if r.get("data_viagem") == p_data and r.get("nome", "").lower() == p_nome.lower():
                    self._enviar_json({
                        "sucesso": False,
                        "mensagem": "Você já possui uma reserva ativa para esta data.",
                        "codigo_reserva": r.get("codigo_reserva"),
                    })
                    return

            # Verifica se poltrona está ocupada
            ocupadas_atuais = [x["poltrona"] for x in obter_poltronas_combinadas(p_data, p_onibus)]
            if p_poltrona in ocupadas_atuais:
                self._enviar_json({
                    "sucesso": False,
                    "mensagem": f"A poltrona {p_poltrona} já está ocupada. Escolha outra poltrona.",
                    "codigo_reserva": None,
                })
                return

            sufixo = "".join(random.choices("0123456789ABCDEF", k=8))
            codigo = f"MU-{sufixo}"
            nova_reserva = {
                "data_viagem": p_data,
                "nome": p_nome,
                "curso": p_curso,
                "instituicao": p_instituicao,
                "onibus": p_onibus,
                "poltrona": p_poltrona,
                "tipo_transporte": p_tipo,
                "codigo_reserva": codigo,
            }
            estado.setdefault("reservas_locais", []).append(nova_reserva)
            salvar_estado_teste(estado)
            print(
                f"✅ [SERVIDOR DE TESTE] Reserva gravada! {p_nome} -> "
                f"Ônibus {p_onibus} | Poltrona {p_poltrona} | Data {p_data} | Código {codigo}"
            )
            self._enviar_json({
                "sucesso": True,
                "mensagem": "Reserva realizada com sucesso!",
                "codigo_reserva": codigo,
            })
            return

        # Demais chamadas (ex: listar_instituicoes_ativas, verificar_vagas_van, buscar_universitarios_ativos)
        res = chamar_supabase_real(fn_name, payload, cache_ttl=30)
        if res is None:
            if fn_name == "verificar_vagas_van":
                res = {"utilizadas": 0, "limite": 17}
            else:
                res = []
        self._enviar_json(res)


def iniciar_servidor(porta=8080):
    estado = carregar_estado_teste()
    estado["horario_abertura"] = obter_proximo_horario_abertura(45)
    estado["data_alvo"] = calcular_data_viagem_padrao()
    salvar_estado_teste(estado)

    servidor = ThreadingHTTPServer(("0.0.0.0", porta), ServidorTesteHandler)
    print("=" * 70)
    print(f"🌐 SERVIDOR DO SITE CLONADO DE TESTES RODANDO EM: http://localhost:{porta}")
    print(f"⏱️ Horário de abertura inicial configurado para: {estado['horario_abertura']}")
    print(f"📅 Data da viagem de teste: {estado['data_alvo']}")
    print("=" * 70)
    servidor.serve_forever()


if __name__ == "__main__":
    iniciar_servidor(8080)
