import { afterEach, describe, expect, it, vi } from "vitest";
import { excludeOwnOriginFromCorsFetch } from "./own-origin-fetch";

type CorsFetchGlobal = { CORSFetch?: { config: (c: { exclude: RegExp[] }) => void } };

afterEach(() => {
  delete (globalThis as CorsFetchGlobal).CORSFetch;
});

function excludeFor(origin: string): RegExp {
  const config = vi.fn();
  (globalThis as CorsFetchGlobal).CORSFetch = { config };
  excludeOwnOriginFromCorsFetch(origin);
  expect(config).toHaveBeenCalledOnce();
  return config.mock.calls[0][0].exclude[0];
}

describe("excludeOwnOriginFromCorsFetch", () => {
  it("excludes bundled assets served from the Windows webview origin", () => {
    const exclude = excludeFor("http://tauri.localhost");

    expect(exclude.test("http://tauri.localhost/motions/idle_01.vrma")).toBe(true);
    expect(exclude.test("http://tauri.localhost/configs/motions.json?v=2")).toBe(true);
  });

  it("keeps every other origin on the CORS proxy", () => {
    const exclude = excludeFor("http://tauri.localhost");

    expect(exclude.test("http://tauri.localhost.example.com/motions/idle_01.vrma")).toBe(false);
    expect(exclude.test("http://localhost:8000/v1/chat/completions")).toBe(false);
    expect(exclude.test("https://api.openai.com/v1/chat/completions")).toBe(false);
  });

  it("treats the dots and port of the origin literally", () => {
    const exclude = excludeFor("http://localhost:1420");

    expect(exclude.test("http://localhost:1420/motions/idle_01.vrma")).toBe(true);
    expect(exclude.test("http://localhost:14200/motions/idle_01.vrma")).toBe(false);
    expect(exclude.test("http://localhostX1420/motions/idle_01.vrma")).toBe(false);
  });

  it("matches the origin case-insensitively", () => {
    const exclude = excludeFor("http://tauri.localhost");

    expect(exclude.test("http://TAURI.localhost/x")).toBe(true);
  });

  it("does nothing when the plugin is absent", () => {
    expect(() => excludeOwnOriginFromCorsFetch("http://localhost:1420")).not.toThrow();
  });

  it("does nothing when the window has no origin", () => {
    const config = vi.fn();
    (globalThis as CorsFetchGlobal).CORSFetch = { config };

    expect(() => excludeOwnOriginFromCorsFetch()).not.toThrow();
    expect(config).not.toHaveBeenCalled();
  });
});
