/**
 * 논리 에셋 경로(`/configs`, `/vrms/x.vrm`, `/references/…`)를 런타임 환경에 맞는 URL로 변환한다.
 *
 * dev/브라우저는 입력을 그대로 통과시켜 vite 정적 서빙을 보존한다. Tauri 패키징은
 * 선행 슬래시를 떼 resource-relative 경로로 resolveResource → convertFileSrc해 번들 리소스의
 * webview-fetchable 절대 URL을 만든다. 번들 매핑은 src-tauri/tauri.conf.json `bundle.resources`가
 * `configs/`·`vrms/`·`references/`를 resource 루트에 그대로 두는 것에 맞춘다.
 *
 * Tauri API는 주입 가능 — 테스트는 실제 @tauri-apps/api를 타지 않고 분기만 검증한다.
 */

/** Tauri 번들 리소스 해석에 필요한 최소 API 표면. */
export interface TauriAssetApi {
  resolveResource(path: string): Promise<string>;
  convertFileSrc(path: string): string;
}

export interface ResolveAssetUrlOptions {
  /** Tauri 런타임 판별. 기본은 globalThis.__TAURI_INTERNALS__ 존재 여부. */
  isTauri?: () => boolean;
  /** Tauri API 로더(주입 가능). 기본은 @tauri-apps/api에서 동적 import. */
  tauri?: () => Promise<TauriAssetApi>;
}

function defaultIsTauri(): boolean {
  return !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

async function defaultTauri(): Promise<TauriAssetApi> {
  const [{ resolveResource }, { convertFileSrc }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/api/core"),
  ]);
  return { resolveResource, convertFileSrc };
}

/** http(s)/asset/blob/data 등 이미 절대 스킴이면 변환 대상이 아니다. */
function isAbsoluteUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
}

/** "/configs/x.json?t=1" → { rel: "configs/x.json", query: "?t=1" }. */
function splitPath(logicalPath: string): { rel: string; query: string } {
  const qIdx = logicalPath.indexOf("?");
  const query = qIdx >= 0 ? logicalPath.slice(qIdx) : "";
  const noQuery = qIdx >= 0 ? logicalPath.slice(0, qIdx) : logicalPath;
  return { rel: noQuery.replace(/^\/+/, ""), query };
}

/**
 * 논리 경로를 현재 런타임의 fetchable URL로 변환한다.
 * dev/브라우저: 입력 그대로. Tauri: 번들 리소스 절대 URL(쿼리 보존).
 * 이미 절대 URL이면 어느 환경이든 그대로 둔다.
 */
export async function resolveAssetUrl(
  logicalPath: string,
  opts: ResolveAssetUrlOptions = {},
): Promise<string> {
  const isTauri = opts.isTauri ?? defaultIsTauri;
  if (!isTauri() || isAbsoluteUrl(logicalPath)) return logicalPath;

  const tauri = await (opts.tauri ?? defaultTauri)();
  const { rel, query } = splitPath(logicalPath);
  const abs = await tauri.resolveResource(rel);
  return tauri.convertFileSrc(abs) + query;
}

/**
 * 임포트된 VRM의 절대 app-data 파일 경로를 webview가 로드 가능한 URL로 변환한다.
 * 번들 리소스가 아니므로 resolveResource를 거치지 않고 convertFileSrc만 적용한다.
 * dev/브라우저거나 이미 절대 URL이면 입력 그대로 통과.
 */
export async function resolveUserFileSrc(
  absPath: string,
  opts: ResolveAssetUrlOptions = {},
): Promise<string> {
  const isTauri = opts.isTauri ?? defaultIsTauri;
  if (!isTauri() || isAbsoluteUrl(absPath)) return absPath;
  const tauri = await (opts.tauri ?? defaultTauri)();
  return tauri.convertFileSrc(absPath);
}
