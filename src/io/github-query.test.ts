/**
 * github-query.test.ts — GitHub GraphQL transport seam.
 *
 * Pins the contract for src/io/github-query.ts: a thin layer over the Rust
 * `github_poll` command. All deps are injectable so the suite never touches a
 * real Tauri runtime or the gh CLI.
 */

import { describe, expect, it, vi } from "vitest";
import { githubQuery } from "./github-query";

describe("githubQuery — happy path", () => {
  it("invokes github_poll with the graphql string and parses the JSON result", async () => {
    const canned = { data: { viewer: { login: "octocat" } } };
    const invoke = vi.fn(async () => JSON.stringify(canned));

    const result = await githubQuery("{ viewer { login } }", { invoke });

    expect(invoke).toHaveBeenCalledWith("github_poll", { query: "{ viewer { login } }" });
    expect(result).toEqual(canned);
  });

  it("returns any valid JSON payload the command produces", async () => {
    const canned = { data: { repository: { pullRequests: { nodes: [] } } } };
    const invoke = vi.fn(async () => JSON.stringify(canned));

    const result = await githubQuery("{ repository { pullRequests { nodes { number } } } }", {
      invoke,
    });

    expect(result).toEqual(canned);
  });
});

describe("githubQuery — invoke rejects", () => {
  it("propagates the rejection so the caller can log and skip the poll", async () => {
    const invoke = vi.fn(async (): Promise<string> => {
      throw new Error("gh: not logged in");
    });

    await expect(githubQuery("{ viewer { login } }", { invoke })).rejects.toThrow(
      "gh: not logged in",
    );
  });

  it("propagates gh non-zero exit errors (stderr returned as Error message)", async () => {
    const invoke = vi.fn(async (): Promise<string> => {
      throw new Error("Could not resolve to a Repository");
    });

    await expect(
      githubQuery('{ repository(owner: "x", name: "y") { id } }', { invoke }),
    ).rejects.toThrow("Could not resolve to a Repository");
  });
});
