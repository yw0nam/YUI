// Throwaway mock push gateway for the YUI MCP-host prototype (issue #1648).
// Speaks just enough of docs/reference/push-transport.md: hello → ready (with max_turn_bytes),
// turn, tool_call/tool_result, render, turn_end, stop. Every received frame is logged with its
// byte size and kept for GET /__frames. Control endpoints:
//   POST /__toolcall {name, arguments, turn_id}  → sends one tool_call frame
//   POST /__render  {turn_id, speech, silent?}   → sends render (+ turn_end with it)
//   GET  /__frames                               → every frame received, newest last
//   POST /__reset                                → clears the frame log
//   GET  /__tools                                → the tool names the client declared in hello
//
//   node gateway.mjs [ws_port] [http_port]      (defaults 18450 / 18451)

import http from "node:http";
import { WebSocketServer } from "ws";

const WS_PORT = Number(process.argv[2] || 18450);
const HTTP_PORT = Number(process.argv[3] || 18451);
const T0 = Date.now();

const ts = () => `${((Date.now() - T0) / 1000).toFixed(3)}s`;
const frames = [];
const clients = new Set();
let callSeq = 0;

function log(line) {
  console.log(`[gateway ${ts()}] ${line}`);
}

const wss = new WebSocketServer({ port: WS_PORT, path: "/ws" });
log(`listening ws://127.0.0.1:${WS_PORT}/ws, control on :${HTTP_PORT}`);

wss.on("connection", (socket) => {
  log("client connected");
  clients.add(socket);
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const text = data.toString("utf8");
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      log(`unparseable frame (${text.length} bytes)`);
      return;
    }
    const record = {
      at: new Date().toISOString(),
      elapsed_s: (Date.now() - T0) / 1000,
      type: frame.type,
      bytes: Buffer.byteLength(text, "utf8"),
      frame,
    };
    if (frame.type === "hello") {
      record.tools = (frame.tools ?? []).map((t) => t?.function?.name).filter(Boolean);
      socket.send(
        JSON.stringify({
          type: "ready",
          chat_id: frame.chat_id ?? "yui-proto",
          max_turn_bytes: 8_000_000,
        }),
      );
      log(`hello → ready (tools: ${record.tools.join(", ")})`);
    } else {
      log(`RECV ${frame.type} (${record.bytes} bytes)${frame.type === "tool_result" ? ` id=${frame.id} images=${frame.images?.length ?? 0}` : ""}`);
    }
    frames.push(record);
  });
  socket.on("close", (code) => {
    log(`client closed code=${code}`);
    clients.delete(socket);
  });
});

function sendToClient(frame) {
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(frame));
      return true;
    }
  }
  return false;
}

http
  .createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/__toolcall") {
        const id = `c-${++callSeq}`;
        const sent = sendToClient({
          type: "tool_call",
          id,
          turn_id: body.turn_id,
          name: body.name,
          arguments: body.arguments ?? {},
        });
        log(`SEND tool_call id=${id} name=${body.name} turn=${body.turn_id} sent=${sent}`);
        json(200, { id, sent });
      } else if (req.url === "/__render") {
        const speech = body.silent ? "" : (body.speech ?? "게이트웨이 응답이 도착했어.");
        sendToClient({
          type: "render",
          turn_id: body.turn_id,
          source: "proto-gateway",
          segments: [{ cues: body.cues ?? [{ emotion_id: "neutral" }], speech }],
        });
        sendToClient({
          type: "turn_end",
          turn_id: body.turn_id,
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        });
        log(`SEND render+turn_end turn=${body.turn_id}`);
        json(200, { ok: true });
      } else if (req.url === "/__frames") {
        json(200, frames);
      } else if (req.url === "/__reset") {
        frames.length = 0;
        json(200, { ok: true });
      } else if (req.url === "/__tools") {
        const hello = [...frames].reverse().find((f) => f.type === "hello");
        json(200, { tools: hello ? hello.tools : null });
      } else {
        json(404, { error: "unknown route" });
      }
    });
  })
  .listen(HTTP_PORT, "127.0.0.1", () => log(`control http://127.0.0.1:${HTTP_PORT}`));
