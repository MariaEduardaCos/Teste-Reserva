import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  RESERVA_NOME: "Aluno Teste",
  TELEGRAM_CHAT_ID: "123456",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
};

async function simulate(update) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), payload: JSON.parse(opts.body) });
    if (String(url).endsWith("/consultar_reservas_por_nome_data_v2")) {
      return new Response(JSON.stringify([{ onibus: 2, poltrona: 11, codigo_reserva: "MU-ABC12345" }]));
    }
    if (String(url).includes("/rest/v1/rpc/")) {
      return new Response(JSON.stringify({ sucesso: true, data_viagem: "2026-11-27", onibus: 2, poltrona: 11 }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, result: true }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const req = new Request("https://worker.example/", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret", "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    const response = await worker.fetch(req, env);
    return { response, calls };
  } finally {
    globalThis.fetch = previous;
  }
}

function message(text, user = 123456) {
  return { message: { chat: { id: 123456, type: "private" }, from: { id: user }, text } };
}
function callback(data, user = 123456) {
  return { callback_query: { id: "callback-1", from: { id: user }, message: {
    chat: { id: 123456, type: "private" }, message_id: 1 }, data } };
}

test("start never invokes Supabase", async () => {
  const { response, calls } = await simulate(message("/start"));
  assert.equal(response.status, 200);
  assert.equal(calls.filter(x => x.url.includes("supabase")).length, 0);
  assert.ok(calls.some(x => x.url.endsWith("/sendMessage")));
});

test("unauthorized user cannot cancel", async () => {
  const { calls } = await simulate(callback("yes:MU-ABC12345:" + Math.floor(Date.now() / 1000), 999));
  assert.equal(calls.length, 0);
});

test("invalid code is rejected without cancellation", async () => {
  const { calls } = await simulate(message("/cancelar INVALIDO"));
  assert.equal(calls.filter(x => x.url.includes("supabase")).length, 0);
});

test("requesting cancellation requires second confirmation", async () => {
  const { calls } = await simulate(callback("cancel:MU-ABC12345"));
  assert.equal(calls.filter(x => x.url.includes("supabase")).length, 0);
  assert.ok(calls.some(x => x.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith("yes:")));
});

test("declining cancellation never invokes Supabase", async () => {
  const { calls } = await simulate(callback("no"));
  assert.equal(calls.filter(x => x.url.includes("supabase")).length, 0);
});

test("expired confirmation never invokes Supabase", async () => {
  const { calls } = await simulate(callback("yes:MU-ABC12345:" + (Math.floor(Date.now() / 1000) - 500)));
  assert.equal(calls.filter(x => x.url.includes("supabase")).length, 0);
});

test("confirmed cancellation calls the existing RPC once", async () => {
  const { calls } = await simulate(callback("yes:MU-ABC12345:" + Math.floor(Date.now() / 1000)));
  const rpc = calls.filter(x => x.url.includes("/rest/v1/rpc/"));
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].payload.p_codigo, "MU-ABC12345");
  assert.ok(calls.some(x => x.payload.text?.includes("Reserva cancelada no sistema")));
});

test("missing webhook secret is rejected", async () => {
  const req = new Request("https://worker.example/", { method: "POST", body: "{}" });
  const response = await worker.fetch(req, env);
  assert.equal(response.status, 403);
});

test("consulta uses only read RPC and returns cancellation button", async () => {
  const { calls } = await simulate(message("/reserva 2026-11-27"));
  const rpc = calls.filter(x => x.url.includes("/rest/v1/rpc/"));
  assert.equal(rpc.length, 1);
  assert.ok(rpc[0].url.endsWith("/consultar_reservas_por_nome_data_v2"));
  assert.equal(rpc[0].payload.p_data, "2026-11-27");
  assert.ok(calls.some(x => x.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "cancel:MU-ABC12345"));
});
test("unauthorized consultation makes no calls", async () => {
  const { calls } = await simulate(message("/reserva", 999));
  assert.equal(calls.length, 0);
});
