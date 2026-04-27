import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  fetchYoutubeFeed,
  fetchYoutubeTranscript,
  estimateDurationLabel,
} from './youtube.js';
import { fetchTikTokFeed } from './tiktok.js';
import {
  callOpenRouter,
  buildVideoMessages,
  parseJsonContent,
  pickModelForVideo,
} from './openrouter.js';
import { isSeen, markSeen } from './state.js';
import { makeArticleSlug, writeMarkdownFile } from './markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
export const CREATORS_PATH = path.join(ROOT, 'src/data/creators.json');

export async function loadCreators() {
  const raw = await fs.readFile(CREATORS_PATH, 'utf8');
  return JSON.parse(raw).creators;
}

export async function fetchFeed(creator, opts = {}) {
  try {
    if (creator.platform === 'youtube') return await fetchYoutubeFeed(creator);
    if (creator.platform === 'tiktok') return await fetchTikTokFeed(creator, opts);
  } catch (err) {
    console.warn(`[feed] ${creator.handle}: ${err.message}`);
  }
  return [];
}

export async function buildArticleForVideo(creator, video) {
  let transcript = null;
  if (creator.platform === 'youtube') {
    transcript = await fetchYoutubeTranscript(video.videoId);
  }

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
    throw new Error(
      `JSON parse failed for ${video.videoId}: ${err.message}\nContent: ${content.slice(0, 500)}`
    );
  }
  if (!parsed.title || !parsed.markdown) {
    throw new Error(
      `Incomplete article for ${video.videoId}: missing title/markdown`
    );
  }
  return { parsed, model, transcript };
}

/**
 * Generate one article and write the markdown file.
 * Options:
 *  - dryRun: bool, skip OpenRouter call
 *  - force: bool, even if marked seen/skipped, re-process
 */
export async function processVideo(creator, video, seen, { dryRun = false, force = false } = {}) {
  const existing = seen.videos[video.videoId];
  if (existing && !force) return false;
  if (existing?.skipped && !force) return false;

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
