import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'YUI',
  description:
    'Embodied VRM desktop companion — the head, not the brain. YUI renders the body and delegates judgment to a Hermes backend.',
  base: '/YUI/',
  lang: 'en-US',
  cleanUrls: true,
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
