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
  /** dev(vite 라이브 서빙) 판별. 기본 import.meta.env.DEV. dev면 resource 재작성을 건너뛴다. */
  isDev?: () => boolean;
  /** Tauri API 로더(주입 가능). 기본은 @tauri-apps/api에서 동적 import. */
  tauri?: () => Promise<TauriAssetApi>;
}

function defaultIsTauri(): boolean {
  return !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

function defaultIsDev(): boolean {
  return !!import.meta.env?.DEV;
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

/** convertFileSrc/dev에서 정당하게 오는, webview가 로드 가능한 src 스킴. */
const SAFE_USER_SRC_SCHEME = /^(asset|blob|https?):/i;
/** asset src로 통과시키면 안 되는 위험 스킴. */
const DANGEROUS_SCHEME = /^(javascript|data|file|vbscript):/i;
/** 단일 글자 드라이브(예: "C:\…")는 스킴이 아니라 Windows 절대 경로다. */
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

/** "/configs/x.json?t=1" → { rel: "configs/x.json", query: "?t=1" }. */
function splitPath(logicalPath: string): { rel: string; query: string } {
  const qIdx = logicalPath.indexOf("?");
  const query = qIdx >= 0 ? logicalPath.slice(qIdx) : "";
  const noQuery = qIdx >= 0 ? logicalPath.slice(0, qIdx) : logicalPath;
  return { rel: noQuery.replace(/^\/+/, ""), query };
}

/**
 * 논리 경로를 현재 런타임의 fetchable URL로 변환한다.
 * dev(브라우저·Tauri dev 모두, vite 라이브 서빙): 입력 그대로 → 핫리로드 보존.
 * prod Tauri 패키징: 번들 리소스 절대 URL(쿼리 보존). 이미 절대 URL이면 어느 환경이든 그대로 둔다.
 */
export async function resolveAssetUrl(
  logicalPath: string,
  opts: ResolveAssetUrlOptions = {},
): Promise<string> {
  const isTauri = opts.isTauri ?? defaultIsTauri;
  const isDev = opts.isDev ?? defaultIsDev;
  if (!isTauri() || isDev() || isAbsoluteUrl(logicalPath)) return logicalPath;

  const tauri = await (opts.tauri ?? defaultTauri)();
  const { rel, query } = splitPath(logicalPath);
  const abs = await tauri.resolveResource(rel);
  return tauri.convertFileSrc(abs) + query;
}

/**
 * 임포트된 VRM/음성의 app-data 파일 경로를 webview가 로드 가능한 URL로 변환한다.
 * convertFileSrc/dev에서 오는 known-safe 스킴(asset/blob/http(s))만 그대로 통과시키고,
 * 위험 스킴(javascript/data/file/vbscript)은 사용 불가 src로 빈 문자열을 돌려 차단한다.
 * 스킴 없는 절대 경로와 Windows 드라이브 경로는 (Tauri에서) convertFileSrc로 변환한다.
 * 사용 불가 입력의 빈 문자열은 호출부(렌더러 로드/voice 등록)에서 실패로 처리된다.
 */
export async function resolveUserFileSrc(
  absPath: string,
  opts: ResolveAssetUrlOptions = {},
): Promise<string> {
  if (DANGEROUS_SCHEME.test(absPath)) return "";
  if (SAFE_USER_SRC_SCHEME.test(absPath)) return absPath; // 이미 fetchable — 재변환 금지
  const isTauri = opts.isTauri ?? defaultIsTauri;
  // 스킴이 붙었지만 안전 목록·드라이브 경로 어디에도 없으면 정체불명 — 차단한다.
  if (isAbsoluteUrl(absPath) && !WINDOWS_DRIVE.test(absPath)) return "";
  if (!isTauri()) return absPath; // dev/브라우저: 절대 fs 경로 그대로 서빙
  const tauri = await (opts.tauri ?? defaultTauri)();
  return tauri.convertFileSrc(absPath);
}
