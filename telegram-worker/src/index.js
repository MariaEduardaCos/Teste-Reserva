/**
 * Telegram webhook for university reservation cancellation.
 * Deploy as a Cloudflare Worker. Never deploy secrets in this source.
 *
 * Telegram secret_token validates the webhook source.
 * Allowed private chat ID prevents other Telegram users from using it.
 */
const CODE = /^MU-[A-Z0-9]{8}$/i;
const CONFIRM_SECONDS = 300;

function allowed(chat, user, env) {
  return chat && chat.type === "private" &&
    String(chat.id) === String(env.TELEGRAM_CHAT_ID) &&
    String(user?.id) === String(env.TELEGRAM_CHAT_ID);
}

async function telegram(env, method, payload) {
  const response = await fetch(
    "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram API failure");
  return result.result;
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function normalize(code) {
  const value = String(code || "").trim().toUpperCase();
  return CODE.test(value) ? value : null;
}

function confirmButtons(code, timestamp) {
  return keyboard([
    [{ text: "✅ Sim, cancelar reserva", callback_data: "yes:" + code + ":" + timestamp }],
    [{ text: "↩️ Não, manter reserva", callback_data: "no" }],
  ]);
}

async function cancelInSupabase(env, code) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase is not configured");
  }
  // Only publishable/anon access is required: same existing RPC as the website.
  const url = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/cancelar_minha_reserva_por_codigo";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_codigo: code }),
  });
  if (!response.ok) throw new Error("Supabase RPC failed");
  const json = await response.json();
  const result = Array.isArray(json) ? json[0] : json;
  return result && result.sucesso === true ? { ok: true, details: result } :
    { ok: false, details: result };
}

async function reply(env, chatId, text, markup) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...(markup ? { reply_markup: markup } : {}),
  });
}

async function handleMessage(env, message) {
  if (!allowed(message.chat, message.from, env)) return;
  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  if (/^\/(start|ajuda|help)(?:@\w+)?$/i.test(text)) {
    await reply(env, chatId,
      "🚌 Bot de reservas\n\nApós cada nova reserva, use o botão ❌ Solicitar cancelamento para iniciar o processo.\n\nTambém pode enviar /cancelar MU-XXXXXXXX, substituindo pelo seu código.\n\nO cancelamento só ocorre depois de uma segunda confirmação.");
    return;
  }
  const match = text.match(/^\/cancelar(?:@\w+)?\s+(\S+)$/i);
  if (match) {
    const code = normalize(match[1]);
    if (!code) {
      await reply(env, chatId, "Código inválido. Use /cancelar MU-XXXXXXXX.");
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    await reply(env, chatId, "⚠️ Tem certeza que deseja cancelar a reserva " + code +
      "? Essa ação não pode ser desfeita pelo bot.",
      confirmButtons(code, timestamp));
  } else if (/^\/cancelar(?:@\w+)?$/i.test(text)) {
    await reply(env, chatId, "Para cancelar, use o botão da mensagem de reserva ou envie /cancelar MU-XXXXXXXX.");
  }
}

async function handleCallback(env, callback) {
  const msg = callback.message;
  if (!msg || !allowed(msg.chat, callback.from, env)) return;
  const chatId = msg.chat.id;
  const data = String(callback.data || "");
  // Always acknowledge callback; Telegram UI won't spin forever.
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
  if (data === "no") {
    await reply(env, chatId, "✅ Cancelamento interrompido. Sua reserva foi mantida.");
    return;
  }
  if (data.startsWith("cancel:")) {
    const code = normalize(data.slice("cancel:".length));
    if (!code) return;
    const timestamp = Math.floor(Date.now() / 1000);
    await reply(env, chatId, "⚠️ Confirma o cancelamento da reserva " + code + "?",
      confirmButtons(code, timestamp));
    return;
  }
  if (data.startsWith("yes:")) {
    const parts = data.split(":");
    const code = normalize(parts[1]);
    const timestamp = Number(parts[2]);
    const now = Math.floor(Date.now() / 1000);
    if (parts.length !== 3 || !code || !Number.isSafeInteger(timestamp) ||
      timestamp > now + 10 || now - timestamp > CONFIRM_SECONDS) {
      await reply(env, chatId, "⏳ Confirmação expirada ou inválida. Solicite o cancelamento novamente.");
      return;
    }
    try {
      const response = await cancelInSupabase(env, code);
      if (response.ok) {
        const d = response.details;
        await reply(env, chatId,
          "✅ Reserva cancelada no sistema.\nData: " + (d.data_viagem || "não informada") +
          "\nÔnibus: " + (d.onibus ?? "não informado") +
          "\nPoltrona: " + (d.poltrona ?? "não informada"));
      } else {
        await reply(env, chatId,
          "❌ O sistema não confirmou o cancelamento. Confira a reserva no site antes de tentar novamente.");
      }
    } catch (_error) {
      await reply(env, chatId,
        "⚠️ Não consegui confirmar o cancelamento no Supabase. Consulte sua reserva no site; não considere cancelada.");
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Not configured", { status: 503 });
    }
    const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!receivedSecret || receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const update = await request.json();
      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }
      return new Response("OK");
    } catch (_error) {
      // Telegram may retry 5xx; the RPC itself is expected to reject repeat cancellations.
      return new Response("Temporary error", { status: 503 });
    }
  },
};
