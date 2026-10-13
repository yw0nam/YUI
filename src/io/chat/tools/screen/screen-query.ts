import {
  physicalToLogicalScreenPoint,
  type ScreenPoint,
} from "../../../window/capture/screen-point";
import type { ScreenCapturer } from "../../../window/capture/screen-source-provider";
import {
  monitorAt,
  monitorAtLogical,
  type PetWindow,
  type ScreenMonitor,
} from "../../../window/geometry/screen-geometry";
import type { ClientToolResult } from "../client-tools";

export interface ScreenQueryPorts {
  allowRequests(): boolean;
  getWindow(): Pick<PetWindow, "outerPosition" | "outerSize" | "scaleFactor"> | null;
  listMonitors(): Promise<ScreenMonitor[]>;
  /** True where the capture command reads logical points; false where it reads physical ones. */
  pointsAreLogical: boolean;
  capturer: Pick<ScreenCapturer, "captureAt">;
}

function isDisplayNumber(value: unknown, count: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;
}

/** The physical centre of a rect and the scale of the display or window that owns it. */
function centre(
  position: ScreenPoint,
  size: { width: number; height: number },
  scale: number,
): { point: ScreenPoint; scale: number } {
  return { point: { x: position.x + size.width / 2, y: position.y + size.height / 2 }, scale };
}

/** A screenshot of display `monitor`, or of the display holding the pet window's centre when absent. */
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
    const win = chosen ? null : ports.getWindow();
    if (!chosen && !win) return "error: unsupported";
    const { point: physical, scale } = chosen
      ? centre(chosen.position, chosen.size, chosen.scaleFactor)
      : centre(await win!.outerPosition(), await win!.outerSize(), await win!.scaleFactor());
    const point = ports.pointsAreLogical ? physicalToLogicalScreenPoint(physical, scale) : physical;
    const holder =
      chosen ?? (ports.pointsAreLogical ? monitorAtLogical : monitorAt)(monitors, point.x, point.y);
    const capture = holder && (await ports.capturer.captureAt(point));
    if (!capture) return "error: screen capture failed";
    return {
      text: `screenshot of display ${monitors.indexOf(holder)}`,
      images: [capture.data_url],
    };
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
