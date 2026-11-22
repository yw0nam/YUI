/** The paste-a-voice-id field: Enter selects the id even when the list does not carry it. */

import { useRef, useState } from "react";
import { isSafeSanitizedId } from "../../../../io/assets/safe-id";
import type { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import { t } from "../../../i18n";
import { heldElsewhere } from "./speaker-rules";

type SpeakerSelection = ReturnType<typeof createSpeakerSelection>;

// A voice page URL (`/m/<id>`) names the voice, any other URL none (undefined), and a non-URL is the id.
function pastedVoiceId(text: string): string | undefined {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    return /^\/m\/([^/]+)\/?$/.exec(new URL(trimmed).pathname)?.[1];
  } catch {
    return undefined;
  }
}

export function ManualVoiceId({
  speakerSelection,
  hidden,
}: {
  speakerSelection: SpeakerSelection;
  hidden: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The refusal's reason; its text stays after the field is valid again.
  const [reason, setReason] = useState<string>("speaker.manual_invalid");
  const [invalid, setInvalid] = useState(false);

  function refuse(why: string): void {
    setReason(why);
    setInvalid(true);
  }

  // A non-voice URL, an id the store cannot keep, or one another provider's voice holds marks it invalid.
  function commit(): void {
    const field = input.current!;
    const id = pastedVoiceId(field.value);
    if (id === "") return;
    if (id === undefined || !isSafeSanitizedId(id)) {
      refuse("speaker.manual_invalid");
      return;
    }
    if (heldElsewhere(speakerSelection, id)) {
      refuse("speaker.manual_taken");
      return;
    }
    setInvalid(false);
    if (!speakerSelection.list().some((o) => o.id === id)) {
      speakerSelection.addUserOption({ id, label: id, ref_url: "", source: "user" });
    }
    speakerSelection.select(id);
    field.value = "";
  }

  return (
    <div className={invalid ? "yui-spk-manual is-invalid" : "yui-spk-manual"} hidden={hidden}>
      <span className="yui-input-wrap">
        <input
          ref={input}
          className="yui-ep-input"
          type="text"
          aria-label={t("speaker.manual_aria")}
          placeholder={t("speaker.manual_placeholder")}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
        />
      </span>
      <p className="yui-spk-manual__error" role="status">
        {t(reason)}
      </p>
    </div>
  );
}
