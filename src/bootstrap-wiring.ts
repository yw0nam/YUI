/** Bootstrap wiring helpers extracted from main.ts: VRM + speaker selection stores and their swap/import flows. */
import { resolveAssetUrl, resolveUserFileSrc } from "./io/asset-url";
import { selectFetch } from "./io/chat-client";
import { ensureRegistered, updateVoice } from "./io/irodori-voices";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import {
  importVoiceFromFile,
  removeOrphanVoice,
  removeUserVoice as removeUserVoiceFile,
} from "./io/voice-import";
import { importVrmFromFile, removeOrphanVrm, removeUserVrm } from "./io/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./io/vrm-selection";
import type { Logger } from "./logger";
import type { Renderer, VrmLoadResult } from "./renderer";

export function wireVrmSelection(deps: {
  renderer: Renderer;
  log: Logger;
  broadcastSettings: () => void;
}): {
  vrmSelection: ReturnType<typeof createVrmSelection>;
  loadVrmSerialized: (url: string) => Promise<VrmLoadResult>;
  swapVrm: (option: { id: string; url: string }) => Promise<void>;
  importVrm: () => Promise<void>;
} {
  const { renderer, log, broadcastSettings } = deps;
  // VRM 선택 store + 스왑. 펫 창은 renderer-backed: loadVRM 성공 시에만 store 커밋.
  // config 로드 전이라 fallback default로 시작 — 패널이 일찍 필요하기 때문. config 로드 후
  // setManifest로 실제 available[]를 주입한다(아래 부트 시퀀스).
  const vrmSelection = createVrmSelection({
    defaultUrl: "/vrms/carlotta.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  // 단일 직렬 스왑 경로: 사용자 스왑·부트·config 핫리로드·크로스윈도우가 모두 이 체인을
  // 통과한다. loadVRM은 재진입 안전하지 않으므로 직렬화하되, 실패는 호출자에게 전파한다.
  let vrmSwap: Promise<unknown> = Promise.resolve();
  function loadVrmSerialized(url: string): Promise<VrmLoadResult> {
    // 논리 경로(/vrms/*.vrm)를 런타임 URL로 변환 — dev passthrough, Tauri 번들 리소스 절대 URL.
    const next = vrmSwap.then(async () => renderer.loadVRM(await resolveAssetUrl(url)));
    vrmSwap = next.catch(() => {}); // 체인은 실패해도 살려두고
    return next; // 이 호출자에게만 reject를 전파한다.
  }
  // 로드 성공 시에만 store 커밋. 실패하면 await가 throw → store 미커밋(UI가 에러+자동 복구).
  const swapVrm = async (option: { id: string; url: string }): Promise<void> => {
    await loadVrmSerialized(option.url);
    vrmSelection.select(option.id);
  };
  // BYO-VRM 임포트: 파일 선택 → 복사 → 로드 → (메타 이름이 있으면 그걸로 라벨) → 옵션 추가 + 선택.
  // 취소(null)는 조용히 무시. 로드 실패면 고아 파일을 지우고 옵션은 추가하지 않은 채 throw한다
  // (직전 선택/렌더러는 그대로 — 로드가 currentVrm 교체 전에 실패하므로 복구 불필요).
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile();
    if (option === null) return; // 취소
    let metaName: string | null;
    try {
      const src = await resolveUserFileSrc(option.url);
      ({ metaName } = await loadVrmSerialized(src));
    } catch (err) {
      // 고아 사본 제거 — 실패하면 삼키지 말고 경고로 드러낸다(원본 에러는 그대로 throw).
      await removeOrphanVrm(option.id, removeUserVrm, (e) =>
        log.warn("orphan_vrm_cleanup_failed", { error: String(e) }),
      );
      log.error("imported_vrm_load_failed", { error: String(err) });
      throw err;
    }
    const labelled = metaName ? { ...option, label: metaName } : option;
    vrmSelection.addUserOption(labelled);
    vrmSelection.select(labelled.id);
  };
  // 이 창에서 고른 VRM을 설정 창 UI에 반영하기 위해 cross-window로 알린다(루프 가드는 broadcastSettings).
  vrmSelection.subscribe(broadcastSettings);
  return { vrmSelection, loadVrmSerialized, swapVrm, importVrm };
}

export function wireSpeakerSelection(deps: {
  getEndpoints: () => { irodori_base_url?: string };
  log: Logger;
  broadcastSettings: () => void;
}): {
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  importVoice: () => Promise<void>;
} {
  const { getEndpoints, log, broadcastSettings } = deps;
  // irodori 화자 선택 store. config 로드 전이라 빈 fallback으로 시작 — 패널이 일찍
  // 필요하기 때문. config 로드 후 setManifest로 실제 irodori_voices·default를 주입한다.
  const speakerSelection = createSpeakerSelection({
    defaultId: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  // 선택 → irodori voice registry 등록 후 store 커밋(swapVrm의 load-then-select 미러).
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    const f = await selectFetch();
    const eps = getEndpoints();
    if (eps.irodori_base_url) {
      await ensureRegistered({
        baseUrl: eps.irodori_base_url,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    }
    speakerSelection.select(option.id);
  };
  // 참조 음성 재등록(PUT /voices) — 서버 측 force-refresh만, 화자 선택은 바꾸지 않는다.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const f = await selectFetch();
    const eps = getEndpoints();
    if (!eps.irodori_base_url) throw new Error("irodori provider requires irodori_base_url");
    await updateVoice({
      baseUrl: eps.irodori_base_url,
      id: option.id,
      refUrl: option.ref_url,
      fetch: f,
    });
  };
  // BYO-voice 임포트: 파일 선택 → 복사 → irodori 등록 → 옵션 추가 + 선택(swapSpeaker의 register-then-select 미러).
  // 취소(null)는 조용히 무시. 등록 실패(서버 다운/사용 불가 클립)면 고아 사본을 지우고 옵션은
  // 추가하지 않은 채 throw한다 — 직전 선택은 그대로(등록이 store 커밋 전에 실패하므로 복구 불필요).
  const importVoice = async (): Promise<void> => {
    const option = await importVoiceFromFile();
    if (option === null) return; // 취소
    try {
      const f = await selectFetch();
      const eps = getEndpoints();
      if (!eps.irodori_base_url) throw new Error("irodori provider requires irodori_base_url");
      // ref_url은 asset:// URL — resolveRef가 그대로 통과시켜 클립을 POST한다.
      await ensureRegistered({
        baseUrl: eps.irodori_base_url,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    } catch (err) {
      // 고아 사본 제거 — 실패하면 삼키지 말고 경고로 드러낸다(원본 에러는 그대로 throw).
      await removeOrphanVoice(option.id, removeUserVoiceFile, (e) =>
        log.warn("orphan_voice_cleanup_failed", { error: String(e) }),
      );
      log.error("imported_voice_register_failed", { error: String(err) });
      throw err;
    }
    speakerSelection.addUserVoice(option);
    speakerSelection.select(option.id);
  };
  // 이 창에서 고른 화자를 설정 창 UI에 반영하기 위해 cross-window로 알린다.
  speakerSelection.subscribe(broadcastSettings);
  return { speakerSelection, swapSpeaker, refreshSpeaker, importVoice };
}
