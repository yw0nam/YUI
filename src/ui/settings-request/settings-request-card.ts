import type {
  SettingsRequestDecision,
  SettingsRequestFrame,
} from "../../io/chat/tools/run/settings-request-frame";

export interface SettingsRequestCard {
  set(frame: SettingsRequestFrame | undefined): void;
  onDecision(cb: (decision: SettingsRequestDecision) => boolean): void;
  dispose(): void;
}

export function createSettingsRequestCard(_deps: { mount: HTMLElement }): SettingsRequestCard {
  return { set() {}, onDecision() {}, dispose() {} };
}
