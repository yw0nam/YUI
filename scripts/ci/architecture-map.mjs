import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Each map, the roots whose source files its parts must cover, and which files count as source.
export const MAPS = [
  {
    file: "docs/agent-guide/architecture/map.js",
    windows: true,
    cover: ["src", "src-tauri/src"],
    source: /\.(ts|rs)$/,
    skip: /\.(test|d)\.ts$/,
  },
  {
    file: "integrations/hermes/platform/yui/docs/map.js",
    cover: ["integrations/hermes/platform/yui/src"],
    source: /\.py$/,
    skip: /(^|\/)__init__\.py$/,
  },
];
export const MAP = MAPS[0].file;
const KINDS = [
  "call",
  "callback",
  "tauri-event",
  "tauri-command",
  "http",
  "websocket",
  "storage",
  "bridge",
  "user",
];
const TRANSPORTS = ["shared", "request", "push"];
const MODULE_KINDS = ["module", "shell", "external", "person"];
const SHAPE = {
  zones: { id: "string", title: "string", note: "string" },
  modules: {
    id: "string",
    label: "string",
    kind: "string",
    desc: "string",
    col: "number",
    row: "number",
  },
  links: { from: "string", to: "string", label: "string" },
  nodes: { id: "string", module: "string", label: "string", role: "string", paths: "array" },
  edges: {
    id: "string",
    from: "string",
    to: "string",
    carries: "string",
    kind: "string",
    transport: "string",
  },
  flows: { id: "string", title: "string", steps: "array" },
};
const WINDOW_SHAPE = {
  nodes: { id: "string", label: "string", role: "string" },
  edges: { id: "string", from: "string", to: "string", carries: "string", kind: "string" },
};
const STEP_SHAPE = { from: "string", label: "string", edges: "array" };
const inside = (path, root) => path === root || path.startsWith(`${root}/`);
const typeOf = (value) => (Array.isArray(value) ? "array" : typeof value);

export function parseMap(text) {
  const newline = text.indexOf("\n");
  if (text.slice(0, newline) !== "globalThis.YUI_MAP =") {
    return { problems: ["parsing: first line must be globalThis.YUI_MAP ="] };
  }
  try {
    return { map: JSON.parse(text.slice(newline + 1)), problems: [] };
  } catch {
    return { problems: ["parsing: invalid JSON"] };
  }
}

function shapeProblems(map, scope) {
  if (typeOf(map) !== "object" || map === null) return ["shape: the map is not an object"];
  const problems = [];
  const list = (owner, key, shape, name) => {
    if (!Array.isArray(owner[key])) {
      problems.push(`shape: ${name} is not a list`);
      return;
    }
    for (const [index, item] of owner[key].entries()) {
      for (const [field, type] of Object.entries(shape)) {
        if (typeOf(item?.[field]) !== type)
          problems.push(`shape: ${name} ${item?.id ?? index + 1} ${field} is not a ${type}`);
      }
    }
  };
  for (const [key, shape] of Object.entries(SHAPE)) list(map, key, shape, key);
  const windows = scope.windows || map.windows !== undefined;
  if (windows && (typeOf(map.windows) !== "object" || map.windows === null))
    problems.push("shape: windows is not an object");
  else if (windows)
    for (const [key, shape] of Object.entries(WINDOW_SHAPE))
      list(map.windows, key, shape, `windows ${key}`);
  for (const flow of Array.isArray(map.flows) ? map.flows : []) {
    if (Array.isArray(flow?.steps)) list(flow, "steps", STEP_SHAPE, `${flow.id} steps`);
  }
  for (const link of Array.isArray(map.links) ? map.links : []) {
    if ((link?.fromPort === undefined) !== (link?.toPort === undefined))
      problems.push(`shape: link ${link.from} ${link.to} has one port of two`);
  }
  return problems;
}

export function checkMap(map, files, scope = MAPS[0]) {
  const problems = shapeProblems(map, scope);
  if (problems.length) return problems;
  const windows = map.windows ?? { nodes: [], edges: [] };
  const entries = new Map(files.map((file) => [file.path, file]));
  const exists = (path) => entries.has(path) || files.some((file) => inside(file.path, path));
  const claims = map.nodes.flatMap((node) => node.paths);
  const seenPaths = new Set();
  for (const path of claims) {
    if (!exists(path)) problems.push(`paths: ${path} does not exist`);
    if (seenPaths.has(path)) problems.push(`coverage: ${path} is listed more than once`);
    seenPaths.add(path);
  }
  const sources = files.filter(
    (file) =>
      !file.directory &&
      scope.cover.some((root) => inside(file.path, root)) &&
      scope.source.test(file.path) &&
      !scope.skip.test(file.path),
  );
  const children = new Map();
  const climb = (start) => {
    let child = start;
    for (let parent = dirname(child); child !== "."; child = parent, parent = dirname(child)) {
      if (!scope.cover.some((root) => inside(parent, root))) break;
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent).add(child);
    }
  };
  for (const { path } of sources) {
    if (!claims.some((claim) => inside(path, claim)))
      problems.push(`coverage: ${path} has no part`);
    climb(dirname(path));
  }
  for (const path of claims) climb(entries.get(path)?.directory ? path : dirname(path));
  const claimed = (directory) => claims.some((path) => inside(path, directory));
  for (const directories of children.values()) {
    if ([...directories].some(claimed)) {
      for (const directory of directories) {
        if (!claimed(directory) && sources.some((file) => inside(file.path, directory)))
          problems.push(`coverage: ${directory} has no part`);
      }
    }
  }
  for (const [label, ids] of [
    ["zone", map.zones.map((zone) => zone.id)],
    ["module", map.modules.map((module) => module.id)],
    ["link", map.links.map((link) => `${link.from} ${link.to}`)],
    ["part", map.nodes.map((node) => node.id)],
    ["exchange", map.edges.map((edge) => edge.id)],
    ["flow", map.flows.map((flow) => flow.id)],
    ["window", windows.nodes.map((node) => node.id)],
    ["channel", windows.edges.map((edge) => edge.id)],
  ]) {
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`references: duplicate ${label} ${id}`);
      seen.add(id);
    }
  }
  const moduleIds = new Set(map.modules.map((module) => module.id));
  const zoneIds = new Set(map.zones.map((zone) => zone.id));
  const partModule = new Map(map.nodes.map((node) => [node.id, node.module]));
  const exchanges = new Map(map.edges.map((edge) => [edge.id, edge]));
  for (const node of map.nodes) {
    if (!moduleIds.has(node.module))
      problems.push(`references: ${node.id} module ${node.module} does not exist`);
    if (node.map !== undefined && (!entries.has(node.map) || entries.get(node.map).directory))
      problems.push(`map: ${node.id} ${node.map} is not a file`);
  }
  for (const module of map.modules) {
    if (module.zone !== undefined && !zoneIds.has(module.zone))
      problems.push(`references: ${module.id} zone ${module.zone} does not exist`);
    if (!MODULE_KINDS.includes(module.kind))
      problems.push(`enums: ${module.id} kind ${module.kind} is invalid`);
    if (!map.nodes.some((node) => node.module === module.id))
      problems.push(`references: module ${module.id} has no part`);
  }
  for (const [edges, ids, noun] of [
    [map.edges, partModule, "part"],
    [windows.edges, new Set(windows.nodes.map((node) => node.id)), "window"],
  ]) {
    for (const edge of edges) {
      for (const end of ["from", "to"]) {
        if (!ids.has(edge[end]))
          problems.push(`references: ${edge.id} ${end} ${edge[end]} has no ${noun}`);
      }
      if (!KINDS.includes(edge.kind))
        problems.push(`enums: ${edge.id} kind ${edge.kind} is invalid`);
    }
  }
  for (const edge of map.edges) {
    if (
      edge.wiring !== undefined &&
      (!entries.has(edge.wiring) || entries.get(edge.wiring).directory)
    )
      problems.push(`wiring: ${edge.id} ${edge.wiring} is not a file`);
    if (!TRANSPORTS.includes(edge.transport))
      problems.push(`enums: ${edge.id} transport ${edge.transport} is invalid`);
  }
  const ends = (edge) => [partModule.get(edge.from), partModule.get(edge.to)];
  for (const link of map.links) {
    for (const end of ["from", "to"]) {
      if (!moduleIds.has(link[end]))
        problems.push(`references: link ${link.from} ${end} ${link[end]} has no module`);
    }
    if (!map.edges.some((edge) => ends(edge)[0] === link.from && ends(edge)[1] === link.to))
      problems.push(`links: ${link.from} ${link.to} has no exchange`);
  }
  for (const flow of map.flows) {
    for (const [index, step] of flow.steps.entries()) {
      const name = `${flow.id} step ${index + 1}`;
      for (const end of ["from", "to"]) {
        if (step[end] !== undefined && !moduleIds.has(step[end]))
          problems.push(`references: ${name} ${end} ${step[end]} has no module`);
      }
      if (step.transport !== undefined && !["request", "push"].includes(step.transport))
        problems.push(`enums: ${name} transport ${step.transport} is invalid`);
      for (const id of step.edges) {
        const edge = exchanges.get(id);
        if (!edge) {
          problems.push(`references: ${name} exchange ${id} does not exist`);
          continue;
        }
        const [a, b] = ends(edge);
        const own = [step.from, step.to];
        // Either direction fits: a reply (stream chunks, a tool result) travels back over the request's exchange, so a step from the responder cites the same edge.
        const fits =
          step.to === undefined
            ? own.includes(a) || own.includes(b)
            : own.includes(a) && own.includes(b);
        if (!fits) problems.push(`flows: ${name} cites ${id}, which is outside its modules`);
        if (step.transport !== undefined && ![step.transport, "shared"].includes(edge.transport))
          problems.push(`flows: ${name} cites ${id}, which is ${edge.transport} only`);
      }
    }
  }
  return problems;
}

export function listFiles(map, scope = MAPS[0], root = ROOT) {
  const files = new Map();
  function visit(path) {
    if (files.has(path)) return;
    let stat;
    try {
      stat = statSync(resolve(root, path));
    } catch {
      return;
    }
    files.set(path, { path, directory: stat.isDirectory() });
    if (stat.isDirectory()) {
      for (const name of readdirSync(resolve(root, path))) visit(`${path}/${name}`);
    }
  }
  const strings = (list, pick) =>
    (Array.isArray(list) ? list : []).flatMap(pick).filter((path) => typeof path === "string");
  for (const path of [
    ...scope.cover,
    ...strings(map?.nodes, (node) => [...(node?.paths ?? []), node?.map]),
    ...strings(map?.edges, (edge) => edge?.wiring ?? []),
  ])
    visit(path);
  return [...files.values()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const scope of MAPS) {
    const parsed = parseMap(readFileSync(resolve(ROOT, scope.file), "utf8"));
    const problems = parsed.problems.length
      ? parsed.problems
      : checkMap(parsed.map, listFiles(parsed.map, scope), scope);
    for (const problem of problems) console.error(`${scope.file}: ${problem}`);
    if (problems.length) process.exitCode = 1;
  }
}
