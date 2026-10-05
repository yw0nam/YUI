import type { MotionKind, MotionRegistry } from "../../../contract";

// ─── Motion kind display order ────────────────────────────────────────────────
const KIND_ORDER: MotionKind[] = ["ambient", "reactive", "state", "oneshot"];

// ─── Registry list rendering ──────────────────────────────────────────────

/** Build the crossfade dropdown options from registry keys. */
export function buildCrossfadeOptions(
  selCrossfade: HTMLSelectElement,
  motionsRegistry: MotionRegistry,
): void {
  selCrossfade.innerHTML = "";
  for (const id of Object.keys(motionsRegistry)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    if (id === "idle") opt.selected = true;
    selCrossfade.appendChild(opt);
  }
}

/** Set the active row in the registry list. */
export function setActiveRow(registryList: HTMLDivElement, id: string | null): void {
  const rows = registryList.querySelectorAll<HTMLDivElement>(".motion-row");
  rows.forEach((row) => {
    const rowId = row.dataset.motionId;
    const dot = row.querySelector<HTMLSpanElement>(".dot");
    if (rowId === id) {
      row.classList.add("state-playing");
      if (dot) {
        dot.className = "dot dot-filled";
      }
    } else {
      row.classList.remove("state-playing");
      if (dot) {
        dot.className = "dot dot-hollow";
      }
    }
  });
}

/** Build the full registry list HTML grouped by kind. */
export function buildRegistryList(
  registryList: HTMLDivElement,
  motionsRegistry: MotionRegistry,
  doPlayById: (id: string) => void,
  variantIds: Set<string> = new Set(),
): void {
  registryList.innerHTML = "";

  // Group entries by kind in display order
  const groups = new Map<MotionKind, string[]>();
  for (const kind of KIND_ORDER) {
    groups.set(kind, []);
  }
  for (const [id, entry] of Object.entries(motionsRegistry)) {
    const list = groups.get(entry.kind);
    if (list) list.push(id);
  }

  for (const kind of KIND_ORDER) {
    const ids = groups.get(kind);
    if (!ids || ids.length === 0) continue;

    const groupEl = document.createElement("div");
    groupEl.className = "group";

    const labelEl = document.createElement("div");
    labelEl.className = "group-label";
    labelEl.textContent = kind;
    groupEl.appendChild(labelEl);

    for (const id of ids) {
      const entry = motionsRegistry[id];
      if (!entry) continue;

      const row = document.createElement("div");
      row.className = variantIds.has(id) ? "motion-row variant-row" : "motion-row";
      row.dataset.motionId = id;
      row.tabIndex = 0;
      row.setAttribute("role", "row");

      // Dot
      const dot = document.createElement("span");
      dot.className = "dot dot-hollow";

      // Name
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = id;

      // Tags
      const tags = document.createElement("div");
      tags.className = "row-tags";

      const tagPriority = document.createElement("span");
      tagPriority.className = "tag";
      tagPriority.textContent = `p${entry.priority}`;
      tags.appendChild(tagPriority);

      if (entry.loop) {
        const tagLoop = document.createElement("span");
        tagLoop.className = "tag tag-loop";
        tagLoop.textContent = "loop";
        tags.appendChild(tagLoop);
      }

      // Play button
      const playBtn = document.createElement("button");
      playBtn.className = "btn-play";
      playBtn.title = "play";
      playBtn.setAttribute("aria-label", `Play ${id}`);
      playBtn.textContent = "▶";

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(tags);
      row.appendChild(playBtn);
      groupEl.appendChild(row);

      // Idle variant sub-line
      if (id === "idle" && entry.variants && entry.variants.length > 0) {
        const subLine = document.createElement("div");
        subLine.className = "sub-line";
        const varCount = entry.variants.length;
        subLine.innerHTML = `variant <span>1/${varCount}</span> &middot; idle_01`;
        subLine.id = "idle-sub-line";
        groupEl.appendChild(subLine);
      }

      // Row click handler
      const handlePlay = (): void => {
        doPlayById(id);
      };
      row.addEventListener("click", handlePlay);
      row.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlePlay();
        }
      });
      playBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        handlePlay();
      });
    }

    registryList.appendChild(groupEl);
  }
}
