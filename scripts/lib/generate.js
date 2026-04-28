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
  buildRelevanceMessages,
  parseJsonContent,
  pickModelForVideo,
  MODELS,
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

/**
 * Ask Gemini whether the video is genuinely about AI. Returns
 * { isAI: bool, reason: string }. Cheap call (flash-lite).
 */
export async function checkVideoRelevance({ videoTitle, description, transcript }) {
  const messages = buildRelevanceMessages({ videoTitle, description, transcript });
  const { content } = await callOpenRouter({
    model: MODELS.filter,
    messages,
    temperature: 0,
    maxTokens: 300,
    responseFormat: { type: 'json_object' },
  });
  try {
    const parsed = parseJsonContent(content);
    return {
      isAI: Boolean(parsed.isAI),
      reason: String(parsed.reason || '').slice(0, 280),
    };
  } catch (err) {
    // On parse failure, lean conservative: keep the video but log.
    console.warn(`[relevance] parse failed: ${err.message} — defaulting to isAI=true`);
    return { isAI: true, reason: 'parse-failure' };
  }
}

export async function buildArticleForVideo(creator, video) {
  let transcript = video._cachedTranscript ?? null;
  if (transcript === null && creator.platform === 'youtube') {
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
 *  - skipRelevance: bool, bypass the AI relevance pre-filter
 */
export async function processVideo(
  creator,
  video,
  seen,
  { dryRun = false, force = false, skipRelevance = false } = {}
) {
  const existing = seen.videos[video.videoId];
  if (existing && !force) return false;
  if (existing?.skipped && !force) return false;

  console.log(`[new] ${creator.handle} → ${video.title}`);
  if (dryRun) {
    markSeen(seen, video.videoId, { creator: creator.id, title: video.title });
    return true;
  }

  // 1. AI relevance pre-filter (cheap call). Skip non-AI videos before any
  //    transcript fetch or article generation.
  if (!skipRelevance) {
    let transcriptForFilter = null;
    if (creator.platform === 'youtube') {
      transcriptForFilter = await fetchYoutubeTranscript(video.videoId);
    }
    let relevance;
    try {
      relevance = await checkVideoRelevance({
        videoTitle: video.title,
        description: video.description,
        transcript: transcriptForFilter,
      });
    } catch (err) {
      console.warn(`[relevance] call failed for ${video.videoId}: ${err.message}`);
      relevance = { isAI: true, reason: 'call-failure' };
    }
    if (!relevance.isAI) {
      console.log(`[skip] not-ai → ${video.videoId} (${relevance.reason})`);
      markSeen(seen, video.videoId, {
        creator: creator.id,
        skipped: 'not-ai',
        reason: relevance.reason,
        publishedAt: video.published || null,
        title: video.title,
      });
      return false;
    }
    // Cache transcript on the video object so buildArticleForVideo doesn't
    // refetch it.
    video._cachedTranscript = transcriptForFilter;
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
