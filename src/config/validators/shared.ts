/** config 로드/검증 실패. 항상 어떤 파일의 무엇이 잘못됐는지 명시한다(fail-loud). */
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

/** issues가 하나라도 있으면 ConfigError로 던진다. */
export function assertValid(file: string, issues: string[]): void {
  if (issues.length > 0) throw new ConfigError(file, issues);
}
