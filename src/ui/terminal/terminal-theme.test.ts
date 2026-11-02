// @vitest-environment jsdom
/** terminal-theme.test.ts — every xterm ANSI slot comes from a theme token that reads at 4.5:1 on the Threads base in Dawn and Hearth, and the text inks read at 4.5:1 on each Threads surface. */

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { terminalTheme } from "./terminal-theme";

const SLOTS = [
  ["black", "black"],
  ["red", "red"],
  ["green", "green"],
  ["yellow", "yellow"],
  ["blue", "blue"],
  ["magenta", "magenta"],
  ["cyan", "cyan"],
  ["white", "white"],
  ["brightBlack", "bright-black"],
  ["brightRed", "bright-red"],
  ["brightGreen", "bright-green"],
  ["brightYellow", "bright-yellow"],
  ["brightBlue", "bright-blue"],
  ["brightMagenta", "bright-magenta"],
  ["brightCyan", "bright-cyan"],
  ["brightWhite", "bright-white"],
] as const;

/** WCAG 2 relative luminance of an `oklch(L C h)` colour, clipped to sRGB. */
function luminance(css: string): number {
  const [L, C, h] = css
    .match(/oklch\(([^)]*)\)/)![1]!
    .trim()
    .split(/\s+/)
    .map(Number) as [number, number, number];
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number): number => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const [dawn, hearth] = readFileSync("src/ui/tokens.css", "utf8").split(
  ':root[data-theme="hearth"]',
) as [string, string];
const token = (block: string, name: string): string | undefined =>
  block.match(new RegExp(`${name}:\\s*(oklch\\([^)]*\\))`))?.[1];

const THEMES = [
  ["Dawn", dawn],
  ["Hearth", hearth],
] as const;

it.each(
  THEMES,
)("gives every ANSI slot at least 4.5:1 on the Threads base in %s", (_theme, block) => {
  const base = token(block, "--yui-threads-base");

  const failing = SLOTS.map(([, name]) => [name, token(block, `--yui-ansi-${name}`)] as const)
    .filter(([, value]) => value === undefined || base === undefined || contrast(value, base) < 4.5)
    .map(([name]) => name);

  expect(failing).toEqual([]);
});

it.each(
  THEMES,
)("gives each text ink at least 4.5:1 on every Threads surface in %s", (_theme, block) => {
  const failing = ["base", "head", "side"].flatMap((surface) =>
    ["text", "text-dim", "text-mute"]
      .filter((ink) => {
        const ground = token(block, `--yui-threads-${surface}`);
        const text = token(block, `--yui-${ink}`);
        return ground === undefined || text === undefined || contrast(text, ground) < 4.5;
      })
      .map((ink) => `${ink} on ${surface}`),
  );

  expect(failing).toEqual([]);
});

it("hands xterm every ANSI slot from its token", () => {
  const root = document.createElement("div");
  document.body.append(root);
  for (const [i, [, name]] of SLOTS.entries()) {
    root.style.setProperty(`--yui-ansi-${name}`, `oklch(0.5 0.1 ${i})`);
  }

  const theme = terminalTheme(root);

  expect(SLOTS.map(([slot]) => theme[slot])).toEqual(SLOTS.map((_, i) => `oklch(0.5 0.1 ${i})`));
});
