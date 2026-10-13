import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMap, parseMap } from "../../scripts/ci/architecture-map.mjs";

function fixture() {
  return {
    title: "fixture",
    cover: ["src"],
    layers: [{ id: "core", label: "core" }],
    nodes: [{ id: "core", layer: "core", label: "core", role: "Owns sources.", paths: ["src"] }],
    edges: [
      {
        id: "edge",
        from: "core",
        to: "core",
        carries: "data",
        kind: "call",
        transport: "shared",
        wiring: "src/main.ts",
      },
    ],
    flows: [
      {
        id: "flow",
        title: "flow",
        steps: [{ edges: ["edge"], text: "Call", transport: "request" }],
      },
    ],
    windows: {
      nodes: [{ id: "pet", label: "pet", role: "Shows pet." }],
      edges: [{ id: "window-edge", from: "pet", to: "pet", carries: "data", kind: "tauri-event" }],
    },
  };
}
const files = [
  { path: "src", directory: true, size: 0 },
  { path: "src/main.ts", directory: false, size: 1 },
];

describe("architecture map", () => {
  it("rejects an incorrect first line", () => {
    expect(parseMap("globalThis.YUI_MAP={}\n{}").problems).toContain(
      "parsing: first line must be globalThis.YUI_MAP =",
    );
  });
  it("rejects invalid JSON", () => {
    expect(parseMap("globalThis.YUI_MAP =\n{").problems).toContain("parsing: invalid JSON");
  });
  it("accepts a valid map and excluded source files", () => {
    const excluded = [
      "orphan.test.ts",
      "orphan.d.ts",
      "test-helpers.ts",
      "tests/orphan.py",
      "__pycache__/orphan.py",
      "empty.rs",
    ];
    expect(
      checkMap(fixture(), [
        ...files,
        ...excluded.map((path) => ({
          path: `src/${path}`,
          directory: false,
          size: path === "empty.rs" ? 0 : 1,
        })),
      ]),
    ).toEqual([]);
  });
  const cases: Array<[string, (map: ReturnType<typeof fixture>) => void, string]> = [
    [
      "missing path",
      (map) => {
        map.nodes[0].paths.push("missing");
      },
      "paths: missing does not exist",
    ],
    [
      "unowned source",
      (map) => {
        map.nodes[0].paths = [];
      },
      "coverage: src/main.ts has no node",
    ],
    [
      "duplicate path across nodes",
      (map) => {
        map.nodes.push({ ...map.nodes[0], id: "other" });
      },
      "coverage: src is listed more than once",
    ],
    [
      "duplicate path in one node",
      (map) => {
        map.nodes[0].paths.push("src");
      },
      "coverage: src is listed more than once",
    ],
    [
      "missing edge source",
      (map) => {
        map.edges[0].from = "missing";
      },
      "references: edge from missing has no node",
    ],
    [
      "missing edge target",
      (map) => {
        map.edges[0].to = "missing";
      },
      "references: edge to missing has no node",
    ],
    [
      "missing flow edge",
      (map) => {
        map.flows[0].steps[0].edges = ["missing"];
      },
      "references: flow edge missing does not exist",
    ],
    [
      "missing layer",
      (map) => {
        map.nodes[0].layer = "missing";
      },
      "references: core layer missing does not exist",
    ],
    [
      "duplicate node id",
      (map) => {
        map.nodes.push({ ...map.nodes[0], paths: [] });
      },
      "references: duplicate node id core",
    ],
    [
      "duplicate edge id",
      (map) => {
        map.edges.push({ ...map.edges[0] });
      },
      "references: duplicate edge id edge",
    ],
    [
      "duplicate flow id",
      (map) => {
        map.flows.push({ ...map.flows[0] });
      },
      "references: duplicate flow id flow",
    ],
    [
      "missing window source",
      (map) => {
        map.windows.edges[0].from = "missing";
      },
      "references: window-edge from missing has no window",
    ],
    [
      "missing window target",
      (map) => {
        map.windows.edges[0].to = "missing";
      },
      "references: window-edge to missing has no window",
    ],
    [
      "missing wiring file",
      (map) => {
        map.edges[0].wiring = "missing";
      },
      "wiring: edge missing is not a file",
    ],
    [
      "directory wiring",
      (map) => {
        map.edges[0].wiring = "src";
      },
      "wiring: edge src is not a file",
    ],
    [
      "invalid kind",
      (map) => {
        map.edges[0].kind = "invalid";
      },
      "enums: edge kind invalid is invalid",
    ],
    [
      "invalid edge transport",
      (map) => {
        map.edges[0].transport = "invalid";
      },
      "enums: edge transport invalid is invalid",
    ],
    [
      "invalid step transport",
      (map) => {
        map.flows[0].steps[0].transport = "shared";
      },
      "enums: flow step 1 transport shared is invalid",
    ],
  ];
  it.each(cases)("reports %s", (_name, mutate, problem) => {
    const map = fixture();
    mutate(map);
    expect(checkMap(map, files)).toContain(problem);
  });
  it("reports an incompletely split folder", () => {
    const map = fixture();
    map.nodes[0].paths.push("src/claimed/file.py");
    expect(
      checkMap(map, [
        ...files,
        { path: "src/claimed/file.py", directory: false, size: 1 },
        { path: "src/newthing/file.rs", directory: false, size: 1 },
      ]),
    ).toContain("coverage: src/newthing has no node");
  });
  it("checks the real map", () => {
    const result = spawnSync(process.execPath, [resolve("scripts/ci/architecture-map.mjs")], {
      encoding: "utf8",
    });
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
