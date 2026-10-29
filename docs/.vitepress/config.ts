import { defineConfig, type DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

interface DocLink {
  text: string
  link: string
  items?: DocLink[]
}

interface DocGroup {
  text: string
  items: DocLink[]
}

/** A nav dropdown shows a group's own pages; a page's children stay in the sidebar. */
function navGroups(groups: DocGroup[]): DefaultTheme.NavItemChildren[] {
  return groups.map((group) => ({
    text: group.text,
    items: group.items.map(({ text, link }) => ({ text, link })),
  }))
}

// One list for the sidebar and the top nav, in six reader groups. A page is
// declared here once, and both menus read it from these constants.
const START: DocGroup = {
  text: 'Start',
  items: [
    { text: 'Install', link: '/guide/installation' },
    { text: 'How YUI works', link: '/guide/how-it-works' },
    { text: 'Install with a coding agent', link: '/guide/install' },
    { text: 'Connect a backend', link: '/guide/connect-a-backend' },
    { text: 'Voice in and out', link: '/guide/voice' },
  ],
}

const USE: DocGroup = {
  text: 'Use',
  items: [
    { text: 'What she can do', link: '/guide/capabilities' },
    { text: 'Features', link: '/guide/features' },
    { text: 'Controls', link: '/guide/controls' },
    { text: 'Settings', link: '/guide/settings' },
    { text: 'Cards', link: '/guide/cards' },
    { text: 'Plugins', link: '/guide/plugins' },
  ],
}

const EXTEND: DocGroup = {
  text: 'Extend',
  items: [
    { text: 'Write a plugin', link: '/guide/write-a-plugin' },
    { text: 'Send signals from a producer', link: '/guide/signals-producer' },
    { text: 'Motions', link: '/guide/motions' },
    {
      text: 'TTS Emotion',
      link: '/guide/tts-emotion/',
      items: [{ text: 'Irodori', link: '/guide/tts-emotion/irodori' }],
    },
  ],
}

/** The one Releases page, shared by the sidebar group and the top nav. */
const WHATS_NEW: DocLink = { text: "What's new", link: '/guide/whats-new' }

const RELEASES: DocGroup = {
  text: 'Releases',
  items: [WHATS_NEW],
}

const CONFIGURATION: DocGroup = {
  text: 'Configuration',
  items: [{ text: 'Configuration', link: '/reference/configuration' }],
}

const BACKEND_CONTRACT: DocGroup = {
  text: 'Backend contract',
  items: [
    { text: 'Client Context', link: '/reference/client-context' },
    { text: 'Client Tools', link: '/reference/client-tools' },
    { text: 'Push transport', link: '/reference/push-transport' },
    { text: 'Signals Ingress', link: '/reference/signals-ingress' },
  ],
}

const DIAGNOSTICS: DocGroup = {
  text: 'Diagnostics',
  items: [
    { text: 'Logging', link: '/reference/logging' },
    { text: 'Witness Log', link: '/reference/witness-log' },
  ],
}

/** Guide pages meant to be read in order; they get the long-read type. */
const LONG_READ = [
  'guide/installation.md',
  'guide/how-it-works.md',
  'guide/install.md',
  'guide/connect-a-backend.md',
  'guide/voice.md',
  'guide/capabilities.md',
  'guide/cards.md',
  'guide/plugins.md',
  'guide/write-a-plugin.md',
  'guide/signals-producer.md',
  'guide/whats-new.md',
]

// Mermaid colours and font, set once for every diagram. A Markdown file carries
// no %%{init}%% directive, so GitHub draws the same file in its own theme.
const MERMAID = {
  // base is the one theme Mermaid lets a site restyle through themeVariables. The plugin
  // swaps it for dark when <html> has the dark class, and this site forces dark.
  theme: 'base' as const,
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
    // The dark theme keeps its own node fill and border instead of deriving them from
    // primaryColor, so both are pinned to the values base would derive.
    mainBkg: '#241e17',
    nodeBorder: '#eeb154',
  },
}

export default withMermaid(defineConfig({
  title: 'YUI',
  description:
    'Embodied VRM desktop companion: the head, not the brain. YUI renders the body and delegates judgment to the backend agent you select.',
  base: '/YUI/',
  lang: 'en-US',
  cleanUrls: true,
  appearance: 'force-dark',
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/YUI/favicon.png' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: '/YUI/fonts/pretendardjp/pretendardjp-dynamic-subset.css',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'YUI: Embodied VRM Companion' }],
    ['meta', { property: 'og:description', content: 'Embodied VRM desktop companion: the head, not the brain. It renders the body and delegates judgment to the backend agent you select.' }],
    ['meta', { property: 'og:image', content: 'https://yw0nam.github.io/YUI/og-card.png' }],
    ['meta', { property: 'og:url', content: 'https://yw0nam.github.io/YUI/' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'YUI: Embodied VRM Companion' }],
    ['meta', { name: 'twitter:description', content: 'The head, not the brain: a VRM desktop companion that renders the body and delegates judgment to the backend agent you select.' }],
    ['meta', { name: 'twitter:image', content: 'https://yw0nam.github.io/YUI/og-card.png' }],
  ],
  srcExclude: ['agent-guide/**', 'agents/**'],
  transformPageData(pageData) {
    if (LONG_READ.includes(pageData.relativePath)) {
      pageData.frontmatter.pageClass = 'yui-read'
    }
  },
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', items: navGroups([START, USE, EXTEND]) },
      { text: 'Reference', items: navGroups([CONFIGURATION, BACKEND_CONTRACT, DIAGNOSTICS]) },
      { text: WHATS_NEW.text, link: WHATS_NEW.link },
      { text: 'GitHub ↗', link: 'https://github.com/yw0nam/YUI' },
    ],
    sidebar: {
      '/guide/': [START, USE, EXTEND, RELEASES],
      '/reference/': [CONFIGURATION, BACKEND_CONTRACT, DIAGNOSTICS],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/yw0nam/YUI' }],
  },
  mermaid: MERMAID,
  // The plugin pre-bundles mermaid's dependencies by bare name, which pnpm does not
  // hoist; pre-bundling mermaid itself gives the dev server its ESM build.
  vite: { optimizeDeps: { include: ['mermaid'] } },
}))
