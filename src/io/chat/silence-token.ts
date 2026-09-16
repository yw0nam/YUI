/**
 * Stateful `[SILENT]` token filter for spoken output_text deltas.
 *
 * The backend marks a deliberate silent turn with speech text that trims to exactly
 * `[SILENT]`. The filter holds back the stream head until the token either completes
 * (swallowed at flush) or diverges into a longer reply (everything held so far is
 * emitted, later deltas pass through unchanged). `[SILENT]` inside a longer reply is
 * ordinary text.
 */

interface SilenceTokenFilter {
  push(delta: string): string;
  flush(): string;
}

const TOKEN = "[SILENT]";

// True when t is the token optionally padded with trailing whitespace.
function isToken(t: string): boolean {
  return t.startsWith(TOKEN) && t.slice(TOKEN.length).trim() === "";
}

export function createSilenceTokenFilter(): SilenceTokenFilter {
  let held = "";
  let diverged = false;

  return {
    push(delta: string): string {
      if (diverged) return delta;
      held += delta;
      const t = held.trimStart();
      // Keep holding while the text could still end up as a bare token.
      if (t === "" || TOKEN.startsWith(t) || isToken(t)) return "";
      diverged = true;
      const out = held;
      held = "";
      return out;
    },

    flush(): string {
      if (diverged) return "";
      const t = held.trim();
      const out = t === "" || t === TOKEN ? "" : held;
      held = "";
      diverged = true;
      return out;
    },
  };
}

export function isSilenceToken(text: string | undefined): boolean {
  return text?.trim() === TOKEN;
}
