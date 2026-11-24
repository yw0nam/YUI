/** A Threads line glyph as JSX, with the attributes `threads/glyphs.ts` draws its markup with. */

import { GLYPH_ATTRS } from "../glyphs";

export function Glyph({ paths }: { paths: string }) {
  return (
    <svg
      {...GLYPH_ATTRS}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the paths are constants of this folder.
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}
