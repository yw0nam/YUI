/** A more fold: a chevron summary over its rows, closed by default. */

import type { ReactNode } from "react";

export interface DisclosureProps {
  /** The summary's text; the caller passes the translated label. */
  label: string;
  children: ReactNode;
}

export function Disclosure({ label, children }: DisclosureProps) {
  return (
    <details className="yui-more">
      <summary>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {label}
      </summary>
      {children}
    </details>
  );
}
