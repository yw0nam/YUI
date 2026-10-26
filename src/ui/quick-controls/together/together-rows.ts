/** The Together page's first section: its switch rows, then the chain cap. */

import { CHAIN_CAP_FIELD } from "../constants";
import { capRowHtml } from "../markup";

export function togetherRowsHtml(switchRowsHtml: string, showChainCap: boolean): string {
  if (!switchRowsHtml && !showChainCap) return "";
  return `
        <div class="yui-sec">
          <div class="yui-group">${switchRowsHtml}${showChainCap ? capRowHtml(CHAIN_CAP_FIELD) : ""}
          </div>
        </div>`;
}
