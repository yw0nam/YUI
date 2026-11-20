import type { PageRequest } from "../../settings/panels/settings-pages";

/** The settings window's URL editing preset `id`, landing on the requested page and focus when given; the `edit` param drops when `id` is the window's own preset. */
export function editTargetUrl(
  href: string,
  id: string,
  own: string,
  request?: PageRequest,
): string {
  const url = new URL(href);
  if (id === own) url.searchParams.delete("edit");
  else url.searchParams.set("edit", id);
  if (request) url.searchParams.set("page", request.page);
  if (request?.focus) url.searchParams.set("focus", request.focus);
  return url.href;
}
