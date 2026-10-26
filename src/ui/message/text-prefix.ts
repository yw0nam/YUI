/** Keeps the first `count` characters of an element's text; everything after them goes, elements not yet reached included. */
export function keepTextPrefix(root: Node, count: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = count;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) {
      const range = document.createRange();
      range.setStart(node, left);
      range.setEnd(root, root.childNodes.length);
      range.deleteContents();
      return;
    }
    left -= length;
  }
}
