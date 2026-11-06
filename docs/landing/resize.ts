import { clampIntoDesk } from "./character/body";
import { S } from "./character/load";
import { resize } from "./character/renderer";
import { resizeThreadsWindow } from "./session/threads-window";
import { resizeTerminal } from "./terminal";

addEventListener("resize", () => {
  resize(S);
  resizeTerminal();
  clampIntoDesk();
  resizeThreadsWindow();
});
