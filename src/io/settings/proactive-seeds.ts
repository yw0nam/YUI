/** Default proactive cues seeded per locale on a first run, before the user edits the list. */

import type { CueLocale } from "./cue-list-settings";
import type { ProactiveCue } from "./proactive-settings";

export const PROACTIVE_CUE_SEEDS: Record<CueLocale, ProactiveCue[]> = {
  ko: [
    {
      id: "short_break",
      label: "잠깐 환기",
      context: "5분 넘게 조용하네. 잠깐 고개 들고 환기 좀 하라고 살짝 말해줘.",
      idle_min: 5,
      enabled: true,
    },
    {
      id: "mid_check",
      label: "슬슬 체크",
      context: "10분 넘게 말이 없네. 작업 잘 되고 있는지 가볍게 물어봐줘. 부담스럽지 않게.",
      idle_min: 10,
      enabled: true,
    },
    {
      id: "long_focus",
      label: "오래 집중",
      context: "30분이나 됐어. 잠깐 쉬는 건 어때? 너무 오래 앉아 있으면 몸이 힘들잖아.",
      idle_min: 30,
      enabled: true,
    },
  ],
  en: [
    {
      id: "short_break",
      label: "Quick break",
      context:
        "It's been quiet for over 5 minutes. Gently suggest looking up and getting a bit of fresh air.",
      idle_min: 5,
      enabled: true,
    },
    {
      id: "mid_check",
      label: "Check-in",
      context:
        "No word for over 10 minutes. Casually ask how the work is going. Keep it light, not pushy.",
      idle_min: 10,
      enabled: true,
    },
    {
      id: "long_focus",
      label: "Long focus",
      context:
        "It's been a whole 30 minutes. Suggest a short break — sitting that long is rough on the body.",
      idle_min: 30,
      enabled: true,
    },
  ],
  ja: [
    {
      id: "short_break",
      label: "ひと息",
      context: "5分以上静かだね。ちょっと顔を上げて息抜きするように、軽く声をかけてあげて。",
      idle_min: 5,
      enabled: true,
    },
    {
      id: "mid_check",
      label: "そろそろチェック",
      context: "10分以上話してないね。作業が順調か気軽に聞いてみて。重くならないように。",
      idle_min: 10,
      enabled: true,
    },
    {
      id: "long_focus",
      label: "長時間集中",
      context: "もう30分だよ。少し休憩したら？座りっぱなしは体がつらいでしょ。",
      idle_min: 30,
      enabled: true,
    },
  ],
};
