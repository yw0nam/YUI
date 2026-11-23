/** A more fold: a chevron summary over its rows, closed by default. */

import type { ReactNode } from "react";

export interface DisclosureProps {
  /** The summary's text; the caller passes the translated label. */
  label: string;
  children: ReactNode;
}

export function Disclosure(_props: DisclosureProps): ReactNode {
  return null;
}