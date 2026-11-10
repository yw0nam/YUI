/** A file drag over this window, from the native drag-drop events. `over` carries nothing used here. */
export type FileDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "leave" }
  | { type: "drop"; paths: string[] };

export type SubscribeFileDrop = (handler: (e: FileDropEvent) => void) => Promise<() => void>;

/** This webview's file drag events. */
export const subscribeFileDrop: SubscribeFileDrop = async (handler) => {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "over") return;
    handler(
      payload.type === "leave" ? { type: "leave" } : { type: payload.type, paths: payload.paths },
    );
  });
};
