/** Collapses embedded newlines/whitespace runs to a single space and strips any
    `<client_context>`/`</client_context>` tag sequence, so a sampled or producer-authored string can
    never inject an extra physical line or terminate the block early. */
export function oneLine(s: string): string {
  return s
    .replace(/<\/?client_context>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
