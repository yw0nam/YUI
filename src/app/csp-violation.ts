import { createLogger } from "../logger";

const log = createLogger("csp-violation");

/** Logs every Content-Security-Policy violation the window reports; returns the disposer. */
export function wireCspViolationLog(): () => void {
  const onViolation = (e: SecurityPolicyViolationEvent): void => {
    log.warn("csp_violation", {
      effective_directive: e.effectiveDirective,
      violated_directive: e.violatedDirective,
      blocked_origin: originOf(e.blockedURI),
      disposition: e.disposition,
    });
  };
  window.addEventListener("securitypolicyviolation", onViolation);
  return () => window.removeEventListener("securitypolicyviolation", onViolation);
}

/** A URL's origin; a keyword such as `inline` or `eval` passes through. */
function originOf(blockedURI: string): string {
  try {
    return new URL(blockedURI).origin;
  } catch {
    return blockedURI;
  }
}
