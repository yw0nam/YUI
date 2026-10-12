import { physicalToLogicalScreenPoint } from "../../../window/capture/screen-point";
import type { ScreenCapturer } from "../../../window/capture/screen-source-provider";
import { monitorAt, type ScreenMonitor } from "../../../window/geometry/screen-geometry";
import type { ClientToolResult } from "../client-tools";

export interface ScreenQueryPorts {
  allowRequests(): boolean;
  getWindow(): { outerPosition(): Promise<{ x: number; y: number }> } | null;
  listMonitors(): Promise<ScreenMonitor[]>;
  capturer: Pick<ScreenCapturer, "captureAt">;
}

function isDisplayNumber(value: unknown, count: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;
}

/** A screenshot of display `monitor`, or of the display holding the pet window when it is absent. */
export async function queryScreen(
  ports: ScreenQueryPorts,
  monitor?: unknown,
): Promise<ClientToolResult> {
  if (!ports.allowRequests()) return "error: screen capture is off";
  try {
    const monitors = await ports.listMonitors();
    if (monitor !== undefined && !isDisplayNumber(monitor, monitors.length)) {
      return "error: invalid field monitor";
    }
    const chosen = monitor === undefined ? undefined : monitors[monitor as number];
    const point = chosen
      ? {
          x: chosen.position.x + chosen.size.width / 2,
          y: chosen.position.y + chosen.size.height / 2,
        }
      : await ports.getWindow()?.outerPosition();
    if (!point) return "error: unsupported";
    const logical = physicalToLogicalScreenPoint(point, monitors);
    const capture = logical && (await ports.capturer.captureAt(logical));
    if (!capture) return "error: screen capture failed";
    const display = monitors.indexOf(chosen ?? monitorAt(monitors, point.x, point.y)!);
    return { text: `screenshot of display ${display}`, images: [capture.data_url] };
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
