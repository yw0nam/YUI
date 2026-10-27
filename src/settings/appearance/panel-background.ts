/** The panel surface (`--yui-panel-bg` in src/ui/tokens.css) in sRGB, for a native window's background before its page paints. */
export function panelBackground(theme: string | undefined): [number, number, number] {
  return theme === "hearth" ? [17, 12, 7] : [249, 246, 242];
}
