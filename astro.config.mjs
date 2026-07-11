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
        borderRadius: '8px',
        codeFontFamily: '"Fira Code", "Consolas", monospace',
        codeFontSize: '0.82rem',
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
