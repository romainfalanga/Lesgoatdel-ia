#!/usr/bin/env node
/**
 * poll-feeds.js — checks every creator's feed, detects new videos,
 * generates articles via Gemini (OpenRouter), commits markdown files.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchYoutubeFeed, fetchYoutubeTranscript, estimateDurationLabel } from './lib/youtube.js';
import { fetchTikTokFeed } from './lib/tiktok.js';
import {
  callOpenRouter,
  buildVideoMessages,
  parseJsonContent,
  pickModelForVideo,
} from './lib/openrouter.js';
import { loadSeen, saveSeen, isSeen, markSeen } from './lib/state.js';
import { makeArticleSlug, writeMarkdownFile } from './lib/markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');

async function loadCreators() {
  const raw = await fs.readFile(path.join(ROOT, 'src/data/creators.json'), 'utf8');
  return JSON.parse(raw).creators;
}

async function fetchFeed(creator) {
  try {
    if (creator.platform === 'youtube') return await fetchYoutubeFeed(creator);
    if (creator.platform === 'tiktok') return await fetchTikTokFeed(creator);
  } catch (err) {
    console.warn(`[feed] ${creator.handle}: ${err.message}`);
  }
  return [];
}

async function buildArticleForVideo(creator, video) {
  let transcript = null;
  if (creator.platform === 'youtube') {
    transcript = await fetchYoutubeTranscript(video.videoId);
  }
  // For TikTok, transcripts are not reliably available without an STT step.
  // The model still has the title, description, thumbnail.

  const model = pickModelForVideo({
    durationSeconds: video.duration,
    transcriptLength: transcript?.length || 0,
  });

  const messages = buildVideoMessages({
    creator,
    videoTitle: video.title,
    videoUrl: video.url,
    platform: creator.platform,
    description: video.description,
    transcript,
    thumbnailUrl: video.thumbnail,
    publishedAt: video.published,
  });

  const { content } = await callOpenRouter({
    model,
    messages,
    temperature: 0.55,
    maxTokens: 4096,
    responseFormat: { type: 'json_object' },
  });

  let parsed;
  try {
    parsed = parseJsonContent(content);
  } catch (err) {
    throw new Error(`JSON parse failed for ${video.videoId}: ${err.message}\nContent: ${content.slice(0, 500)}`);
  }

  if (!parsed.title || !parsed.markdown) {
    throw new Error(`Incomplete article for ${video.videoId}: missing title/markdown`);
  }

  return { parsed, model, transcript };
}

async function processVideo(creator, video, seen, dryRun) {
  if (isSeen(seen, video.videoId)) return false;

  console.log(`[new] ${creator.handle} → ${video.title}`);
  if (dryRun) {
    markSeen(seen, video.videoId, { creator: creator.id, title: video.title });
    return true;
  }

  let result;
  try {
    result = await buildArticleForVideo(creator, video);
  } catch (err) {
    console.warn(`[gen] failed for ${video.videoId}: ${err.message}`);
    return false;
  }

  const { parsed, model } = result;
  const pubDate = video.published ? new Date(video.published) : new Date();

  const slug = makeArticleSlug({
    pubDate,
    creatorId: creator.id,
    title: parsed.title,
  });

  const fm = {
    title: parsed.title,
    description: parsed.description || video.title,
    pubDate,
    creator: creator.name,
    creatorHandle: creator.handle,
    platform: creator.platform,
    videoId: video.videoId,
    videoUrl: video.url,
    thumbnail: video.thumbnail || undefined,
    duration: video.duration ? estimateDurationLabel(video.duration) : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
    model,
  };

  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  await writeMarkdownFile(filePath, fm, parsed.markdown);
  markSeen(seen, video.videoId, {
    creator: creator.id,
    slug,
    title: parsed.title,
    publishedAt: pubDate.toISOString(),
  });
  console.log(`[ok] wrote ${path.relative(ROOT, filePath)} (model: ${model})`);
  return true;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const creators = await loadCreators();
  const seen = await loadSeen();
  let written = 0;

  for (const creator of creators) {
    const videos = await fetchFeed(creator);
    if (!videos.length) {
      console.log(`[feed] ${creator.handle}: no videos`);
      continue;
    }
    // Process oldest-first so generated articles are chronologically ordered.
    videos.reverse();
    for (const video of videos) {
      if (!video.videoId) continue;
      // Skip videos older than 30 days when seeding.
      if (!isSeen(seen, video.videoId) && video.published) {
        const ageDays = (Date.now() - new Date(video.published).getTime()) / 86400000;
        if (ageDays > 30) {
          markSeen(seen, video.videoId, {
            creator: creator.id,
            skipped: 'too-old',
            publishedAt: video.published,
          });
          continue;
        }
      }
      const created = await processVideo(creator, video, seen, dryRun);
      if (created) written++;
    }
  }

  await saveSeen(seen);
  console.log(`[done] new articles: ${written}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
