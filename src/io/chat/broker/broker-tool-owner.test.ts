import { describe, expect, it } from "vitest";
import type { EndpointsConfig } from "../../../contract";
import { createClientToolRegistry } from "../stream/client-tools";
import { clientToolsUnlessBrokered } from "./broker-tool-owner";

const registry = createClientToolRegistry([]);
const endpoints = (over: Partial<EndpointsConfig>): EndpointsConfig => ({
  chat_base_url: "http://localhost:8643/v1",
  stt_base_url: "",
  tts_base_url: "",
  ...over,
});

describe("clientToolsUnlessBrokered", () => {
  it("declares the client's tools on Responses when no broker URL is set", () => {
    expect(clientToolsUnlessBrokered(endpoints({ chat_api: "responses" }), registry)).toBe(
      registry,
    );
    expect(
      clientToolsUnlessBrokered(
        endpoints({ chat_api: "responses", broker_base_url: " " }),
        registry,
      ),
    ).toBe(registry);
  });

  it("leaves the tool to the broker's backend on Responses while a broker URL is set", () => {
    const eff = endpoints({ chat_api: "responses", broker_base_url: "http://localhost:3201/mcp" });
    expect(clientToolsUnlessBrokered(eff, registry)).toBeUndefined();
    expect(
      clientToolsUnlessBrokered(endpoints({ broker_base_url: "http://b/mcp" }), registry),
    ).toBeUndefined();
  });

  it("keeps the client's tools on Chat Completions whatever the broker setting", () => {
    const eff = endpoints({ chat_api: "chat_completions", broker_base_url: "http://b/mcp" });
    expect(clientToolsUnlessBrokered(eff, registry)).toBe(registry);
  });
});
