/** Dotted-path reads and writes over the settings document. */

export interface JsonLeaf {
  path: string;
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

/** Every non-object leaf of a JSON object, with its dotted path. */
export function leaves(root: unknown, prefix: readonly string[] = []): JsonLeaf[] {
  if (!isRecord(root)) return [];
  const out: JsonLeaf[] = [];
  for (const [key, child] of Object.entries(root)) {
    const path = [...prefix, key];
    if (isRecord(child)) out.push(...leaves(child, path));
    else out.push({ path: path.join("."), value: child });
  }
  return out;
}
