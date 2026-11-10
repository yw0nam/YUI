/** A file drag over this window, from the native drag-drop events. `over` carries nothing used here. */
export type FileDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "leave" }
  | { type: "drop"; paths: string[] };

export type SubscribeFileDrop = (handler: (e: FileDropEvent) => void) => Promise<() => void>;

/** This webview's file drag events. */
export const subscribeFileDrop: SubscribeFileDrop = async () => () => {};
