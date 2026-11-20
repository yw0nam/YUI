export interface TurnNoticeAction {
  label: string;
  onClick(): void;
}

export interface TurnNotice {
  message: string;
  action?: TurnNoticeAction;
}

export interface TurnNoticeStore {
  get(): TurnNotice | null;
  show(notice: TurnNotice): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createTurnNotice(): TurnNoticeStore {
  return {
    get: () => null,
    show() {},
    clear() {},
    subscribe: () => () => {},
    dispose() {},
  };
}
