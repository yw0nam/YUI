import { describe, expect, it } from "vitest";
import { checkMap, parseMap } from "../../scripts/ci/architecture-map.mjs";

function fixture() {
  return {
    title: "fixture",
    zones: [{ id: "logic", title: "Logic", note: "Runs the turn." }],
    modules: [
      { id: "a", label: "A", kind: "module", zone: "logic", col: 0, row: 0, desc: "Sends." },
      { id: "b", label: "B", kind: "module", zone: "logic", col: 1, row: 0, desc: "Receives." },
    ],
    links: [{ from: "a", to: "b", label: "data" }] as Array<Record<string, unknown>>,
    nodes: [
      { id: "a/part", module: "a", label: "a part", role: "Sends.", paths: ["src/a"] } as {
        id: string;
        module: string;
        label: string;
        role: string;
        paths: string[];
        map?: string;
      },
      { id: "b/part", module: "b", label: "b part", role: "Receives.", paths: ["src/b"] },
    ],
    edges: [
      {
        id: "edge",
        from: "a/part",
        to: "b/part",
        carries: "data",
        kind: "call",
        transport: "shared",
        wiring: "src/a/wire.ts",
      },
    ],
    flows: [
      {
        id: "flow",
        title: "flow",
        steps: [{ from: "a", to: "b", label: "Call", edges: ["edge"] }] as Array<
          Record<string, unknown>
        >,
      },
    ],
    windows: {
      nodes: [{ id: "pet", label: "pet", role: "Shows pet." }],
      edges: [{ id: "channel", from: "pet", to: "pet", carries: "data", kind: "bridge" }],
    },
  };
}
const files = [
  { path: "src", directory: true },
  { path: "src/a", directory: true },
  { path: "src/a/wire.ts", directory: false },
  { path: "src/a/wire.test.ts", directory: false },
  { path: "src/b", directory: true },
  { path: "src/b/main.rs", directory: false },
];

describe("architecture map", () => {
  it("rejects a first line other than the assignment", () => {
    expect(parseMap("globalThis.YUI_MAP={}\n{}").problems).toContain(
      "parsing: first line must be globalThis.YUI_MAP =",
    );
  });
  it("rejects invalid JSON", () => {
    expect(parseMap("globalThis.YUI_MAP =\n{").problems).toContain("parsing: invalid JSON");
  });
  it("accepts a valid map", () => {
    expect(checkMap(fixture(), files)).toEqual([]);
  });
  it("accepts a map without windows", () => {
    const map = fixture();
    Reflect.deleteProperty(map, "windows");
    expect(checkMap(map, files)).toEqual([]);
  });
  it("accepts a part that links to another map file", () => {
    const map = fixture();
    map.nodes[0].map = "src/a/wire.ts";
    expect(checkMap(map, files)).toEqual([]);
  });
  it("checks coverage against the roots and source files of the map's scope", () => {
    const map = fixture();
    map.nodes[0].paths = ["plugin/src/a.py"];
    map.nodes[1].paths = ["plugin/__init__.py"];
    map.edges[0].wiring = "plugin/__init__.py";
    const scope = { cover: ["plugin/src"], source: /\.py$/, skip: /(^|\/)__init__\.py$/ };
    const plugin = [
      { path: "plugin/__init__.py", directory: false },
      { path: "plugin/src", directory: true },
      { path: "plugin/src/__init__.py", directory: false },
      { path: "plugin/src/a.py", directory: false },
      { path: "plugin/src/b.py", directory: false },
    ];
    expect(checkMap(map, plugin, scope)).toEqual(["coverage: plugin/src/b.py has no part"]);
  });
  it("reports a map that is not an object", () => {
    expect(checkMap(null, files)).toEqual(["shape: the map is not an object"]);
  });
  const cases: Array<[string, (map: ReturnType<typeof fixture>) => void, string]> = [
    [
      "a missing list",
      (map) => {
        Reflect.deleteProperty(map, "flows");
      },
      "shape: flows is not a list",
    ],
    [
      "a step without its sending module",
      (map) => {
        Reflect.deleteProperty(map.flows[0].steps[0], "from");
      },
      "shape: flow steps 1 from is not a string",
    ],
    [
      "a link with one port of two",
      (map) => {
        map.links[0].fromPort = [1, 0.5];
      },
      "shape: link a b has one port of two",
    ],
    [
      "a path that does not exist",
      (map) => {
        map.nodes[0].paths.push("missing");
      },
      "paths: missing does not exist",
    ],
    [
      "a source file no part owns",
      (map) => {
        map.nodes[1].paths = [];
      },
      "coverage: src/b/main.rs has no part",
    ],
    [
      "a path listed twice",
      (map) => {
        map.nodes[1].paths.push("src/a");
      },
      "coverage: src/a is listed more than once",
    ],
    [
      "a part of a missing module",
      (map) => {
        map.nodes[0].module = "missing";
      },
      "references: a/part module missing does not exist",
    ],
    [
      "a module with no part",
      (map) => {
        map.nodes[1].module = "a";
      },
      "references: module b has no part",
    ],
    [
      "a module of a missing zone",
      (map) => {
        map.modules[0].zone = "missing";
      },
      "references: a zone missing does not exist",
    ],
    [
      "an exchange from a missing part",
      (map) => {
        map.edges[0].from = "missing";
      },
      "references: edge from missing has no part",
    ],
    [
      "a channel to a missing window",
      (map) => {
        map.windows.edges[0].to = "missing";
      },
      "references: channel to missing has no window",
    ],
    [
      "a duplicate id",
      (map) => {
        map.edges.push({ ...map.edges[0] });
      },
      "references: duplicate exchange edge",
    ],
    [
      "a link with no exchange in its direction",
      (map) => {
        map.links[0] = { from: "b", to: "a", label: "data" };
      },
      "links: b a has no exchange",
    ],
    [
      "a step that cites a missing exchange",
      (map) => {
        map.flows[0].steps[0].edges = ["missing"];
      },
      "references: flow step 1 exchange missing does not exist",
    ],
    [
      "a step that cites an exchange outside its modules",
      (map) => {
        map.flows[0].steps[0].to = "a";
      },
      "flows: flow step 1 cites edge, which is outside its modules",
    ],
    [
      "a request step that cites a push exchange",
      (map) => {
        map.edges[0].transport = "push";
        map.flows[0].steps[0].transport = "request";
      },
      "flows: flow step 1 cites edge, which is push only",
    ],
    [
      "a part map that is not a file",
      (map) => {
        map.nodes[0].map = "src/a";
      },
      "map: a/part src/a is not a file",
    ],
    [
      "a wiring path that is not a file",
      (map) => {
        map.edges[0].wiring = "src/a";
      },
      "wiring: edge src/a is not a file",
    ],
    [
      "an invalid kind",
      (map) => {
        map.edges[0].kind = "invalid";
      },
      "enums: edge kind invalid is invalid",
    ],
    [
      "an invalid transport",
      (map) => {
        map.edges[0].transport = "invalid";
      },
      "enums: edge transport invalid is invalid",
    ],
  ];
  it.each(cases)("reports %s", (_name, mutate, problem) => {
    const map = fixture();
    mutate(map);
    expect(checkMap(map, files)).toContain(problem);
  });
  it("reports a new folder beside the folders of other parts", () => {
    expect(
      checkMap(fixture(), [
        ...files,
        { path: "src/newthing", directory: true },
        { path: "src/newthing/file.ts", directory: false },
      ]),
    ).toContain("coverage: src/newthing has no part");
  });
});
