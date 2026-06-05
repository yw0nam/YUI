/**
 * audio-player.ts — browser Web Audio sink (PRD F4 / contract.md §3 step 6-7). STUB.
 */

export interface AudioSink {
  play(wav: ArrayBuffer, onAmplitude?: (rms: number) => void): Promise<void>;
  stop(): void;
}

export function createWebAudioSink(): AudioSink {
  throw new Error("not implemented");
}
