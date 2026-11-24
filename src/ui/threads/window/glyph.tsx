/** A Threads line glyph as JSX, from the path markup `threads/glyphs.ts` draws its strings with. */

export function Glyph({ paths }: { paths: string }) {
  return (
    <svg
      className="yui-threads-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the paths are constants of this folder.
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}
