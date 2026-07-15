/**
 * Popover 셸 — 우클릭 소환 패널의 위치·드래그·open/close 라이프사이클.
 * variant="popover"는 펫 창 안에 도킹(드래그·scrim·뷰포트 클램프),
 * variant="window"는 OS 창을 채운다(드래그·scrim·애니메이션 없음, 항상 표시).
 * 내용 갱신(reflect/render/monitor)은 onOpen 콜백, 게인·audition·키 커밋 정리는 onClose 콜백에 위임한다.
 */

import { localStorageStore } from "../../io/persisted-store";

const VIEWPORT_MARGIN = 12;
const POS_KEY = "yui.quick.pos";

interface SavedPos {
  x: number;
  y: number;
}

const posStore = localStorageStore<SavedPos>(POS_KEY);

function loadSavedPos(): SavedPos | null {
  const parsed = posStore.load();
  if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
  if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
  return { x: parsed.x, y: parsed.y };
}

function savePos(pos: SavedPos): void {
  posStore.save(pos);
}

export interface PopoverDeps {
  /** scrim·패널을 붙일 마운트 컨테이너. */
  mount: HTMLElement;
  /** 패널 루트 노드(el). */
  root: HTMLElement;
  /** 바깥 클릭 감지 scrim(popover variant 전용). */
  scrim: HTMLElement;
  /** 드래그 핸들 바 — window variant에선 없다(null). */
  bar: HTMLElement | null;
  /** window variant면 드래그·scrim·애니메이션 없이 OS 창을 채운다. */
  isWindow: boolean;
  /** window variant 전용 — Escape가 OS 창을 닫아야 할 때 호스트가 주입한다. 없으면 Escape는 no-op. */
  closeWindow?: () => void;
  /** 열릴 때 내용 갱신(reflect/render/monitor 로드). 위치 계산 전에 호출된다(치수 확정). */
  onOpen: () => void;
  /** 닫힐 때 정리(게인 프리뷰·audition·키 커밋). openState=false 전에 호출된다. */
  onClose: () => void;
}

export interface Popover {
  open(anchor?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createPopover(deps: PopoverDeps): Popover {
  const { mount, root, scrim, bar, isWindow, closeWindow, onOpen, onClose } = deps;

  let openState = false;
  let closeRafId: number | null = null;
  // popover variant에서 open 직전 포커스를 기억했다가 close 시 복원한다.
  let prevFocus: HTMLElement | null = null;

  const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    // [hidden] 서브트리(비활성 탭 패널 등)의 컨트롤은 제외한다 — 트랩이 안 보이는 끝으로 새지 않게.
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)).filter(
      (el) => !(el as HTMLButtonElement).disabled && !el.closest("[hidden]"),
    );
  }

  function focusFirst(): void {
    focusables()[0]?.focus();
  }

  // ── 위치 계산 (popover variant) ──

  function clampToViewport(x: number, y: number): { x: number; y: number } {
    const rect = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - VIEWPORT_MARGIN) nx = vw - VIEWPORT_MARGIN - rect.width;
    if (nx < VIEWPORT_MARGIN) nx = VIEWPORT_MARGIN;
    if (ny + rect.height > vh - VIEWPORT_MARGIN) ny = vh - VIEWPORT_MARGIN - rect.height;
    if (ny < VIEWPORT_MARGIN) ny = VIEWPORT_MARGIN;
    return { x: nx, y: ny };
  }

  function placeAt(x: number, y: number): void {
    root.style.removeProperty("bottom");
    root.style.transform = "";
    const c = clampToViewport(x, y);
    root.style.left = `${c.x}px`;
    root.style.top = `${c.y}px`;
  }

  function placeFallback(): void {
    root.style.removeProperty("left");
    root.style.removeProperty("top");
    root.style.left = "50%";
    root.style.bottom = "9%";
    root.style.transform = "translate(-50%, 0)";
  }

  function positionPopover(anchor?: { x: number; y: number }): void {
    // 우선순위: 저장 위치 > 커서 앵커 > 중앙 하단 fallback.
    const saved = loadSavedPos();
    if (saved) {
      placeAt(saved.x, saved.y);
      return;
    }
    if (anchor) {
      // 앵커 아래에 열되, 아래 공간이 없으면 위로(기존 동작 보존).
      const rect = root.getBoundingClientRect();
      const vh = window.innerHeight;
      let y = anchor.y;
      if (y + rect.height > vh - VIEWPORT_MARGIN) y = anchor.y - rect.height;
      placeAt(anchor.x, y);
      return;
    }
    placeFallback();
  }

  // ── 드래그 (popover variant) ──

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginLeft = 0;
  let dragOriginTop = 0;

  function handleBarPointerDown(e: PointerEvent): void {
    if (isWindow) return;
    if (e.button !== 0) return;
    // 헤더의 버튼(팝아웃·닫기) 클릭은 드래그로 취급하지 않는다.
    if ((e.target as HTMLElement).closest(".yui-iconbtn")) return;
    dragging = true;
    // 도킹 중에는 left/top을 수치로 직접 제어하므로 그 값을 출발점으로 삼는다.
    // (스타일 미설정 시에만 레이아웃 rect로 폴백.)
    const styleLeft = parseFloat(root.style.left);
    const styleTop = parseFloat(root.style.top);
    if (Number.isFinite(styleLeft) && Number.isFinite(styleTop)) {
      dragOriginLeft = styleLeft;
      dragOriginTop = styleTop;
    } else {
      const rect = root.getBoundingClientRect();
      dragOriginLeft = rect.left;
      dragOriginTop = rect.top;
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    bar?.classList.add("is-dragging");
    document.addEventListener("pointermove", handleDocPointerMove);
    document.addEventListener("pointerup", handleDocPointerUp);
  }

  function handleDocPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    placeAt(dragOriginLeft + dx, dragOriginTop + dy);
  }

  function handleDocPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    bar?.classList.remove("is-dragging");
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
    const x = parseFloat(root.style.left);
    const y = parseFloat(root.style.top);
    if (Number.isFinite(x) && Number.isFinite(y)) savePos({ x, y });
  }

  // ── open / close ──

  function open(anchor?: { x: number; y: number }): void {
    if (openState) return;
    openState = true;

    if (closeRafId !== null) {
      cancelAnimationFrame(closeRafId);
      closeRafId = null;
    }

    if (!isWindow) mount.appendChild(scrim);
    mount.appendChild(root);

    // 내용 갱신(reflect/render/monitor)은 호스트가 onOpen으로 주입 — 위치 계산보다 먼저 끝내 치수를 확정한다.
    onOpen();

    if (isWindow) {
      // 창 variant는 OS 창을 채운다 — 위치 계산/애니메이션 없음.
      root.classList.add("is-open");
    } else {
      positionPopover(anchor);
    }

    if (!isWindow) {
      requestAnimationFrame(() => {
        root.classList.add("is-open");
      });
    }

    // 열기 직전 포커스를 기억(popover variant만 복원)하고 첫 컨트롤로 이동한다.
    prevFocus = isWindow ? null : (document.activeElement as HTMLElement | null);
    focusFirst();
  }

  function close(): void {
    if (!openState) return;
    onClose();
    openState = false;

    if (isWindow) {
      // 창 variant는 항상 보이므로 DOM에서 떼지 않는다.
      return;
    }

    root.classList.remove("is-open");

    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      root.removeEventListener("transitionend", onEnd);
      if (!root.classList.contains("is-open")) {
        root.remove();
        scrim.remove();
      }
    };
    root.addEventListener("transitionend", onEnd);

    closeRafId = requestAnimationFrame(() => {
      closeRafId = null;
      if (!openState && !root.classList.contains("is-open")) {
        root.remove();
        scrim.remove();
      }
    });

    // 포커스를 열기 전 요소로 되돌린다(아직 문서에 있을 때만).
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
    prevFocus = null;
  }

  function isOpen(): boolean {
    return openState;
  }

  function handleScrimPointerDown(e: PointerEvent): void {
    e.stopPropagation();
    close();
  }

  function handleDocKeydown(e: KeyboardEvent): void {
    if (!openState) return;
    if (e.key === "Escape") {
      if (isWindow) {
        // 창 variant는 내부 close()가 패널을 지우지 않는다(항상 표시) — OS 창 닫기는 호스트 몫.
        if (!closeWindow) return;
        e.preventDefault();
        close(); // 정리(키 커밋·audition 중단)를 먼저 수행한다.
        closeWindow();
        return;
      }
      e.preventDefault();
      close();
      return;
    }
    // popover variant 포커스 트랩 — Tab이 루트를 벗어나면 반대쪽 끝으로 감싼다.
    if (e.key === "Tab" && !isWindow) {
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!active || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  scrim.addEventListener("pointerdown", handleScrimPointerDown);
  document.addEventListener("keydown", handleDocKeydown);
  bar?.addEventListener("pointerdown", handleBarPointerDown);

  function dispose(): void {
    scrim.removeEventListener("pointerdown", handleScrimPointerDown);
    document.removeEventListener("keydown", handleDocKeydown);
    bar?.removeEventListener("pointerdown", handleBarPointerDown);
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
  }

  return { open, close, isOpen, dispose };
}
