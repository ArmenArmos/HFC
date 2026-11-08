// A local stand-in for api.telegram.org. Records every Bot API call, answers the way Telegram does, and fails on request.
// preload.mjs sends the app's calls here. The test reads what was "sent" through /__e2e, on this machine only.
import { createServer } from "node:http";

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = async (req) => { const parts = []; for await (const p of req) parts.push(p); return Buffer.concat(parts).toString("utf8"); };

export async function startFakeTelegram({ botId, token, port }) {
  let nextMessage = 7000;
  const calls = [], model = [], failures = [], scripted = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const raw = await read(req);
    if (url.pathname === "/__e2e/calls") return json(res, 200, { calls, model });
    if (url.pathname === "/__e2e/model") {
      const call = JSON.parse(raw); model.push(call);
      const next = scripted.findIndex((s) => s.purpose === call.purpose);
      return json(res, 200, { override: next >= 0 ? scripted.splice(next, 1)[0].answer : {} });
    }
    if (url.pathname === "/__e2e/script") { scripted.push(JSON.parse(raw)); return json(res, 200, {}); }
    if (url.pathname === "/__e2e/fail") { failures.push(JSON.parse(raw)); return json(res, 200, {}); }
    const bot = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    if (!bot || bot[1] !== token) return json(res, 404, { ok: false, description: "Not Found" });
    const [, , method] = bot, body = JSON.parse(raw);
    const fail = failures.findIndex((f) => f.method === method && (f.chatId === undefined || f.chatId === body.chat_id));
    const failure = fail >= 0 ? failures.splice(fail, 1)[0] : null;
    const call = { method, body, failed: failure?.mode ?? null };
    calls.push(call);
    // "drop": the request reached Telegram and the answer was lost, so nobody can say whether it was sent.
    if (failure?.mode === "drop") return req.socket.destroy();
    if (failure?.mode === "refuse") return json(res, 403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    if (method === "answerCallbackQuery") return json(res, 200, { ok: true, result: true });
    if (!["sendMessage", "editMessageText", "editMessageReplyMarkup", "sendPhoto"].includes(method)) return json(res, 400, { ok: false, description: `Fake Telegram does not know ${method}` });
    call.result = { message_id: body.message_id ?? ++nextMessage };
    return json(res, 200, { ok: true, result: { message_id: call.result.message_id, date: Math.floor(Date.now() / 1000), from: { id: botId, is_bot: true, first_name: "Noreon" }, chat: { id: body.chat_id, type: "private" }, text: body.text } });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}
