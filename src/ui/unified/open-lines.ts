import type { SpeechStream } from "../../io/bridge/settings-bridge";
import type { Transcript } from "./merge";

const ENDED_LINE_TIMEOUT_MS = 60_000;

export interface OpenLine {
  preset: string;
  turnId: string;
  text: string;
  baseline: number;
  endedAt?: number;
}

function recordCount(transcripts: readonly Transcript[], preset: string, turnId: string): number {
  return (
    transcripts
      .find((t) => t.id === preset)
      ?.entries.filter((e) => e.role === "assistant" && e.turn_id === turnId).length ?? 0
  );
}

export function createOpenLines() {
  const lines = new Map<string, OpenLine>();
  return {
    accept(event: SpeechStream, transcripts: readonly Transcript[], now: number): void {
      const line = lines.get(event.preset);
      if (event.op === "begin") {
        if (line?.turnId === event.turn_id && line.endedAt === undefined) return;
        lines.set(event.preset, {
          preset: event.preset,
          turnId: event.turn_id,
          text: "",
          baseline: recordCount(transcripts, event.preset, event.turn_id),
        });
      } else if (line?.turnId === event.turn_id) {
        if (event.op === "push") line.text += event.delta;
        else line.endedAt ??= now;
      }
    },
    reconcile(transcripts: readonly Transcript[], now: number): void {
      for (const [preset, line] of lines) {
        if (
          !transcripts.some((t) => t.id === preset) ||
          recordCount(transcripts, preset, line.turnId) > line.baseline ||
          (line.endedAt !== undefined && line.endedAt + ENDED_LINE_TIMEOUT_MS <= now)
        )
          lines.delete(preset);
      }
    },
    snapshot(): OpenLine[] {
      return [...lines.values()]
        .filter((line) => line.text.length > 0)
        .map((line) => ({ ...line }));
    },
    expiresAt(): number | undefined {
      const ended = [...lines.values()].flatMap((line) =>
        line.endedAt === undefined ? [] : [line.endedAt + ENDED_LINE_TIMEOUT_MS],
      );
      return ended.length ? Math.min(...ended) : undefined;
    },
  };
}
