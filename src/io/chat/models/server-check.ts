/** Asks one OpenAI-compatible server whether it answers, through the model list read. */

import { readModels } from "./reader";

export type ServerCheck =
  | { kind: "ok" }
  | { kind: "unreachable" }
  | { kind: "timeout" }
  | { kind: "refused" }
  | { kind: "http"; status: number }
  | { kind: "malformed" };

/** Whether a server answers: GET {baseUrl}/models through readModels, with any listing answer counted as ok. */
export async function checkServer(input: {
  baseUrl: string;
  apiKey?: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
}): Promise<ServerCheck> {
  const result = await readModels({
    ...input,
    signal: input.signal ?? new AbortController().signal,
  });
  // A transcription-only or TTS-only server answers without listing models.
  if (result.kind === "ok" || result.kind === "no_list" || result.kind === "malformed") {
    return { kind: "ok" };
  }
  return result;
}
