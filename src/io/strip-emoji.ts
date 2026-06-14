/**
 * Stateful emoji stripper for spoken output_text deltas.
 *
 * Removes Extended_Pictographic + emoji modifiers (ZWJ U+200D, VS16 U+FE0F,
 * skin-tone U+1F3FB–U+1F3FF, regional indicators U+1F1E6–U+1F1FF, keycap U+20E3).
 * Keycap sequences (e.g. #️⃣) strip the ASCII base character too, since the base
 * alone is an unintended speech artifact.
 * Preserves all other characters including punctuation, math, and currency.
 *
 * Hold-back: a trailing emoji-class run in the input is buffered in carry so a ZWJ
 * sequence split across delta boundaries is stripped as a whole, not leaked.
 */

export interface EmojiStripper {
  push(delta: string): string;
  flush(): string;
  reset(): void;
}

// keycap sequence: ASCII base ([#*0-9]) + optional VS16 + combining enclosing keycap U+20E3.
const KEYCAP_SEQ = /[#*0-9]️?⃣/gu;

// one emoji-class codepoint: Extended_Pictographic or modifier (alternation avoids misleading char class).
const EMOJI_CP =
  /(?:\p{Extended_Pictographic}|\u{200D}|\u{FE0F}|[\u{1F3FB}-\u{1F3FF}]|[\u{1F1E6}-\u{1F1FF}]|\u{20E3})/u;

// maximal run of emoji-class codepoints anywhere in the string.
const EMOJI_RUN = new RegExp(`(?:${EMOJI_CP.source})+`, "gu");

// maximal emoji-class run anchored at the end of the string (for trailing hold-back detection).
const TRAILING_EMOJI = new RegExp(`(?:${EMOJI_CP.source})+$`, "u");

function strip(s: string): string {
  return s.replace(KEYCAP_SEQ, "").replace(EMOJI_RUN, "");
}

export function createEmojiStripper(): EmojiStripper {
  let carry = "";

  return {
    push(delta: string): string {
      const input = carry + delta;
      carry = "";

      // hold back the trailing emoji-class run — it may continue in the next delta (ZWJ/modifier).
      const trailMatch = TRAILING_EMOJI.exec(input);
      const safeInput = trailMatch ? input.slice(0, input.length - trailMatch[0].length) : input;
      if (trailMatch) {
        carry = trailMatch[0];
      }

      return strip(safeInput);
    },

    flush(): string {
      // carry is all emoji-class codepoints — discard without emitting.
      carry = "";
      return "";
    },

    reset(): void {
      carry = "";
    },
  };
}
