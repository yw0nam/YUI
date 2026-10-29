import type { MermaidConfig } from 'mermaid'

// Mermaid colours and font, set once for every diagram. A Markdown file carries
// no %%{init}%% directive, so GitHub draws the same file in its own theme.
export const MERMAID = {
  startOnLoad: false,
  // base is the one theme Mermaid lets a site restyle through themeVariables.
  theme: 'base',
  // SVG text labels: htmlLabels would draw <foreignObject> HTML that the site CSS restyles.
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  // Narrow actors and wrapped messages keep a sequence diagram near the column width, so it shrinks less.
  sequence: { actorMargin: 32, width: 120, messageMargin: 32, wrap: true },
  // A system font needs no loading, so the labels are measured with the font they are drawn in.
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  // The mock's flowchart and sequence colours (Hearthlight tokens in hex), in one set.
  themeVariables: {
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    fontSize: '14px',
    background: '#17130d',
    primaryColor: '#241e17',
    primaryBorderColor: '#eeb154',
    primaryTextColor: '#f3eee6',
    secondaryColor: '#1d1812',
    tertiaryColor: '#130f0a',
    lineColor: '#a69d91',
    textColor: '#f3eee6',
    edgeLabelBackground: '#17130d',
    clusterBkg: '#130f0a',
    clusterBorder: '#4a4136',
    titleColor: '#beb6ac',
    actorBkg: '#241e17',
    actorBorder: '#eeb154',
    actorTextColor: '#f3eee6',
    actorLineColor: '#a69d91',
    signalColor: '#a69d91',
    signalTextColor: '#f3eee6',
    labelBoxBkgColor: '#241e17',
    labelBoxBorderColor: '#eeb154',
    labelTextColor: '#f3eee6',
    loopTextColor: '#f3eee6',
    noteBkgColor: '#241e17',
    noteTextColor: '#f3eee6',
    noteBorderColor: '#eeb154',
  },
} satisfies MermaidConfig
