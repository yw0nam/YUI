export interface SwitchRow {
  selector: `.${string}`;
  labelKey: string;
  subKey?: string;
  ariaKey: string;
  tab: "talk" | "input" | "react" | "advanced";
  position?: "after-vad" | "filler";
  accessory?: "agent-port";
  labelIcon?: string;
  isVisible: boolean;
  isAvailable: boolean;
  initialEnabled: boolean;
  getEnabled: () => boolean;
  setEnabled: (value: boolean) => void;
  logKey?: string;
}
