import type { ClientContext } from "../../../../contract";
import type { ChatHistoryEntry } from "../chat-history-store";
import type { OverheardCursor, OverheardStore } from "./overheard-store";

const OVERHEARD_MAX_LINES = 8;

/** One other preset's unheard lines, with the cursor that marks them heard. */
export type OverheardBlock = NonNullable<ClientContext["overheard"]>[number] & {
  cursor: OverheardCursor;
};

export function createOverheardReader(deps: {
  selfPresetId: string;
  otherPresetIds(): string[];
  presetName(id: string): string;
  /** The entries after that transcript's last boundary, oldest first. */
  transcriptOf(id: string): ChatHistoryEntry[];
  cursors: Pick<OverheardStore, "get" | "set">;
}) {
  function blockFor(id: string): OverheardBlock | null {
    const transcript = deps.transcriptOf(id);
    const { ts, n } = deps.cursors.get(id);
    let seenAtCursor = 0;
    const unheard = transcript.filter((e) => {
      if (e.ts === ts) return ++seenAtCursor > n;
      return e.ts > ts;
    });
    const entries = unheard
      .slice(-OVERHEARD_MAX_LINES)
      .map(({ role, text, ts: at }) => ({ role, text, ts: at }));
    const last = entries.at(-1);
    if (!last) return null;
    return {
      preset: id,
      name: deps.presetName(id),
      entries,
      cursor: { ts: last.ts, n: transcript.filter((e) => e.ts === last.ts).length },
    };
  }

  return {
    read(): OverheardBlock[] {
      const ids = new Set(deps.otherPresetIds());
      ids.delete(deps.selfPresetId);
      return [...ids].flatMap((id) => blockFor(id) ?? []);
    },
    commit(blocks: OverheardBlock[]): void {
      for (const block of blocks) deps.cursors.set(block.preset, block.cursor);
    },
  };
}
