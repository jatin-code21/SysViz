// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import expressiveCode from 'astro-expressive-code';
import tailwindcss from '@tailwindcss/vite';
import rehypeSections from './plugins/rehype-sections.mjs';

// https://astro.build/config
export default defineConfig({
  // expressiveCode must be registered before mdx so code blocks in .mdx are processed
  integrations: [
    expressiveCode({
      themes: ['github-dark'],
      styleOverrides: {
        borderRadius: '10px',
        borderColor: '#26262e',
        codeFontFamily: '"JetBrains Mono Variable", "Fira Code", monospace',
        codeFontSize: '0.82rem',
        codeBackground: '#0f0f14',
        frames: {
          editorActiveTabBackground: '#0f0f14',
          editorTabBarBackground: '#131318',
          terminalBackground: '#0f0f14',
          terminalTitlebarBackground: '#131318',
          shadowColor: 'transparent',
        },
      },
    }),
    mdx(),
    react(),
  ],
  markdown: {
    rehypePlugins: [rehypeSections],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
