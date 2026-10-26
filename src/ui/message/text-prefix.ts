/** A rendered line's text as the typewriter counts it, and cutting a rendering to its first characters. */

// marked puts a bare newline between block tags; it draws nothing, so it is not counted.
const isBlockGap = (node: Node): boolean => /^\n+$/.test(node.textContent ?? "");

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isBlockGap(node)) nodes.push(node as Text);
  }
  return nodes;
}

export function visibleText(root: Node): string {
  return textNodes(root)
    .map((node) => node.data)
    .join("");
}

/** Keeps the first `count` characters of an element's text; everything after them goes, elements not yet reached included. */
export function keepTextPrefix(root: Node, count: number): void {
  let left = count;
  for (const node of textNodes(root)) {
    if (left <= node.data.length) {
      const range = document.createRange();
      range.setStart(node, left);
      range.setEnd(root, root.childNodes.length);
      range.deleteContents();
      return;
    }
    left -= node.data.length;
  }
}
