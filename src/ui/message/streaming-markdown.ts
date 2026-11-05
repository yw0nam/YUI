/** A streaming line's rendering kept block by block: a parse renders only the blocks that changed, a reveal copies only the block it cuts. */
import { markdownBlocks } from "./markdown";
import { keepTextPrefix, visibleText } from "./text-prefix";

interface Block {
  key: string;
  nodes: Node[];
  text: string;
}

export interface StreamingMarkdown {
  /** Renders `source` and returns its text as the typewriter counts it. */
  update(source: string, streaming: boolean): string;
  /** Shows the rendering's first `count` characters in `container`; blocks before the cut keep their nodes. */
  render(container: HTMLElement, count: number): void;
  /** The whole rendering's text content. */
  announcement(): string;
}

export function createStreamingMarkdown(): StreamingMarkdown {
  const root = document.createElement("span");
  let blocks: Block[] = [];
  let text = "";
  let empty = true;

  function update(source: string, streaming: boolean): string {
    empty = source === "";
    const previous = blocks;
    blocks = empty
      ? []
      : markdownBlocks(source, streaming).map(({ key, render }, index) => {
          if (previous[index]?.key === key) return previous[index];
          const rendered = render();
          return { key, nodes: [...rendered.childNodes], text: visibleText(rendered) };
        });
    text = blocks.map((block) => block.text).join("");
    return text;
  }

  function render(container: HTMLElement, count: number): void {
    const shown: Node[] = [];
    let left = count;
    for (const block of blocks) {
      if (count < text.length && block.text !== "" && left <= block.text.length) {
        const cut = document.createElement("span");
        cut.append(...block.nodes.map((node) => node.cloneNode(true)));
        keepTextPrefix(cut, left);
        shown.push(...cut.childNodes);
        break;
      }
      shown.push(...block.nodes);
      left -= block.text.length;
    }
    let cursor = root.firstChild;
    for (const node of shown) {
      if (node === cursor) cursor = cursor.nextSibling;
      else root.insertBefore(node, cursor);
    }
    while (cursor) {
      const next: ChildNode | null = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
    if (empty) container.replaceChildren();
    else if (container.firstChild !== root) container.replaceChildren(root);
  }

  return {
    update,
    render,
    announcement: () =>
      blocks.flatMap((block) => block.nodes.map((node) => node.textContent)).join(""),
  };
}
