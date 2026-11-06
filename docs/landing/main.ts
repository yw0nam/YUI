import "../../src/ui/tokens.css";
import "@xterm/xterm/css/xterm.css";
import "./shared/theme";
import "./pointer";
import "./resize";
import { baseline, initializeBody } from "./character/body";
import { setBaseline } from "./character/motion";
import { startLoop } from "./loop";
import { currentPhase, startSession, startStory } from "./story";
import { onTerminalPlaced, placeScene } from "./terminal";

if (import.meta.env.DEV) {
  void import("./debug");
}
setBaseline(baseline);
onTerminalPlaced(startSession);
placeScene();
initializeBody();
startLoop(currentPhase);
startStory();
