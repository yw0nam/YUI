import { describe, expect, it } from "vitest";
import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { t } from "../../../i18n";
import { serverLineView } from "./server-line-view";

const HOST = "api.test";

describe("serverLineView", () => {
  it.each([
    ["checking", "checking", t("svc.chat_status_connecting"), ["is-waiting", "is-busy"], undefined],
    ["ok", { kind: "ok" }, t("svc.server_connected", { host: HOST }), ["is-ready"], undefined],
    [
      "unreachable",
      { kind: "unreachable" },
      t("svc.chat_models_unreachable", { host: HOST }),
      ["is-failed"],
      t("svc.chat_status_reconnect"),
    ],
    [
      "timeout",
      { kind: "timeout" },
      t("svc.chat_models_timeout", { host: HOST }),
      ["is-failed"],
      t("svc.chat_status_reconnect"),
    ],
    ["refused", { kind: "refused" }, t("svc.chat_models_refused"), ["is-failed"], undefined],
    [
      "http 500",
      { kind: "http", status: 500 },
      t("svc.chat_models_http", { status: 500 }),
      ["is-failed"],
      undefined,
    ],
    ["malformed", { kind: "malformed" }, t("svc.server_connected", { host: HOST }), ["is-ready"], undefined],
  ])("maps %s", (_name, result, text, dot, action) => {
    const view = serverLineView(result as ServerCheck | "checking", HOST);
    expect(view.text).toBe(text);
    expect([...view.dot]).toEqual(dot);
    expect(view.action).toBe(action);
  });
});
