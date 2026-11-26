"""Comprovante da reserva e notificacoes opcionais em nuvem.

Credenciais sao lidas exclusivamente dos GitHub Actions Secrets.
Nao imprime o codigo nos logs para evitar exposicao no repositorio publico.
"""
import hashlib
import hmac
import time
import json
import os
import re
import smtplib
import ssl
import urllib.parse
import urllib.request
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

PASTA = Path(os.environ.get("RESERVA_COMPROVANTE_DIR", "comprovantes"))
PADRAO_CODIGO = re.compile(r"^MU-[A-Z0-9]{8}$", re.IGNORECASE)


def gerar_comprovante(data_viagem, onibus, poltrona, codigo, nome, origem="nova"):
    """Grava os dados da reserva no workspace efemero do GitHub Actions."""
    codigo = str(codigo or "").strip().upper()
    confirmado = bool(PADRAO_CODIGO.fullmatch(codigo))
    documento = {
        "situacao": "confirmada" if confirmado else "confirmada_sem_codigo",
        "codigo_reserva": codigo if confirmado else None,
        "data_viagem": data_viagem,
        "onibus": onibus,
        "poltrona": poltrona,
        "nome": nome,
        "origem": origem,
        "registrado_em": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    PASTA.mkdir(parents=True, exist_ok=True)
    (PASTA / "comprovante.json").write_text(
        json.dumps(documento, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    texto = (
        f"Reserva: {documento['situacao']}\n"
        f"Data: {data_viagem}\n"
        f"Onibus: {onibus}\n"
        f"Poltrona: {poltrona}\n"
        f"Codigo: {codigo if confirmado else 'nao retornado pelo sistema'}\n"
    )
    (PASTA / "comprovante.txt").write_text(texto, encoding="utf-8")
    print("Comprovante criado para download no GitHub Actions.")
    return documento


def _mensagem(dados):
    if dados.get("falha"):
        return "Reserva universitaria nao confirmada.\nMotivo: " + dados["falha"]
    return (
        "Reserva universitaria confirmada!\n"
        f"Data: {dados['data_viagem']}\n"
        f"Onibus: {dados['onibus']}\n"
        f"Poltrona: {dados['poltrona']}\n"
        f"Codigo: {dados['codigo_reserva'] or 'nao retornado pelo sistema'}"
    )


def _enviar_email(dados):
    campos = ["SMTP_USER", "SMTP_PASSWORD", "EMAIL_DESTINO"]
    if not all(os.environ.get(x) for x in campos):
        print("E-mail nao configurado: faltam Secrets SMTP_USER, SMTP_PASSWORD ou EMAIL_DESTINO.")
        return False
    mensagem = EmailMessage()
    mensagem["From"] = os.environ["SMTP_USER"]
    mensagem["To"] = os.environ["EMAIL_DESTINO"]
    mensagem["Subject"] = f"Comprovante reserva universitaria - {dados['data_viagem']}"
    mensagem.set_content(_mensagem(dados))
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    porta = int(os.environ.get("SMTP_PORT", "465"))
    with smtplib.SMTP_SSL(host, porta, context=ssl.create_default_context(), timeout=15) as smtp:
        smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(mensagem)
    print("Notificacao por e-mail enviada.")
    return True


def _enviar_telegram(dados):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("Telegram nao configurado: faltam Secrets TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID.")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": _mensagem(dados)}
    codigo = str(dados.get("codigo_reserva") or "").strip().upper()
    if PADRAO_CODIGO.fullmatch(codigo):
        payload["reply_markup"] = json.dumps({
            "inline_keyboard": [[{
                "text": "❌ Solicitar cancelamento",
                "callback_data": "cancel:" + codigo,
            }]]
        })
    formulario = urllib.parse.urlencode(payload).encode()
    requisicao = urllib.request.Request(url, data=formulario, method="POST")
    with urllib.request.urlopen(requisicao, timeout=15) as resposta:
        resultado = json.load(resposta)
    if not resultado.get("ok"):
        raise RuntimeError("API do Telegram nao confirmou o envio")
    print("Notificacao por Telegram enviada.")
    return True


def _notificar_uma_vez(dados, canal, funcao):
    segredo = os.environ.get("TELEGRAM_BOT_TOKEN") if canal == "Telegram" else os.environ.get("SMTP_PASSWORD")
    pasta = Path(os.environ.get("RESERVA_NOTIFICACOES_DIR", ".notificacoes-reserva"))
    marcador = None
    if segredo:
        identidade = json.dumps([canal, dados.get("data_viagem"), dados.get("onibus"), dados.get("poltrona"), dados.get("codigo_reserva"), dados.get("falha"), os.environ.get("TELEGRAM_CHAT_ID") if canal == "Telegram" else os.environ.get("EMAIL_DESTINO")])
        chave = hmac.new(segredo.encode(), identidade.encode(), hashlib.sha256).hexdigest()
        marcador = pasta / chave
        if marcador.exists():
            print(f"Notificacao por {canal} ja confirmada anteriormente.")
            return True
    for tentativa in range(3 if canal == "Telegram" else 1):
        try:
            if not funcao(dados):
                return False
            if marcador:
                pasta.mkdir(parents=True, exist_ok=True)
                marcador.touch()
            return True
        except Exception as erro:
            print(f"Falha ao enviar {canal}: {type(erro).__name__} (tentativa {tentativa + 1}).")
            if tentativa < 2 and canal == "Telegram":
                time.sleep(2 ** (tentativa + 1))
    return False


def notificar_falha(motivo):
    return _notificar_uma_vez({"falha": motivo, "data_viagem": datetime.now().date().isoformat()}, "Telegram", _enviar_telegram)


def registrar_e_notificar(data_viagem, onibus, poltrona, codigo, nome, origem="nova"):
    dados = gerar_comprovante(data_viagem, onibus, poltrona, codigo, nome, origem)
    if origem == "nova":
        _notificar_uma_vez(dados, "e-mail", _enviar_email)
    _notificar_uma_vez(dados, "Telegram", _enviar_telegram)
    return dados
