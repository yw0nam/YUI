/** Producer text as DOM: fenced code blocks and `code` spans, everything else plain text nodes. */

function code(text: string): HTMLElement {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
}

export function richText(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  for (const part of text.split(/(```[\s\S]*?```)/)) {
    if (part.startsWith("```") && part.length >= 6 && part.endsWith("```")) {
      const pre = document.createElement("pre");
      pre.append(code(part.slice(3, -3).replace(/^[^\n]*\n?/, "")));
      out.append(pre);
      continue;
    }
    part.split(/`([^`\n]+)`/).forEach((piece, i) => {
      if (piece) out.append(i % 2 ? code(piece) : document.createTextNode(piece));
    });
  }
  return out;
}
