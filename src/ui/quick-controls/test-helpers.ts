// @vitest-environment jsdom
/**
 * Shared setup for the quick-controls test suite (split from quick-controls.test.ts):
 * in-memory storages, minimal option stubs, and real store factories.
 * Importing this module also installs the jsdom CSS.escape polyfill.
 */

import { vi } from "vitest";
import type { AvatarOption } from "../../config/load";
import {
  type AgentSettings,
  type AgentStorage,
  createAgentSettings,
} from "../../io/agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "../../io/api-key-settings";
import { createChatKeySettings } from "../../io/chat-key-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createLipsyncSettings } from "../../io/lipsync-settings";
import { createFlagSettings } from "../../io/persisted-store";
import { createProactiveSettings } from "../../io/proactive-settings";
import { createScheduleSettings } from "../../io/schedule-settings";
import { createSpeakerSelection, type SpeakerOption } from "../../io/speaker-selection";
import { createVadSettings } from "../../io/vad-settings";
import { createVrmSelection } from "../../io/vrm-selection";
import { createWorkflowSettings } from "../../io/workflow-settings";

// jsdom 29 lacks CSS.escape (browsers have it) — polyfill so selector-escaping paths run.
// Escapes ASCII chars that aren't safe identifier chars; non-ASCII passes through (safe unescaped).
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the polyfill must match the C0 control range to escape it.
      String(value).replace(/[\x00-\x7f]/g, (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`)),
  };
}

// In-memory AgentStorage so each test starts from a clean store.
export function inMemoryAgentStorage(): AgentStorage {
  let value: AgentSettings | null = null;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

// In-memory ApiKeyStorage so stt/tts key stores don't share localStorage in tests.
export function inMemoryApiKeyStorage(): import("../../io/api-key-settings").ApiKeyStorage {
  let value: { apiKey: string } | null = null;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal stubs for existing required options
// ─────────────────────────────────────────────────────────────────────────────

export function makeSettings() {
  return {
    get: () => ({ enabled: false, source: { kind: "monitor" as const, index: 0 } }),
    setEnabled: vi.fn(),
    setSource: vi.fn(),
    reloadFromStorage: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

export function makeSourceProvider() {
  return {
    listMonitors: async () => [],
  };
}

export function makeVoiceStatus() {
  return {
    get: () => ({
      state: "idle" as const,
      label: "Idle",
      detail: "Voice input is off",
      visible: false,
    }),
    set: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Build a real createVrmSelection over an explicit manifest (default Carlotta).
export function makeVrmSelection(ids: string[] = ["carlotta", "aria", "mirai"]) {
  const available: AvatarOption[] = ids.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    url: `/vrms/${id}.vrm`,
    source: "bundled",
  }));
  return createVrmSelection({ available, defaultValue: available[0].url });
}

// A user (imported) option mirroring vrm-import's output shape.
export const USER_OPTION: AvatarOption = {
  id: "cat",
  label: "깜냥이",
  url: "asset://localhost/app-data/vrms/cat.vrm",
  source: "user",
};

// Build a real createSpeakerSelection over an explicit manifest (default first id).
export function makeSpeakerSelection(ids: string[] = ["natsume", "ayase", "rena"]) {
  const available: SpeakerOption[] = ids.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    ref_url: `/references/${id}.wav`,
  }));
  return createSpeakerSelection({ available, defaultValue: available[0].id });
}

// A user (imported) voice mirroring voice-import's output shape.
export const USER_VOICE: SpeakerOption = {
  id: "myvoice",
  label: "내 목소리",
  ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
  source: "user",
};

export function defaultQcArgs(mount: HTMLElement) {
  return {
    mount,
    settings: makeSettings(),
    idleThrottleSettings: createFlagSettings(true),
    sourceProvider: makeSourceProvider(),
    voiceStatus: makeVoiceStatus(),
    lipsync: createLipsyncSettings(),
    vad: createVadSettings(),
    onGainPreview: vi.fn(),
    onGainPreviewEnd: vi.fn(),
    agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
    endpointsSettings: createEndpointsSettings(),
    proactiveSettings: createProactiveSettings(),
    scheduleSettings: createScheduleSettings(),
    workflowSettings: createWorkflowSettings(),
    chatKeySettings: createChatKeySettings(),
    sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
    ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
    onPopOut: vi.fn(),
    vrmSelection: createVrmSelection({
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
      ],
      defaultValue: "/vrms/carlotta.vrm",
    }),
    swapVrm: vi.fn(async () => {}),
    importVrm: vi.fn(async () => {}),
    removeUserVrm: vi.fn(async () => {}),
    speakerSelection: createSpeakerSelection({
      available: [{ id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" }],
      defaultValue: "natsume",
    }),
    swapSpeaker: vi.fn(async () => {}),
    refreshSpeaker: vi.fn(async () => {}),
    pickVoiceImport: vi.fn(async () => null),
    commitVoiceImport: vi.fn(async () => {}),
    removeVoice: vi.fn(async () => {}),
  };
}
