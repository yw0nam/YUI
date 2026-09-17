/**
 * reflectUnlessEditing — writes a store value onto an input, skipping the write while the user is
 * actively editing it (document has focus and the input is the active element), so a store update
 * mid-edit doesn't clobber what's being typed. Also skips when the value already matches.
 */
export function reflectUnlessEditing(el: HTMLInputElement, next: string): void {
  if (document.hasFocus() && document.activeElement === el) return;
  if (el.value === next) return;
  el.value = next;
}
