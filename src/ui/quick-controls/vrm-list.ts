/** VRM 목록 클러스터 — 캐릭터 탭의 VRM 라디오그룹 렌더·이름편집·임포트·스왑·키보드. */
import type { AvatarOption } from "../../config/load";
import type { createVrmSelection } from "../../io/vrm-selection";
import type { Logger } from "../../logger";
import { t } from "../i18n";

const VRM_RENAME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const VRM_REMOVE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

export interface VrmListDeps {
  /** 패널 루트(el) — .yui-vrms / .yui-vrm__import-error를 여기서 쿼리한다. */
  root: HTMLElement;
  vrmSelection: ReturnType<typeof createVrmSelection>;
  /** 실제 스왑 수행 + 성공 시 store 커밋. 컴포넌트는 store.select를 직접 호출하지 않는다. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** 파일 선택 → 로드 → addUserOption + 선택까지의 전체 임포트 흐름. reject 시 인라인 에러. */
  importVrm: () => Promise<void>;
  /** 임포트된 VRM의 app-data 파일을 삭제(idempotent). store 제거와 별개로 호출한다. */
  removeUserVrm: (id: string) => Promise<void>;
  log: Logger;
}

export interface VrmList {
  render(): void;
  handleKeydown(e: KeyboardEvent): void;
  handleAddClick(): void;
  /** 스왑 진행 중 여부 — 엔트리의 open-subscription 가드가 쓴다. */
  isSwapping(): boolean;
}

export function createVrmList(deps: VrmListDeps): VrmList {
  const { vrmSelection, swapVrm, importVrm, removeUserVrm, log } = deps;
  const vrmsEl = deps.root.querySelector<HTMLDivElement>(".yui-vrms")!;
  const vrmImportErrorEl = deps.root.querySelector<HTMLParagraphElement>(".yui-vrm__import-error")!;

  // 스왑 진행 중인 id(중복 스왑 가드) · 직전 오류 행 id(다시 그릴 때 인라인 안내 유지).
  let vrmSwapping: string | null = null;
  let vrmErrorId: string | null = null;
  // 마지막으로 화살표가 머문 행 id — 재그림이 roving tabindex를 active로 되돌리지 않게 유지.
  // close()에서 일부러 리셋하지 않는다 — 재오픈 시에도 머문 행을 잇고, ids.includes로 가드한다.
  let vrmRovedId: string | null = null;
  // 인라인 이름 편집 중인 user 옵션 id(없으면 null) · 임포트 진행 여부.
  let vrmRenamingId: string | null = null;
  let vrmImporting = false;

  function renderVrms(): void {
    const activeId = vrmSelection.getActiveId();
    const options = vrmSelection.list();
    // roving tabindex는 마지막으로 화살표가 머문 행이 우선 — 없으면 active로 폴백.
    const ids = options.map((o) => o.id);
    const rovedId = vrmRovedId !== null && ids.includes(vrmRovedId) ? vrmRovedId : activeId;
    // 더 이상 목록에 없는 행을 편집 중이었다면 편집 상태를 정리한다.
    if (vrmRenamingId !== null && !ids.includes(vrmRenamingId)) vrmRenamingId = null;
    // innerHTML 재그림이 포커스를 가진 행을 파괴한다 — 가졌던 경우에만 복원하려고 미리 기록.
    const hadFocus = vrmsEl.contains(document.activeElement);
    vrmsEl.innerHTML = "";
    for (const opt of options) {
      const isUser = opt.source === "user";
      const selected = opt.id === activeId;
      // user 행은 중첩 버튼/입력을 품으므로 div[role=radio]다(button 안의 button은 무효 HTML).
      const row = document.createElement(isUser ? "div" : "button");
      if (!isUser) (row as HTMLButtonElement).type = "button";
      row.setAttribute("role", "radio");
      row.className = "yui-vrm";
      row.dataset.vrmId = opt.id;
      row.setAttribute("aria-checked", String(selected));
      row.tabIndex = opt.id === rovedId ? 0 : -1;

      if (isUser && opt.id === vrmRenamingId) {
        renderRenamingRow(row, opt);
      } else {
        const badgeHtml = selected ? `<span class="yui-vrm__badge">${t("vrm.in_use")}</span>` : "";
        const actionsHtml = isUser
          ? `<button class="yui-vrm__rename" type="button" title="${t("vrm.rename")}" aria-label="${t("vrm.rename")}">${VRM_RENAME_SVG}</button>` +
            `<button class="yui-vrm__remove" type="button" title="${t("vrm.remove")}" aria-label="${t("vrm.remove")}">${VRM_REMOVE_SVG}</button>`
          : "";
        row.innerHTML = `
          <span class="yui-vrm__tick" aria-hidden="true"></span>
          <span class="yui-vrm__body"><span class="yui-vrm__name"></span></span>
          ${actionsHtml}
          ${badgeHtml}
        `;
        // 라벨은 신뢰 불가 입력일 수 있다 — textContent로만 넣는다.
        row.querySelector<HTMLSpanElement>(".yui-vrm__name")!.textContent = opt.label;
        row.addEventListener("click", () => {
          void swapTo(opt);
        });
        if (isUser) {
          row
            .querySelector<HTMLButtonElement>(".yui-vrm__rename")!
            .addEventListener("click", (e) => {
              e.stopPropagation(); // 이름 편집은 행 선택을 트리거하지 않는다
              startRename(opt.id);
            });
          row
            .querySelector<HTMLButtonElement>(".yui-vrm__remove")!
            .addEventListener("click", (e) => {
              e.stopPropagation(); // 삭제는 행 선택을 트리거하지 않는다
              void removeUserOption(opt.id);
            });
        }
      }

      vrmsEl.appendChild(row);

      // 직전 오류 행이면 비활성으로 다시 그린 뒤 인라인 안내를 그 아래에 붙인다.
      if (opt.id === vrmErrorId) {
        row.classList.add("is-error");
        row.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-vrm__error";
        err.setAttribute("role", "status");
        err.textContent = t("vrm.swap_error");
        vrmsEl.appendChild(err);
      }
    }

    // 임포트 진행 중이면 목록 끝에 스피너 placeholder 행을 붙인다(라디오 아님).
    if (vrmImporting) {
      const loading = document.createElement("div");
      loading.className = "yui-vrm__loading";
      loading.setAttribute("role", "status");
      loading.innerHTML = `<span class="yui-vrm__spin" aria-hidden="true"></span><span class="yui-vrm__loading-name">${t("vrm.loading")}</span>`;
      vrmsEl.appendChild(loading);
    }

    // 편집 중이면 입력에 포커스를 두고 종료한다(roving 포커스 복원보다 우선).
    if (vrmRenamingId !== null) {
      const input = vrmsEl.querySelector<HTMLInputElement>(".yui-vrm--renaming .yui-ep-input");
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }

    // 재그림 전 라디오그룹이 포커스를 쥐고 있었다면 roving 행으로 포커스를 잇는다.
    if (hadFocus) {
      const roved = vrmRowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  // user 행을 인라인 이름 편집 모드로 그린다 — 라벨이 입력으로 바뀌고 hint가 뒤따른다.
  function renderRenamingRow(row: HTMLElement, opt: AvatarOption): void {
    row.classList.add("yui-vrm--renaming");
    row.innerHTML = `
      <span class="yui-vrm__tick" aria-hidden="true"></span>
      <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t("vrm.name_aria")}" /></span>
      <span class="yui-vrm__rename-hint"><kbd>Enter</kbd> ${t("vrm.rename_hint_save")} · <kbd>Esc</kbd> ${t("vrm.rename_hint_cancel")}</span>
    `;
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = opt.label;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename(opt.id, input.value);
      } else if (e.key === "Escape") {
        // Esc는 이름 편집만 취소한다 — 패널 닫기(document Escape)로 새지 않게 막는다.
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });
    // blur로 빠져나가면 비어있지 않은 값을 커밋한다.
    input.addEventListener("blur", () => {
      if (vrmRenamingId !== opt.id) return; // 이미 commit/cancel로 정리됨
      commitRename(opt.id, input.value);
    });
  }

  function startRename(id: string): void {
    vrmRenamingId = id;
    renderVrms();
  }

  function cancelRename(): void {
    if (vrmRenamingId === null) return;
    vrmRenamingId = null;
    renderVrms();
  }

  function commitRename(id: string, label: string): void {
    if (vrmRenamingId !== id) return;
    vrmRenamingId = null;
    // 빈/공백 label은 store가 거부한다(기존 라벨 유지). 변경 시 store 구독이 재그림.
    vrmSelection.renameUserOption(id, label);
    log.info("vrm_rename", { id });
    renderVrms();
  }

  // user 옵션 제거 — 파일을 먼저 지우고(성공해야 store/disk 불일치 없음), 그 다음에만
  // store에서 빼고 active였으면 fallback으로 스왑한다.
  async function removeUserOption(id: string): Promise<void> {
    const wasActive = vrmSelection.getActiveId() === id;
    log.info("vrm_delete", { id });
    try {
      await removeUserVrm(id);
    } catch (err) {
      // 파일 삭제 실패 — store 제거를 커밋하지 않고 행을 그대로 둔다(disk와 일치 유지).
      log.error("vrm_delete_failed", { id, error: String(err) });
      return;
    }
    vrmSelection.removeUserOption(id); // active였으면 default로 폴백 + 통지
    // 비-active 제거는 store가 통지하지 않으므로 목록을 직접 다시 그린다.
    if (!wasActive) {
      renderVrms();
      return;
    }
    // active를 지웠으면 폴백 옵션을 렌더러에 로드한다(store는 이미 default를 가리킴).
    try {
      await swapVrm(vrmSelection.getActive());
    } catch (err) {
      log.error("vrm_fallback_swap_failed", { error: String(err) });
      renderVrms(); // 스왑 실패 시 목록을 실제 상태에 맞춰 다시 그린다.
    }
  }

  function setImportError(show: boolean): void {
    vrmImportErrorEl.hidden = !show;
  }

  // "파일에서 추가…" — importing 행을 띄우고 전체 임포트 흐름을 위임한다.
  // 성공 시 store가 행을 추가하고(구독→재그림), 실패 시 인라인 에러를 띄운다.
  async function importVrmFlow(): Promise<void> {
    if (vrmImporting) return; // 진행 중엔 두 번째 임포트 금지
    vrmImporting = true;
    setImportError(false);
    renderVrms();
    try {
      await importVrm();
    } catch (err) {
      setImportError(true);
      log.error("vrm_import_failed", { error: String(err) });
    } finally {
      vrmImporting = false;
      renderVrms();
    }
  }

  function vrmRowById(id: string): HTMLElement | null {
    return vrmsEl.querySelector<HTMLElement>(`.yui-vrm[data-vrm-id="${CSS.escape(id)}"]`);
  }

  async function swapTo(option: AvatarOption): Promise<void> {
    if (vrmSwapping !== null) return; // 진행 중엔 두 번째 스왑 금지
    if (option.id === vrmSelection.getActiveId()) return; // 이미 active면 no-op

    // 직전 오류 표시가 있으면 그것만 먼저 지운다(목록 재그림으로 인라인 안내 제거).
    if (vrmErrorId !== null) {
      vrmErrorId = null;
      renderVrms();
    }
    vrmSwapping = option.id;

    // 로딩 반영: 클릭 행에 "바꾸는 중…" + 스피너, 그룹은 busy로 잠근다.
    // 행을 in-place로 변형해 호출부가 쥔 노드 참조를 유지한다(재그림 안 함).
    vrmsEl.setAttribute("aria-busy", "true");
    vrmsEl.classList.add("is-swapping");
    const row = vrmRowById(option.id);
    if (row) {
      row.setAttribute("aria-busy", "true");
      const body = row.querySelector(".yui-vrm__body");
      if (body && !row.querySelector(".yui-vrm__hint")) {
        const hint = document.createElement("span");
        hint.className = "yui-vrm__hint";
        hint.textContent = t("vrm.swapping");
        body.insertAdjacentElement("afterend", hint);
      }
    }

    try {
      await swapVrm(option);
      vrmRovedId = option.id; // 커밋된 행으로 roving tabindex를 잇는다
      log.info("vrm_swap", { id: option.id });
      // 성공: swapVrm이 store를 커밋했고 구독이 active 행을 옮긴다. 잠금 해제 후 재그림.
    } catch (err) {
      vrmErrorId = option.id;
      log.error("vrm_swap_failed", { id: option.id, error: String(err) });
      // 실패: 선택은 그대로(revert는 store가 바뀌지 않아 자동). 오류 행 + 인라인 안내.
    } finally {
      vrmSwapping = null;
      vrmsEl.removeAttribute("aria-busy");
      vrmsEl.classList.remove("is-swapping");
      renderVrms();
    }
  }

  // VRM radiogroup 키보드 — 화자 섹션과 동일한 manual-activation.
  // Enter/Space는 선택(스왑), 화살표는 roving focus 이동만(래핑), Home/End는 양끝.
  function handleVrmKeydown(e: KeyboardEvent): void {
    if (vrmSwapping !== null) return;
    // 인라인 이름 편집 입력의 키는 입력 자체가 처리한다 — 라디오 키보드로 새지 않게 막는다.
    if ((e.target as HTMLElement).closest(".yui-vrm--renaming")) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(".yui-vrm[role=radio]");
    if (!target) return;
    const rows = Array.from(vrmsEl.querySelectorAll<HTMLElement>(".yui-vrm[role=radio]"));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = vrmSelection.list().find((o) => o.id === target.dataset.vrmId);
      if (opt) void swapTo(opt);
      return;
    }

    const current = Math.max(0, rows.indexOf(target));
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const wrapped = (next + rows.length) % rows.length;
    const focusTarget = rows[wrapped];
    vrmRovedId = focusTarget.dataset.vrmId ?? null;
    for (const r of rows) r.tabIndex = -1;
    focusTarget.tabIndex = 0;
    focusTarget.focus();
    focusTarget.scrollIntoView?.({ block: "nearest" });
  }

  function handleAddClick(): void {
    void importVrmFlow();
  }

  return {
    render: renderVrms,
    handleKeydown: handleVrmKeydown,
    handleAddClick,
    isSwapping: () => vrmSwapping !== null,
  };
}
