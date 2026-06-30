/**
 * GitHub GraphQL transport seam — shells `gh api graphql` via the Rust command.
 *
 * Swap point for a future PAT/OAuth transport; keep it thin.
 * Outside Tauri the function rejects so the source's poll degrades to skip.
 */

import { isTauri } from "./screen-source-provider";

export interface GithubQueryDeps {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

async function defaultDeps(): Promise<GithubQueryDeps> {
  const { invoke } = await import("@tauri-apps/api/core");
  return { invoke };
}

/**
 * Run a GraphQL query via `gh api graphql` and return the parsed response.
 *
 * Rejects on non-Tauri environments or when `gh` returns a non-zero exit
 * (the raw stderr is surfaced as the rejection reason).
 */
export async function githubQuery(graphql: string, deps?: GithubQueryDeps): Promise<unknown> {
  let d: GithubQueryDeps;
  if (deps) {
    d = deps;
  } else {
    if (!isTauri()) {
      return Promise.reject(new Error("githubQuery: not in Tauri"));
    }
    d = await defaultDeps();
  }
  const raw = await d.invoke<string>("github_poll", { query: graphql });
  return JSON.parse(raw);
}
