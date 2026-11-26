/** help(topic) inside a script: the API text with no topic, a plugin's skill for plugin:<name>. */

import type { PluginsNamespace } from "./namespace";

export function createHelp(
  api: () => string,
  plugins: Pick<PluginsNamespace, "skill"> | undefined,
): (topic?: unknown) => Promise<string> {
  return async (topic) => {
    // The sandbox hands an omitted argument over as null.
    if (topic === undefined || topic === null) return api();
    if (typeof topic === "string" && topic.startsWith("plugin:") && plugins) {
      return plugins.skill(topic.slice("plugin:".length));
    }
    throw new TypeError("help: topic must be plugin:<name>");
  };
}
