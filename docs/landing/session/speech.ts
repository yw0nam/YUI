import { faceState } from "../character/face";
import { surfaces } from "../character/overlays";
import { reduced, wait } from "../shared/dom";
import { speakAudio, voiceBytes, voiceState } from "../voice";
export async function say(line: string, voice: "allow" | "deny") {
  const willSpeak =
    !voiceState.muted && !!voiceState.actx && !!(await voiceBytes)[voice === "allow" ? 0 : 1];
  faceState.mouthOn = !willSpeak;
  surfaces.beginSpeech();
  const spoken = willSpeak ? wait(reduced ? 0 : 600).then(() => speakAudio(voice)) : null;
  for (const tok of line.match(/\S+\s*/g)!) {
    surfaces.pushSpeech(tok);
    await wait(45);
  }
  surfaces.endSpeech({ defer: willSpeak });
  if (spoken) {
    await spoken;
    surfaces.finishSpeech();
  } else await wait(line.length * 40);
  faceState.mouthOn = false;
}
