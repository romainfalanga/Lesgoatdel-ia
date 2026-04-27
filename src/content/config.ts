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

const recaps = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    period: z.enum(['daily', 'weekly', 'monthly']),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    creatorCount: z.number(),
    videoCount: z.number(),
    creators: z.array(z.string()),
    model: z.string().optional(),
  }),
});

export const collections = { articles, recaps };
