/** What a window's "Start fresh" announces: the bridge event, then this pet window's own greeting once bound. */
export function createSessionResetAnnouncer(emit: (presetId: string) => void, presetId: string) {
  let greetLocal = (): void => {};
  return {
    announce(): void {
      emit(presetId);
      greetLocal();
    },
    bindGreeting(greet: () => void): void {
      greetLocal = greet;
    },
  };
}
