export type VoiceInputState = "idle" | "listening" | "asr" | "fired" | "error";

export interface VoiceInputStatusSnapshot {
  state: VoiceInputState;
  label: string;
  detail: string;
  visible: boolean;
}

export interface VoiceInputStatus {
  get(): VoiceInputStatusSnapshot;
  set(state: VoiceInputState, detail?: string): void;
  subscribe(listener: (snapshot: VoiceInputStatusSnapshot) => void): () => void;
  dispose(): void;
}

const STATE_COPY: Record<VoiceInputState, VoiceInputStatusSnapshot> = {
  idle: {
    state: "idle",
    label: "Idle",
    detail: "Voice input is off",
    visible: false,
  },
  listening: {
    state: "listening",
    label: "듣는 중",
    detail: "Speech active",
    visible: true,
  },
  asr: {
    state: "asr",
    label: "ASR 전송",
    detail: "Posting audio segment",
    visible: true,
  },
  fired: {
    state: "fired",
    label: "전달됨",
    detail: "Voice segment fired",
    visible: true,
  },
  error: {
    state: "error",
    label: "오류",
    detail: "Voice input error",
    visible: true,
  },
};

export function createVoiceInputStatus(): VoiceInputStatus {
  let snapshot = clone(STATE_COPY.idle);
  const listeners = new Set<(snapshot: VoiceInputStatusSnapshot) => void>();

  function notify(): void {
    const next = clone(snapshot);
    for (const listener of listeners) listener(next);
  }

  return {
    get() {
      return clone(snapshot);
    },

    set(state, detail) {
      const next = clone(STATE_COPY[state]);
      if (detail !== undefined) next.detail = detail;
      if (snapshot.state === next.state && snapshot.detail === next.detail) return;
      snapshot = next;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      listeners.clear();
    },
  };
}

function clone(snapshot: VoiceInputStatusSnapshot): VoiceInputStatusSnapshot {
  return { ...snapshot };
}
