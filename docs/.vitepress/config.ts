import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'YUI',
  description:
    'Embodied VRM desktop companion: the head, not the brain. YUI renders the body and delegates judgment to a Hermes backend.',
  base: '/YUI/',
  lang: 'en-US',
  cleanUrls: true,
  appearance: 'force-dark',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/YUI/favicon.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;600;700&display=swap',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'YUI: Embodied VRM Companion' }],
    ['meta', { property: 'og:description', content: 'Embodied VRM desktop companion: the head, not the brain. It renders the body and delegates judgment to a Hermes backend.' }],
    ['meta', { property: 'og:image', content: 'https://yw0nam.github.io/YUI/og-card.png' }],
    ['meta', { property: 'og:url', content: 'https://yw0nam.github.io/YUI/' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'YUI: Embodied VRM Companion' }],
    ['meta', { name: 'twitter:description', content: 'The head, not the brain: a VRM desktop companion that renders the body and delegates judgment to a Hermes backend.' }],
    ['meta', { name: 'twitter:image', content: 'https://yw0nam.github.io/YUI/og-card.png' }],
  ],
  srcExclude: ['agent-guide/**', 'superpowers/**'],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      {
        text: 'Guide',
        items: [{ text: 'Getting Started', link: '/guide/getting-started' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Backend Contract', link: '/reference/backend-contract' },
          { text: 'Motions', link: '/reference/motions' },
          { text: 'Logging', link: '/reference/logging' },
          { text: 'TTS Emotion', link: '/reference/tts-emotion/' },
          { text: 'Mods', link: '/reference/mods' },
        ],
      },
      { text: 'GitHub ↗', link: 'https://github.com/yw0nam/YUI' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [{ text: 'Getting Started', link: '/guide/getting-started' }],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Backend Contract', link: '/reference/backend-contract' },
            { text: 'Motions', link: '/reference/motions' },
            { text: 'Logging', link: '/reference/logging' },
            {
              text: 'TTS Emotion',
              link: '/reference/tts-emotion/',
              items: [
                { text: 'Irodori', link: '/reference/tts-emotion/irodori' },
                { text: 'Fish Speech', link: '/reference/tts-emotion/fishspeech' },
              ],
            },
            { text: 'Mods', link: '/reference/mods' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/yw0nam/YUI' }],
  },
})
