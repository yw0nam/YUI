import { setTyping } from "../character/face";
import { surfaces } from "../character/overlays";
import { reduced } from "../shared/dom";
import { wait } from "../shared/math";
import { canSpeak, speakAudio } from "../voice";
export async function say(line: string, voice: "allow" | "deny") {
  const willSpeak = await canSpeak(voice);
  setTyping(!willSpeak);
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
  setTyping(false);
}
