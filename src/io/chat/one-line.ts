/** Collapses embedded newlines/whitespace runs to a single space and strips any
    `<client_context>`/`</client_context>` tag sequence, so a sampled or producer-authored string can
    never inject an extra physical line or terminate the block early. */
export function oneLine(s: string): string {
  let stripped = s;
  // Repeats until stable: removing one tag can join its neighbours into another.
  for (let prev = ""; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(/<\/?client_context>/g, "");
  }
  return stripped.replace(/\s+/g, " ").trim();
}
