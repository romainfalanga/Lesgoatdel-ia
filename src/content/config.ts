import { defineCollection, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    creator: z.string(),
    creatorHandle: z.string(),
    platform: z.enum(['youtube', 'tiktok']),
    videoId: z.string(),
    videoUrl: z.string().url(),
    thumbnail: z.string().url().optional(),
    duration: z.string().optional(),
    tags: z.array(z.string()).default([]),
    model: z.string().optional(),
  }),
});

export const collections = { articles };
