/** jsdom has no modal dialog: the stubs open and close the element and fire its close event. */
export function stubModalDialog(): void {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

/** Closes every open dialog so each drops its document listener. */
export function closeDialogs(): void {
  for (const d of document.querySelectorAll("dialog")) d.close();
}
