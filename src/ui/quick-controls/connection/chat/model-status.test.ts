import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { modelStatusView } from "./model-status";

const HOST = "api.test";

// One view input per situation; ok carries three ids.
function phase(kind: "reading" | "ok" | "unreachable" | "timeout" | "refused" | "http" | "no_list" | "malformed") {
  switch (kind) {
    case "reading":
      return { phase: "reading" } as const;
    case "ok":
      return {
        phase: "done",
        result: { kind: "ok", ids: ["a", "b:variant", "c"] },
      } as const;
    case "unreachable":
      return { phase: "done", result: { kind: "unreachable" } } as const;
    case "timeout":
      return { phase: "done", result: { kind: "timeout" } } as const;
    case "refused":
      return { phase: "done", result: { kind: "refused" } } as const;
    case "http":
      return { phase: "done", result: { kind: "http", status: 500 } } as const;
    case "no_list":
      return { phase: "done", result: { kind: "no_list" } } as const;
    case "malformed":
      return { phase: "done", result: { kind: "malformed" } } as const;
  }
}

describe("modelStatusView", () => {
  it.each([
    ["reading", "reading", {}, ["is-waiting", "is-busy"]],
    [
      "ok with the typed model listed",
      "ok",
      { typedModel: "a", want: t("svc.chat_models_read", { n: 3 }) },
      ["is-ready"],
    ],
    [
      "ok with the typed model matching a listed id's {model}: prefix",
      "ok",
      { typedModel: "b", want: t("svc.chat_models_read", { n: 3 }) },
      ["is-ready"],
    ],
    [
      "ok falling back to the bundled default model",
      "ok",
      { typedModel: "", defaultModel: "c", want: t("svc.chat_models_read", { n: 3 }) },
      ["is-ready"],
    ],
    [
      "ok with nothing typed and no default model",
      "ok",
      { typedModel: "", want: t("svc.chat_models_pick", { n: 3 }) },
      ["is-waiting"],
    ],
    [
      "ok with the typed model absent from the list",
      "ok",
      { typedModel: "zz", want: t("svc.chat_models_absent", { model: "zz" }) },
      [],
    ],
    [
      "unreachable",
      "unreachable",
      { want: t("svc.chat_models_unreachable", { host: HOST }) },
      ["is-failed"],
    ],
    [
      "timeout",
      "timeout",
      { want: t("svc.chat_models_timeout", { host: HOST }) },
      ["is-failed"],
    ],
    ["refused", "refused", { want: t("svc.chat_models_refused") }, ["is-failed"]],
    [
      "http",
      "http",
      { want: t("svc.chat_models_http", { status: 500 }) },
      ["is-failed"],
    ],
    ["no_list", "no_list", { want: t("svc.chat_models_no_list") }, []],
    ["malformed", "malformed", { want: t("svc.chat_models_malformed") }, ["is-failed"]],
  ])("maps %s", (_name, kind, ctx, dot) => {
    const { want, ...rest } = ctx as { want?: string; typedModel?: string; defaultModel?: string };
    const view = modelStatusView({
      phase: phase(kind as "reading"),
      typedModel: rest.typedModel ?? "",
      defaultModel: rest.defaultModel,
      host: HOST,
    });
    expect(view.text).toBe(want);
    expect([...view.dot]).toEqual(dot);
  });

  it("matches the prefix rule case-sensitively", () => {
    const view = modelStatusView({
      phase: phase("ok"),
      typedModel: "A",
      defaultModel: undefined,
      host: HOST,
    });
    expect(view.text).toBe(t("svc.chat_models_absent", { model: "A" }));
  });
});
