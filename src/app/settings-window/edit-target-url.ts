/** The settings window's URL editing preset `id`, landing on `page` when given; the `edit` param drops when `id` is the window's own preset. */
export function editTargetUrl(href: string, id: string, own: string, page?: string): string {
  const url = new URL(href);
  if (id === own) url.searchParams.delete("edit");
  else url.searchParams.set("edit", id);
  if (page) url.searchParams.set("page", page);
  return url.href;
}
