import { createServer, type IncomingHttpHeaders, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBackendProxy, parseBackendPath } from "../../scripts/dev-backend-proxy.mjs";

describe("parseBackendPath", () => {
  it("splits scheme, host with port and path", () => {
    const parsed = parseBackendPath("/http/localhost:8643/v1/responses?x=1");
    expect(parsed?.target.origin).toBe("http://localhost:8643");
    expect(parsed?.path).toBe("/v1/responses?x=1");
  });

  it("keeps https and an IPv6 host", () => {
    expect(parseBackendPath("/https/chat.example:9443/v1")?.target.origin).toBe(
      "https://chat.example:9443",
    );
    expect(parseBackendPath("/http/[::1]:8643/v1")?.target.host).toBe("[::1]:8643");
  });

  it("answers the root path when the URL ends at the host", () => {
    expect(parseBackendPath("/http/localhost:8643")?.path).toBe("/");
    expect(parseBackendPath("/http/localhost:8643?a=1")?.path).toBe("/?a=1");
  });

  it.each([
    "/",
    "/ftp/host/v1",
    "/http/",
    "/http/user@host/v1",
    "/http/ho st/v1",
    "/http/host%2Fx/v1",
  ])("rejects %s", (url) => {
    expect(parseBackendPath(url)).toBeNull();
  });
});

describe("createBackendProxy", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  function send(port: number, path: string, headers: Record<string, string> = {}, body = "") {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ port, host: "127.0.0.1", path, method: "POST", headers }, (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  it("forwards method, path, query and body to the named origin and drops Origin", async () => {
    const seen: { url?: string; method?: string; headers?: IncomingHttpHeaders; body: string }[] =
      [];
    const upstreamPort = await listen((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        seen.push({ url: req.url, method: req.method, headers: req.headers, body });
        res.end("pong");
      });
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    const res = await send(
      proxyPort,
      `/http/127.0.0.1:${upstreamPort}/v1/responses?a=1`,
      { origin: "http://127.0.0.1:1420", "sec-fetch-site": "same-origin" },
      "hello",
    );

    expect(res).toEqual({ status: 200, body: "pong" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe("/v1/responses?a=1");
    expect(seen[0]?.body).toBe("hello");
    expect(seen[0]?.headers?.origin).toBeUndefined();
    expect(seen[0]?.headers?.host).toBe(`127.0.0.1:${upstreamPort}`);
  });

  it("keeps Authorization and drops Cookie and hop-by-hop request headers", async () => {
    let seen: IncomingHttpHeaders = {};
    const upstreamPort = await listen((req, res) => {
      seen = req.headers;
      res.end();
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    await send(proxyPort, `/http/127.0.0.1:${upstreamPort}/v1`, {
      authorization: "Bearer k",
      cookie: "a=1",
      "proxy-authorization": "Basic x",
      connection: "keep-alive, x-hop",
      "x-hop": "1",
      "x-keep": "2",
    });

    expect(seen.authorization).toBe("Bearer k");
    expect(seen["x-keep"]).toBe("2");
    expect(seen.cookie).toBeUndefined();
    expect(seen["proxy-authorization"]).toBeUndefined();
    expect(seen["x-hop"]).toBeUndefined();
  });

  it("drops hop-by-hop response headers", async () => {
    const upstreamPort = await listen((_req, res) => {
      res.setHeader("connection", "x-resp-hop");
      res.setHeader("x-resp-hop", "1");
      res.setHeader("x-resp-keep", "2");
      res.end("ok");
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    const headers = await new Promise<IncomingHttpHeaders>((resolve, reject) => {
      const req = request(
        { port: proxyPort, host: "127.0.0.1", path: `/http/127.0.0.1:${upstreamPort}/` },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.headers));
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(headers["x-resp-keep"]).toBe("2");
    expect(headers["x-resp-hop"]).toBeUndefined();
  });

  it("stops the upstream request when the client disconnects mid-stream", async () => {
    let upstreamClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      upstreamClosed = resolve;
    });
    const upstreamPort = await listen((req, res) => {
      req.on("close", upstreamClosed);
      res.write("a");
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    await new Promise<void>((resolve, reject) => {
      const req = request(
        { port: proxyPort, host: "127.0.0.1", path: `/http/127.0.0.1:${upstreamPort}/stream` },
        (res) => {
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on("error", () => {});
      req.on("close", () => {});
      req.end();
      setTimeout(() => reject(new Error("no first chunk")), 2000);
    });

    await closed;
  });

  it("cuts the response when the upstream aborts after the headers", async () => {
    const upstreamPort = await listen((_req, res) => {
      res.write("a");
      setTimeout(() => res.destroy(), 20);
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    const complete = await new Promise<boolean>((resolve) => {
      const req = request(
        { port: proxyPort, host: "127.0.0.1", path: `/http/127.0.0.1:${upstreamPort}/stream` },
        (res) => {
          res.resume();
          res.on("error", () => {});
          res.on("close", () => resolve(res.complete));
        },
      );
      req.on("error", () => resolve(false));
      req.end();
    });

    expect(complete).toBe(false);
  });

  it("refuses a request whose Origin is another origin when Sec-Fetch-Site is absent", async () => {
    let hits = 0;
    const upstreamPort = await listen((_req, res) => {
      hits += 1;
      res.end();
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    const foreign = await send(proxyPort, `/http/127.0.0.1:${upstreamPort}/`, {
      origin: "https://evil.example",
    });
    const own = await send(proxyPort, `/http/127.0.0.1:${upstreamPort}/`, {
      origin: `http://127.0.0.1:${proxyPort}`,
    });
    const none = await send(proxyPort, `/http/127.0.0.1:${upstreamPort}/`);

    expect([foreign.status, own.status, none.status]).toEqual([403, 200, 200]);
    expect(hits).toBe(2);
  });

  it("passes a streamed response through chunk by chunk", async () => {
    let firstChunkSeen: () => void = () => {};
    const seen = new Promise<void>((resolve) => {
      firstChunkSeen = resolve;
    });
    const upstreamPort = await listen(async (_req, res) => {
      res.write("a");
      // The second chunk leaves only after the client has read the first one through the proxy.
      await seen;
      res.end("b");
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    const chunks = await new Promise<string[]>((resolve, reject) => {
      const got: string[] = [];
      const req = request(
        { port: proxyPort, host: "127.0.0.1", path: `/http/127.0.0.1:${upstreamPort}/stream` },
        (res) => {
          res.on("data", (chunk) => {
            got.push(String(chunk));
            if (got.length === 1) firstChunkSeen();
          });
          res.on("end", () => resolve(got));
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(chunks).toEqual(["a", "b"]);
  });

  it("refuses a cross-site request without contacting the upstream", async () => {
    let hits = 0;
    const upstreamPort = await listen((_req, res) => {
      hits += 1;
      res.end();
    });
    const proxyPort = await listen(createBackendProxy(() => {}));

    const res = await send(proxyPort, `/http/127.0.0.1:${upstreamPort}/`, {
      "sec-fetch-site": "cross-site",
    });

    expect(res.status).toBe(403);
    expect(hits).toBe(0);
  });

  it("answers 400 for a path that names no origin", async () => {
    const proxyPort = await listen(createBackendProxy(() => {}));
    expect((await send(proxyPort, "/v1/responses")).status).toBe(400);
  });

  it("answers 502 and logs when the upstream is down", async () => {
    const closed = await listen((_req, res) => res.end());
    servers.pop()?.close();
    const logged: string[] = [];
    const proxyPort = await listen(createBackendProxy((message) => logged.push(message)));

    const res = await send(proxyPort, `/http/127.0.0.1:${closed}/v1`);

    expect(res.status).toBe(502);
    expect(logged).toHaveLength(1);
  });
});
