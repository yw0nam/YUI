/**
 * formatAccel — renders an Electron/Tauri-style accelerator string (e.g.
 * "CmdOrCtrl+Shift+Y") for display, platform-appropriate.
 */

const MODIFIER_MAC: Record<string, string> = {
  cmdorctrl: "⌘",
  cmd: "⌘",
  super: "⌘",
  ctrl: "⌃",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
};

const MODIFIER_NONMAC: Record<string, string> = {
  cmdorctrl: "Ctrl",
  cmd: "Cmd",
  super: "Super",
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Option",
};

export function formatAccel(accel: string, isMac: boolean): string {
  const trimmed = accel.trim();
  if (!trimmed) return "";

  const modifierMap = isMac ? MODIFIER_MAC : MODIFIER_NONMAC;
  const parts = trimmed
    .split("+")
    .map((tok) => tok.trim())
    .filter((tok) => tok.length > 0)
    .map((tok) => modifierMap[tok.toLowerCase()] ?? tok.toUpperCase());

  return parts.join(isMac ? "" : "+");
}
