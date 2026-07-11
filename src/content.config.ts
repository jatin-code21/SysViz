import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const concepts = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/concepts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    updated: z.coerce.date(),
    links: z
      .array(z.object({ label: z.string(), href: z.string().url() }))
      .default([]),
  }),
});

export const collections = { concepts };
