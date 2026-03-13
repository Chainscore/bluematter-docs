import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const config: Config = {
  title: 'BlueMatter',
  tagline: 'Cardano Node Implementation',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  markdown: {
    format: 'md',
  },

  url: 'https://chainscore.github.io',
  baseUrl: '/bluematter-docs/',

  organizationName: 'Chainscore',
  projectName: 'bluematter-docs',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  onBrokenAnchors: 'ignore',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  stylesheets: [
    {
      href: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
      type: 'text/css',
      integrity: 'sha384-nB0miv6/jRmo5BNEZ/R5VU7ZjZgRecOkSvnQnYBBoApfk1glX0eHSeCtMqUw7Voy',
      crossorigin: 'anonymous',
    },
    {
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      type: 'text/css',
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          id: 'knowledge',
          path: 'knowledge-base',
          routeBasePath: '/knowledge',
          sidebarPath: './sidebarsKnowledge.ts',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: false,
        pages: {
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'specification',
        path: 'specification',
        routeBasePath: '/spec',
        sidebarPath: './sidebarsSpec.ts',
        remarkPlugins: [remarkMath],
        rehypePlugins: [rehypeKatex],
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'bluematter',
        path: 'bluematter-arch',
        routeBasePath: '/bluematter',
        sidebarPath: './sidebarsArch.ts',
        remarkPlugins: [remarkMath],
        rehypePlugins: [rehypeKatex],
      },
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'BlueMatter',
      items: [
        {
          to: '/knowledge/intro',
          label: 'Knowledge Base',
          position: 'left',
        },
        {
          to: '/spec/notation',
          label: 'Specification',
          position: 'left',
        },
        {
          to: '/bluematter/overview',
          label: 'BlueMatter',
          position: 'left',
        },
        {
          href: 'https://github.com/Chainscore/bluematter-docs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `BlueMatter - Independent Cardano Node Implementation`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
