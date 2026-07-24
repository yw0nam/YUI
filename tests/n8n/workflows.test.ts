import { describe, expect, it } from "vitest";
import gmail from "../../n8n/sg-collect-gmail.ts";
import cleanup from "../../n8n/sg-collect-repo-cleanup.ts";
import repoStatus from "../../n8n/sg-collect-repo-status.ts";
import dispatch from "../../n8n/sg-dispatch.ts";

// Importing a workflow file runs every SDK factory in it, so this smoke test is what
// catches an invalid node config that tsc's structural check lets through.
describe("n8n signal queue workflows", () => {
  it.each([
    ["sg-collect-gmail", gmail],
    ["sg-collect-repo-cleanup", cleanup],
    ["sg-collect-repo-status", repoStatus],
    ["sg-dispatch", dispatch],
  ])("%s builds", (_name, wf) => {
    expect(wf).toBeDefined();
  });
});
