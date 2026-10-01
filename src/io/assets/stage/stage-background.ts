/**
 * Stage background store — which backdrop the phone's stage shows: the warm default, or a stored
 * user image. The image is the copied file's name and filesystem path; the URL is resolved where
 * it is drawn. Persisted in localStorage under `yui.stage-background`.
 */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../../../settings/persisted-store";
import { isSafeSanitizedId } from "../safe-id";

export type StageMode = "default" | "image";

interface StageImage {
  /** The stored file name including its extension. */
  id: string;
  /** The copied file's filesystem path. */
  path: string;
}

export interface StageBackground {
  mode: StageMode;
  image: StageImage | null;
}

export type StageBackgroundStore = ReturnType<typeof createStageBackground>;

const STORAGE_KEY = "yui.stage-background";
const IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "webp"];
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

const DEFAULT: StageBackground = { mode: "default", image: null };

/** A stored file name: a safe stem plus one of the stored image extensions. */
function isSafeFileName(id: string): boolean {
  const dot = id.lastIndexOf(".");
  return (
    dot > 0 && isSafeSanitizedId(id.slice(0, dot)) && IMAGE_EXTENSIONS.includes(id.slice(dot + 1))
  );
}

/** A filesystem path: a scheme prefix would let a stored value pass as a URL, a drive letter is not one. */
function isFilesystemPath(path: string): boolean {
  return path.length > 0 && (WINDOWS_DRIVE.test(path) || !URL_SCHEME.test(path));
}

function parse(loaded: unknown): StageBackground {
  if (!isPlainObject(loaded)) return { ...DEFAULT };
  const { mode, image } = loaded as { mode?: unknown; image?: unknown };
  if (mode !== "default" && mode !== "image") return { ...DEFAULT };
  if (image === null) return { ...DEFAULT };
  if (!isPlainObject(image)) return { ...DEFAULT };
  const { id, path } = image as { id?: unknown; path?: unknown };
  if (typeof id !== "string" || typeof path !== "string") return { ...DEFAULT };
  if (!isSafeFileName(id) || !isFilesystemPath(path)) return { ...DEFAULT };
  return { mode, image: { id, path } };
}

export function createStageBackground(opts?: { storage?: PersistedStorage<StageBackground> }) {
  const core = createPersistedStore<StageBackground>({
    storage: opts?.storage ?? localStorageStore<StageBackground>(STORAGE_KEY),
    defaults: DEFAULT,
    parse,
    equals: (a, b) =>
      a.mode === b.mode && a.image?.id === b.image?.id && a.image?.path === b.image?.path,
    clone: (v) => ({ mode: v.mode, image: v.image ? { ...v.image } : null }),
  });

  return {
    get: core.get,
    /** Select a mode; "image" without a stored image is ignored. */
    setMode(mode: StageMode): void {
      const { image } = core.current();
      if (mode === "image" && !image) return;
      core.commit({ mode, image });
    },
    /** Store an image and select it in one commit. */
    setImage(image: StageImage): void {
      core.commit({ mode: "image", image: { ...image } });
    },
    clearImage(): void {
      core.commit({ mode: "default", image: null });
    },
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}
