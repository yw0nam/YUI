/** Config load/validation failure. Always states which file and what is wrong (fail-loud). */
export class ConfigError extends Error {
  readonly file: string;
  readonly issues: string[];
  constructor(file: string, issues: string[]) {
    super(`[config] ${file}: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.file = file;
    this.issues = issues;
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Throws a ConfigError if there is at least one issue. */
export function assertValid(file: string, issues: string[]): void {
  if (issues.length > 0) throw new ConfigError(file, issues);
}
