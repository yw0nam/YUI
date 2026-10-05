import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// Dev-only same-origin mount for the chat backend. `/__backend/<scheme>/<host[:port]>/<path>` is forwarded to
// `<scheme>://<host[:port]>/<path>`, so the browser build reaches the configured chat_base_url without CORS.
export const BACKEND_MOUNT = "/__backend";

/** Splits the mount-relative URL into the upstream origin and the request path, or null when it names none. */
export function parseBackendPath(url) {
  const match = /^\/(https?)\/([^/?#]+)(.*)$/.exec(url);
  if (!match) return null;
  let target;
  try {
    target = new URL(`${match[1]}://${match[2]}`);
  } catch {
    return null;
  }
  if (target.host !== match[2].toLowerCase()) return null;
  const rest = match[3];
  return { target, path: rest.startsWith("/") ? rest : `/${rest}` };
}

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** The headers a proxy may pass on: no hop-by-hop header, none named by `Connection`, none in `extra`. */
function forwardable(headers, extra = []) {
  const named = String(headers.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.includes(key) || named.includes(key) || extra.includes(key)) continue;
    out[name] = value;
  }
  return out;
}

export function createBackendProxy(logError = console.error) {
  return (req, res) => {
    // A page on another origin must not turn the dev server into a forwarder. A request with
    // neither header is a local tool (curl) and passes.
    const site = req.headers["sec-fetch-site"];
    const origin = req.headers.origin;
    const crossSite =
      site !== undefined
        ? site !== "same-origin"
        : origin !== undefined && origin !== `http://${req.headers.host}`;
    if (crossSite) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const parsed = parseBackendPath(req.url ?? "");
    if (!parsed) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const { target, path } = parsed;
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    // Cookie and Origin are browser credentials; a backend that allowlists browser origins serves a
    // request without Origin as a server-side API client.
    const headers = {
      ...forwardable(req.headers, ["cookie", "origin", "host"]),
      host: target.host,
    };
    let upstreamRes;
    const upstream = send(target, { method: req.method, path, headers }, (up) => {
      upstreamRes = up;
      res.writeHead(up.statusCode ?? 502, forwardable(up.headers));
      up.pipe(res);
      // A response cut short must not look complete downstream.
      up.on("error", () => res.destroy());
      up.on("close", () => {
        if (!up.complete) res.destroy();
      });
    });
    upstream.on("error", (err) => {
      // A client that left first caused this error; nobody is waiting for an answer.
      if (res.destroyed) return;
      logError(`backend proxy error: ${target.origin}${path}: ${err.message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.statusCode = 502;
      res.end();
    });
    res.on("close", () => {
      upstream.destroy();
      upstreamRes?.destroy();
    });
    req.on("close", () => {
      if (!req.complete) upstream.destroy();
    });
    req.pipe(upstream);
  };
}

export function backendProxy() {
  return {
    name: "yui-backend-proxy",
    configureServer(server) {
      server.middlewares.use(
        BACKEND_MOUNT,
        createBackendProxy((message) => server.config.logger.error(message)),
      );
    },
  };
}
