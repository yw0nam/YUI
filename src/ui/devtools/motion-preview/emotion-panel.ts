import type { EmotionId, EmotionRegistry } from "../../../contract";
import type { Renderer } from "../../../renderer";
import type { MotionPreviewView } from "./view";

// ─── Emotion display order (matches the emotion vocabulary) ─────────────
const EMOTION_ORDER: EmotionId[] = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "thinking",
  "curious",
  "sleepy",
  "embarrassed",
];

/** ID of the emotion the user last applied (or null if none applied yet). */
export interface ActiveEmotion {
  id: EmotionId | null;
}

/** Set the active row in the emotion list (independent of motion active state). */
function setActiveEmotionRow(emotionList: HTMLDivElement, id: EmotionId | null): void {
  const rows = emotionList.querySelectorAll<HTMLDivElement>(".motion-row");
  rows.forEach((row) => {
    const rowId = row.dataset.emotionId as EmotionId | undefined;
    const dot = row.querySelector<HTMLSpanElement>(".dot");
    if (rowId === id) {
      row.classList.add("state-playing");
      if (dot) dot.className = "dot dot-filled";
    } else {
      row.classList.remove("state-playing");
      if (dot) dot.className = "dot dot-hollow";
    }
  });
}

/**
 * Build the 10 emotion rows from the registry.
 * The `vrm_expression` hint shown per row is the *registry* mapping, NOT the
 * runtime-resolved key (renderer does not expose the resolved key).
 */
function buildEmotionList(
  emotionList: HTMLDivElement,
  emotionsRegistry: EmotionRegistry,
  doSetEmotion: (id: EmotionId) => void,
): void {
  emotionList.innerHTML = "";

  for (const id of EMOTION_ORDER) {
    const entry = emotionsRegistry[id];

    const row = document.createElement("div");
    row.className = "motion-row";
    row.dataset.emotionId = id;
    row.tabIndex = 0;
    row.setAttribute("role", "row");

    // Dot
    const dot = document.createElement("span");
    dot.className = "dot dot-hollow";

    // Name
    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = id;

    // Registry expression hint tag (registry mapping, not resolved key)
    const tags = document.createElement("div");
    tags.className = "row-tags";
    if (entry) {
      const tagExpr = document.createElement("span");
      tagExpr.className = "tag";
      tagExpr.textContent = entry.vrm_expression;
      tags.appendChild(tagExpr);
    }

    // Play button
    const playBtn = document.createElement("button");
    playBtn.className = "btn-play";
    playBtn.title = "set emotion";
    playBtn.setAttribute("aria-label", `Set emotion ${id}`);
    playBtn.textContent = "▶";

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(tags);
    row.appendChild(playBtn);
    emotionList.appendChild(row);

    // Row click / keyboard handler
    const handleSet = (): void => {
      doSetEmotion(id);
    };
    row.addEventListener("click", handleSet);
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSet();
      }
    });
    playBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      handleSet();
    });
  }
}

export function mountEmotionPanel(
  view: MotionPreviewView,
  renderer: Renderer,
  emotionsRegistry: EmotionRegistry,
  activeEmotion: ActiveEmotion,
): void {
  const { emotionList, slIntensity, slTransition, btnNeutral, btnHold } = view;

  // ─── Emotion helpers (close over emotionsRegistry + renderer) ───────────

  function doSetEmotion(id: EmotionId): void {
    renderer.setEmotion({
      id,
      intensity: parseFloat(slIntensity.value),
      transition_ms: parseInt(slTransition.value, 10),
    });
    activeEmotion.id = id;
    setActiveEmotionRow(emotionList, id);
  }

  // Build emotion rows from the emotion registry.
  buildEmotionList(emotionList, emotionsRegistry, doSetEmotion);

  // Wire emotion action buttons.
  // btn-neutral: the ONLY explicit-neutral path — always sets {id:"neutral"}.
  btnNeutral.addEventListener("click", () => {
    renderer.setEmotion({ id: "neutral" });
    activeEmotion.id = "neutral";
    setActiveEmotionRow(emotionList, "neutral");
  });

  // btn-hold: demonstrates the hold-on-null no-op (renderer keeps previous expression).
  btnHold.addEventListener("click", () => {
    renderer.setEmotion(null);
    // null is a no-op in the renderer — do not change activeEmotionId or row highlight.
  });
}
