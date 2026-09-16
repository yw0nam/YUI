/** Default schedule cues seeded per locale on a first run, before the user edits the list. */

import type { CueLocale } from "./cue-list-settings";
import type { ScheduledCue } from "./schedule-settings";

export const SCHEDULE_CUE_SEEDS: Record<CueLocale, ScheduledCue[]> = {
  ko: [
    {
      id: "morning",
      label: "아침",
      context: "하루를 시작하는 아침 인사. 막 자리에 앉았을 때 가볍게 안부를 물어봐줘.",
      time: "09:00",
      enabled: true,
    },
    {
      id: "lunch",
      label: "점심",
      context: "점심시간이야. 밥은 먹었는지, 오전은 어땠는지 가볍게 물어봐줘.",
      time: "12:00",
      enabled: true,
    },
    {
      id: "evening",
      label: "저녁",
      context: "하루 마무리할 시간이야. 오늘 어땠는지 가볍게 들어봐줘.",
      time: "18:00",
      enabled: true,
    },
    {
      id: "late_night",
      label: "심야",
      context: "많이 늦었어. 이제 좀 쉬는 게 어때? 무리하지 말라고 부드럽게 챙겨줘.",
      time: "23:00",
      enabled: true,
    },
  ],
  en: [
    {
      id: "morning",
      label: "Morning",
      context:
        "A morning greeting to start the day. Lightly ask how they're doing as they settle in.",
      time: "09:00",
      enabled: true,
    },
    {
      id: "lunch",
      label: "Lunch",
      context: "It's lunchtime. Casually ask if they've eaten and how the morning went.",
      time: "12:00",
      enabled: true,
    },
    {
      id: "evening",
      label: "Evening",
      context: "Time to wrap up the day. Lightly ask how today went.",
      time: "18:00",
      enabled: true,
    },
    {
      id: "late_night",
      label: "Late night",
      context:
        "It's really late. Gently suggest getting some rest — tell them not to push too hard.",
      time: "23:00",
      enabled: true,
    },
  ],
  ja: [
    {
      id: "morning",
      label: "朝",
      context: "一日を始める朝のあいさつ。席に着いたばかりの相手に、軽く調子を聞いてあげて。",
      time: "09:00",
      enabled: true,
    },
    {
      id: "lunch",
      label: "昼",
      context: "お昼の時間だよ。ご飯は食べたか、午前中はどうだったか気軽に聞いてみて。",
      time: "12:00",
      enabled: true,
    },
    {
      id: "evening",
      label: "夕方",
      context: "そろそろ一日の締めくくり。今日はどうだったか軽く聞いてあげて。",
      time: "18:00",
      enabled: true,
    },
    {
      id: "late_night",
      label: "深夜",
      context: "もうかなり遅いよ。そろそろ休んだら？無理しないでって、やさしく気遣ってあげて。",
      time: "23:00",
      enabled: true,
    },
  ],
};
