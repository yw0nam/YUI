import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_MAP = "docs/agent-guide/architecture/map.js";
const KINDS = [
  "call",
  "callback",
  "tauri-event",
  "tauri-command",
  "http",
  "websocket",
  "storage",
  "bridge",
];
const TRANSPORTS = ["shared", "request", "push"];
const inside = (path, root) => path === root || path.startsWith(`${root}/`);

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

export function checkMap(map, files) {
  const problems = [];
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
      file.size > 0 &&
      map.cover.some((root) => inside(file.path, root)) &&
      /\.(ts|rs|py)$/.test(file.path) &&
      !/\.(test|d)\.ts$/.test(file.path) &&
      !file.path.split("/").at(-1).includes("test-helpers") &&
      !/(^|\/)(tests|__pycache__)(\/|$)/.test(file.path),
  );
  const children = new Map();
  for (const { path } of sources) {
    if (!claims.some((claim) => inside(path, claim)))
      problems.push(`coverage: ${path} has no node`);
    let child = dirname(path);
    for (let parent = dirname(child); child !== "."; child = parent, parent = dirname(child)) {
      if (!map.cover.some((root) => inside(parent, root))) break;
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent).add(child);
    }
  }
  for (const path of claims) {
    let child = entries.get(path)?.directory ? path : dirname(path);
    for (let parent = dirname(child); child !== "."; child = parent, parent = dirname(child)) {
      if (!map.cover.some((root) => inside(parent, root))) break;
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent).add(child);
    }
  }
  const claimed = (directory) => claims.some((path) => inside(path, directory));
  for (const directories of children.values()) {
    if ([...directories].some(claimed)) {
      for (const directory of directories) {
        if (!claimed(directory) && sources.some((file) => inside(file.path, directory)))
          problems.push(`coverage: ${directory} has no node`);
      }
    }
  }
  for (const [label, items] of [
    ["node", map.nodes],
    ["edge", map.edges],
    ["flow", map.flows],
  ]) {
    const ids = new Set();
    for (const { id } of items) {
      if (ids.has(id)) problems.push(`references: duplicate ${label} id ${id}`);
      ids.add(id);
    }
  }
  const nodeIds = new Set(map.nodes.map((node) => node.id));
  const edgeIds = new Set(map.edges.map((edge) => edge.id));
  const layerIds = new Set(map.layers.map((layer) => layer.id));
  for (const node of map.nodes) {
    if (!layerIds.has(node.layer))
      problems.push(`references: ${node.id} layer ${node.layer} does not exist`);
  }
  for (const [edges, ids, noun] of [
    [map.edges, nodeIds, "node"],
    [map.windows?.edges ?? [], new Set(map.windows?.nodes.map((node) => node.id)), "window"],
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
    if (edge.wiring && (!entries.has(edge.wiring) || entries.get(edge.wiring).directory))
      problems.push(`wiring: ${edge.id} ${edge.wiring} is not a file`);
    if (!TRANSPORTS.includes(edge.transport))
      problems.push(`enums: ${edge.id} transport ${edge.transport} is invalid`);
  }
  for (const flow of map.flows) {
    for (const [index, step] of flow.steps.entries()) {
      for (const id of step.edges) {
        if (!edgeIds.has(id)) problems.push(`references: ${flow.id} edge ${id} does not exist`);
      }
      if (step.transport !== undefined && !["request", "push"].includes(step.transport))
        problems.push(`enums: ${flow.id} step ${index + 1} transport ${step.transport} is invalid`);
    }
  }
  return problems;
}

export function listFiles(map, root = ROOT) {
  const files = new Map();
  function visit(path) {
    if (files.has(path)) return;
    let stat;
    try {
      stat = statSync(resolve(root, path));
    } catch {
      return;
    }
    files.set(path, { path, directory: stat.isDirectory(), size: stat.size });
    if (stat.isDirectory()) {
      for (const name of readdirSync(resolve(root, path))) visit(`${path}/${name}`);
    }
  }
  for (const path of [
    ...map.cover,
    ...map.nodes.flatMap((node) => node.paths),
    ...map.edges.flatMap((edge) => (edge.wiring ? [edge.wiring] : [])),
  ])
    visit(path);
  return [...files.values()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  for (const path of paths.length ? paths : [DEFAULT_MAP]) {
    try {
      const parsed = parseMap(readFileSync(resolve(ROOT, path), "utf8"));
      const problems = parsed.map ? checkMap(parsed.map, listFiles(parsed.map)) : parsed.problems;
      for (const problem of problems) console.error(problem);
      if (problems.length) process.exitCode = 1;
    } catch (error) {
      console.error(`parsing: ${relative(ROOT, resolve(ROOT, path))} ${error.message}`);
      process.exitCode = 1;
    }
  }
}
