export const attachDock = async (): Promise<boolean> => false;
export const detachDock = async (): Promise<void> => {};
export const setPetPositionPhysical = async (_x: number, _y: number): Promise<void> => {};
export const onSettingsStageClosed =
  (_label: string, _cb: () => void): (() => void) =>
  () => {};
