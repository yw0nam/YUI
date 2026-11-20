/** The settings window's URL editing preset `id`, landing on `page` and `focus` when given; the `edit` param drops when `id` is the window's own preset. */
export function editTargetUrl(
  href: string,
  id: string,
  own: string,
  page?: string,
  focus?: string,
): string {
  const url = new URL(href);
  if (id === own) url.searchParams.delete("edit");
  else url.searchParams.set("edit", id);
  if (page) url.searchParams.set("page", page);
  if (focus) url.searchParams.set("focus", focus);
  return url.href;
}
