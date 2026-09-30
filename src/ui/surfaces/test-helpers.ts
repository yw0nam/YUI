/** Shared fixtures for tests that build Surfaces. */

import type { ToolStatus } from "../chips/status-pill";

/** A ToolStatus that draws nothing, for tests that do not look at tool status. */
export const noTool: ToolStatus = { showTool() {}, finishTool() {}, hideTool() {} };
