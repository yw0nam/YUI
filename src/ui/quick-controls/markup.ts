/** Panel markup primitives shared by the template and the extracted tab modules. */

// Escapes the characters that would otherwise break out of an HTML attribute.
export function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
