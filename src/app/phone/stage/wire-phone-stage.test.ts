import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../../config/load";
import { avatarFixture } from "../../../config/load-test-helpers";
import type { EventBus } from "../../../dispatcher/core/event-bus";
import { createCameraSettings } from "../../../settings/avatar/camera-settings";
import { wirePhoneStage } from "./wire-phone-stage";

function pointer(type: string, pointerId: number, clientX: number, clientY: number): Event {
  return Object.assign(new Event(type), { pointerId, button: 0, clientX, clientY });
}

describe("wirePhoneStage", () => {
  it("frames the upper body and orbits the camera from the stage until torn down", () => {
    const cfg = { avatar: avatarFixture() } as AppConfig;
    const renderer = {
      setFitBand: vi.fn(),
      getTapPoints: () => null,
      getCurrentMotion: () => null,
    };
    const stage = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
    });
    const cameraSettings = createCameraSettings();

    const dispose = wirePhoneStage({
      stage: stage as unknown as HTMLElement,
      renderer,
      cfg,
      bus: { push: vi.fn() } as unknown as EventBus,
      cameraSettings,
    });
    expect(renderer.setFitBand).toHaveBeenCalledWith(cfg.avatar.framing.upper_body);

    stage.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    stage.dispatchEvent(pointer("pointermove", 1, 120, 100));
    const turned = cameraSettings.get().azimuth;
    expect(turned).not.toBe(0);

    dispose();
    stage.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    stage.dispatchEvent(pointer("pointermove", 1, 140, 100));
    expect(cameraSettings.get().azimuth).toBe(turned);
  });
});
