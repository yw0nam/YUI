// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const { log } = vi.hoisted(() => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../logger", () => ({ createLogger: () => log }));

import { wireCspViolationLog } from "./csp-violation";

function violation(blockedURI: string): Event {
  return Object.assign(new Event("securitypolicyviolation"), {
    effectiveDirective: "connect-src",
    violatedDirective: "connect-src",
    blockedURI,
    disposition: "enforce",
  });
}

it.each([
  {
    blockedURI: "https://api.example.com:8443/v1/chat?key=secret",
    origin: "https://api.example.com:8443",
  },
  { blockedURI: "inline", origin: "inline" },
])("logs csp_violation with the blocked origin only ($origin)", ({ blockedURI, origin }) => {
  const dispose = wireCspViolationLog();
  window.dispatchEvent(violation(blockedURI));
  dispose();
  window.dispatchEvent(violation(blockedURI));

  expect(log.warn).toHaveBeenCalledOnce();
  expect(log.warn).toHaveBeenCalledWith("csp_violation", {
    effective_directive: "connect-src",
    violated_directive: "connect-src",
    blocked_origin: origin,
    disposition: "enforce",
  });
});
