import type { ReactElement, ReactNode, Ref } from "react";

export interface TooltipHostHandle {
  close(): void;
}

export function TooltipHost({
  children,
}: {
  children: ReactNode;
  handle?: Ref<TooltipHostHandle>;
}) {
  return children;
}

export function Tip({ children }: { text: string; children: ReactElement<object> }) {
  return children;
}
