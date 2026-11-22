/** A control's value written from a store, unless the user is typing in it. */

export function setValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null,
  value: string,
): void {
  if (!el) return;
  if (document.hasFocus() && document.activeElement === el) return;
  if (el.value !== value) el.value = value;
}
