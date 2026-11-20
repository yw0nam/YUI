import type { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { t } from "../../i18n";
import { createCueList } from "../../message/cue-list";

interface CueListsDeps {
  /** Group of the schedule cue list (`.yui-cue-sections`). */
  scheduleMount: HTMLElement;
  /** Group of the proactive cue list (`.yui-loop-cue-section`). */
  proactiveMount: HTMLElement;
  scheduleSettings: ReturnType<typeof createScheduleSettings>;
  proactiveSettings: ReturnType<typeof createProactiveSettings>;
}

interface CueLists {
  /** Destroy the schedule list, then the proactive list. */
  destroy(): void;
}

export function mountCueLists({
  scheduleMount,
  proactiveMount,
  scheduleSettings,
  proactiveSettings,
}: CueListsDeps): CueLists {
  scheduleMount.innerHTML = "";
  const scheduleCueList = createCueList({
    mount: scheduleMount,
    store: scheduleSettings,
    title: t("cue.schedule_title"),
    sub: t("cue.schedule_sub"),
    note: t("cue.schedule_note"),
    foldTitle: t("cue.schedule_fold"),
    trigger: { kind: "time", field: "time" },
    addLabel: t("cue.schedule_add"),
  });
  proactiveMount.innerHTML = "";
  const proactiveCueList = createCueList({
    mount: proactiveMount,
    store: proactiveSettings,
    title: t("cue.proactive_title"),
    sub: t("cue.proactive_sub"),
    foldTitle: t("cue.proactive_fold"),
    trigger: { kind: "minutes", field: "idle_min" },
    addLabel: t("cue.proactive_add"),
  });

  return {
    destroy(): void {
      scheduleCueList.destroy();
      proactiveCueList.destroy();
    },
  };
}
