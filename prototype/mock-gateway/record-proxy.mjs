// Recording pass-through for the Responses measurements (issue #1648 prototype).
// Sits in front of the scripted mock (mock-openai.cjs): logs every request body's byte size
// and its input/tool-output shape to /tmp/proto-mcp/responses-requests.jsonl, then forwards
// the request and streams the answer back untouched (SSE included).
//
//   node record-proxy.mjs [listen_port] [upstream_port]   (defaults 18440 → 18434)

import http from "node:http";
import fs from "node:fs";

const LISTEN = Number(process.argv[2] || 18440);
const UPSTREAM = Number(process.argv[3] || 18434);
const T0 = Date.now();
const OUT = "/tmp/proto-mcp/responses-requests.jsonl";

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      let summary = null;
      if (req.url === "/v1/responses") {
        try {
          const parsed = JSON.parse(body.toString("utf8"));
          const input = Array.isArray(parsed.input) ? parsed.input : [];
          const items = input.map((it) => {
            if (it?.type === "function_call_output") {
              const out = it.output;
              let images = 0;
              let outBytes = 0;
              let preview = "";
              try {
                // The parsed body already holds output as a string or an array of parts.
                const arr = Array.isArray(out) ? out : JSON.parse(out);
                images = arr.filter((p) => p?.type === "input_image").length;
                preview = JSON.stringify(arr).slice(0, 220);
                outBytes = Buffer.byteLength(JSON.stringify(arr), "utf8");
              } catch {
                outBytes = Buffer.byteLength(String(out ?? ""), "utf8");
                preview = String(out ?? "").slice(0, 220);
              }
              return { type: it.type, call_id: it.call_id, images, output_bytes: outBytes, preview };
            }
            if (it?.role === "user") {
              const content = Array.isArray(it.content) ? it.content : null;
              return {
                type: "user",
                images: content ? content.filter((p) => p?.type === "input_image").length : 0,
              };
            }
            return { type: it?.type ?? it?.role ?? "unknown" };
          });
          summary = {
            at: new Date().toISOString(),
            elapsed_s: (Date.now() - T0) / 1000,
            url: req.url,
            body_bytes: body.length,
            input_items: input.length,
            items,
            tools: (parsed.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean),
            previous_response_id: parsed.previous_response_id ?? null,
            stream: parsed.stream ?? false,
          };
          fs.appendFileSync(OUT, JSON.stringify(summary) + "\n");
          console.log(
            `[proxy ${((Date.now() - T0) / 1000).toFixed(3)}s] /v1/responses ${body.length}B ` +
              `items=${input.length} images=${items.reduce((n, i) => n + (i.images ?? 0), 0)} ` +
              `fco=${items.some((i) => i.type === "function_call_output")}`,
          );
        } catch {
          console.log(`[proxy ${((Date.now() - T0) / 1000).toFixed(3)}s] unparseable body`);
        }
      }
      const up = http.request(
        { host: "127.0.0.1", port: UPSTREAM, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${UPSTREAM}` } },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.pipe(res);
        },
      );
      up.on("error", (err) => {
        console.error("upstream error", err.message);
        res.writeHead(502);
        res.end("proxy upstream error");
      });
      up.end(body);
    });
  })
  .listen(LISTEN, "127.0.0.1", () => console.log(`record proxy on :${LISTEN} → :${UPSTREAM}, log ${OUT}`));
