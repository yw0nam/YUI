/** Panel markup primitives shared by the template and the extracted tab modules. */

// Escapes the characters that would otherwise break out of an HTML attribute.
export function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Section title row — the title on the left, an optional control or state text on the right.
export function secHeadHtml(title: string, aside = ""): string {
  return `<div class="yui-sec__head"><h2 class="yui-sec__title">${title}</h2>${aside}</div>`;
}
