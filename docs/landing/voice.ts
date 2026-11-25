import { $ } from "./shared/dom";

import closingUrl from "./voice/closing.mp3?url";

const LIPSYNC_GAIN = 6;
const voiceState = {
  actx: null as AudioContext | null,
  analyser: null as AnalyserNode | null,
  tdBuf: null as Uint8Array<ArrayBuffer> | null,
  speaking: false,
  muted: false,
};
const voiceBytes = fetch(closingUrl)
  .then((r) => (r.ok ? r.arrayBuffer() : null))
  .catch(() => null);
function ensureAudio() {
  if (!voiceState.actx) {
    voiceState.actx = new AudioContext();
    voiceState.analyser = voiceState.actx.createAnalyser();
    voiceState.analyser.fftSize = 256;
    voiceState.analyser.connect(voiceState.actx.destination);
    voiceState.tdBuf = new Uint8Array(voiceState.analyser.fftSize);
  }
  if (voiceState.actx.state === "suspended") voiceState.actx.resume();
}
addEventListener("pointerdown", ensureAudio, { capture: true });
addEventListener("keydown", ensureAudio, { capture: true });
export async function speakAudio() {
  const bytes = await voiceBytes;
  const audio = await voiceState.actx!.decodeAudioData(bytes!.slice(0));
  const src = voiceState.actx!.createBufferSource();
  src.buffer = audio;
  src.connect(voiceState.analyser!);
  voiceState.speaking = true;
  src.start();
  return new Promise<void>((res) => {
    src.onended = () => {
      voiceState.speaking = false;
      res();
    };
  });
}
export function rms() {
  voiceState.analyser!.getByteTimeDomainData(voiceState.tdBuf!);
  let sum = 0;
  for (const v of voiceState.tdBuf!) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.min(1, Math.sqrt(sum / voiceState.tdBuf!.length) * LIPSYNC_GAIN);
}
export const soundBtn = $("sound");
soundBtn.addEventListener("click", () => {
  voiceState.muted = !voiceState.muted;
  soundBtn.setAttribute("aria-pressed", String(voiceState.muted));
  soundBtn.setAttribute("aria-label", voiceState.muted ? "Unmute her voice" : "Mute her voice");
});

export const isSpeaking = () => voiceState.speaking;
export async function canSpeak() {
  return !voiceState.muted && !!voiceState.actx && !!(await voiceBytes);
}
