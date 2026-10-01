import type { EndpointsConfig } from "../../../contract";

/** The phone speaks the push transport only — chat_api is push whatever the settings store says. */
export function pushOnlyEndpoints(getEndpoints: () => EndpointsConfig): () => EndpointsConfig {
  return () => ({ ...getEndpoints(), chat_api: "push" });
}
