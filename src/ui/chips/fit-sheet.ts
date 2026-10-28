const MARGIN = 8;
const LIFT = "--yui-sigdetails-lift";

/** Lifts `sheet` just enough to end MARGIN px above the window bottom; caps it to the window and lets it scroll when taller. */
export function fitSheet(sheet: HTMLElement): void {
  sheet.style.removeProperty(LIFT);
  sheet.style.removeProperty("max-height");
  const rect = sheet.getBoundingClientRect();
  const room = window.innerHeight - 2 * MARGIN;
  let lift = rect.bottom - (window.innerHeight - MARGIN);
  if (rect.height > room) {
    sheet.style.maxHeight = `${room}px`;
    lift = rect.top - MARGIN;
  }
  if (lift > 0) sheet.style.setProperty(LIFT, `${lift}px`);
}
