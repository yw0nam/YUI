/** Dotted-path reads and writes over the settings document. */

export interface JsonLeaf {
  keys: readonly string[];
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getIn(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

export function setIn(root: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const base = isRecord(root) ? root : {};
  return { ...base, [head]: setIn(base[head], rest, value) };
}

/** Every leaf of a JSON object, with its key path; an empty object is a leaf. */
export function leaves(root: unknown, prefix: readonly string[] = []): JsonLeaf[] {
  if (!isRecord(root)) return [];
  const out: JsonLeaf[] = [];
  for (const [key, child] of Object.entries(root)) {
    const keys = [...prefix, key];
    if (isRecord(child) && Object.keys(child).length > 0) out.push(...leaves(child, keys));
    else out.push({ keys, value: child });
  }
  return out;
}
