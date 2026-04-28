#!/usr/bin/env node
/**
 * regenerate.js — re-process every article already in src/content/articles/ :
 *  1. Refetch the original video metadata (yt-dlp --dump-json on the URL).
 *  2. Apply the new AI relevance filter.
 *     - If not AI → delete the article and mark seen.json skipped: 'not-ai'.
 *  3. Otherwise regenerate the markdown with the new content-focused prompt,
 *     keeping the existing slug (URL stable).
 *
 * Usage:
 *   node scripts/regenerate.js [--limit N] [--only <creator-id>]
 *   node scripts/regenerate.js                         # reads
 *                                                     #  data/regenerate-request.json
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSeen, saveSeen, markSeen } from './lib/state.js';
import {
  loadCreators,
  buildArticleForVideo,
  checkVideoRelevance,
} from './lib/generate.js';
import { fetchYoutubeTranscript, estimateDurationLabel } from './lib/youtube.js';
import { writeMarkdownFile } from './lib/markdown.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const REQUEST_PATH = path.join(ROOT, 'data/regenerate-request.json');
const ARCHIVE_PATH = path.join(ROOT, 'data/regenerate-archive.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep-non-ai') args.keepNonAI = true;
  }
  return args;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fmRaw = m[1];
  const data = {};
  for (const line of fmRaw.split('\n')) {
    const lm = line.match(/^([\w-]+):\s*(.*)$/);
    if (!lm) continue;
    let value = lm[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    data[lm[1]] = value;
  }
  return data;
}

async function ytDlpDumpJson(url) {
  const { stdout } = await execFileP(
    'yt-dlp',
    ['--dump-single-json', '--no-warnings', url],
    { maxBuffer: 1024 * 1024 * 32 }
  );
  return JSON.parse(stdout);
}

function videoFromYtDlp(meta, fallback) {
  return {
    videoId: String(meta.id || fallback.videoId),
    title: meta.title || fallback.title,
    url: meta.webpage_url || fallback.url,
    published: meta.timestamp
      ? new Date(meta.timestamp * 1000).toISOString()
      : fallback.published || null,
    thumbnail: meta.thumbnail || fallback.thumbnail || null,
    description: meta.description || fallback.description || '',
    duration: meta.duration || fallback.duration || null,
  };
}

async function readArticleEntries() {
  const files = (await fs.readdir(ARTICLES_DIR)).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const file of files) {
    const filePath = path.join(ARTICLES_DIR, file);
    const raw = await fs.readFile(filePath, 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm || !fm.videoId) continue;
    out.push({
      slug: file.replace(/\.md$/, ''),
      filePath,
      videoId: fm.videoId,
      videoUrl: fm.videoUrl,
      creatorHandle: fm.creatorHandle,
      platform: fm.platform,
      pubDate: fm.pubDate,
      thumbnail: fm.thumbnail || null,
    });
  }
  return out;
}

async function processOne(entry, creatorsByHandle, seen, opts) {
  const creator = creatorsByHandle.get(entry.creatorHandle);
  if (!creator) {
    console.warn(`[regen] no creator for ${entry.creatorHandle}, skipping`);
    return { result: 'skipped' };
  }

  // 1. Refetch video metadata.
  let meta;
  try {
    meta = await ytDlpDumpJson(entry.videoUrl);
  } catch (err) {
    console.warn(`[regen] yt-dlp failed for ${entry.videoUrl}: ${err.message}`);
    return { result: 'fetch-failed' };
  }
  const video = videoFromYtDlp(meta, {
    videoId: entry.videoId,
    title: entry.slug,
    url: entry.videoUrl,
    thumbnail: entry.thumbnail,
    published: entry.pubDate,
  });

  // 2. Get transcript (YouTube only).
  let transcript = null;
  if (creator.platform === 'youtube') {
    transcript = await fetchYoutubeTranscript(video.videoId);
  }

  // 3. AI relevance filter.
  let relevance;
  try {
    relevance = await checkVideoRelevance({
      videoTitle: video.title,
      description: video.description,
      transcript,
    });
  } catch (err) {
    console.warn(`[regen] relevance failed for ${video.videoId}: ${err.message}`);
    relevance = { isAI: true, reason: 'call-failure' };
  }

  if (!relevance.isAI) {
    if (opts.keepNonAI) {
      console.log(`[regen] would-skip non-AI: ${entry.slug} (${relevance.reason})`);
      return { result: 'would-skip-non-ai' };
    }
    if (!opts.dryRun) {
      await fs.unlink(entry.filePath);
      markSeen(seen, video.videoId, {
        creator: creator.id,
        skipped: 'not-ai',
        reason: relevance.reason,
        publishedAt: video.published || entry.pubDate || null,
        title: video.title,
      });
    }
    console.log(`[regen] DELETED non-AI: ${entry.slug} (${relevance.reason})`);
    return { result: 'deleted-non-ai' };
  }

  if (opts.dryRun) {
    console.log(`[regen] would-regen: ${entry.slug}`);
    return { result: 'would-regen' };
  }

  // 4. Regenerate article with new prompt. Pre-cache transcript.
  video._cachedTranscript = transcript;
  let parsed, model;
  try {
    const r = await buildArticleForVideo(creator, video);
    parsed = r.parsed;
    model = r.model;
  } catch (err) {
    console.warn(`[regen] generation failed for ${video.videoId}: ${err.message}`);
    return { result: 'gen-failed' };
  }

  const pubDate = video.published
    ? new Date(video.published)
    : entry.pubDate
    ? new Date(entry.pubDate)
    : new Date();

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

  // Keep the existing slug to preserve the URL.
  await writeMarkdownFile(entry.filePath, fm, parsed.markdown);

  // Update seen.json with the (possibly new) title.
  markSeen(seen, video.videoId, {
    creator: creator.id,
    slug: entry.slug,
    title: parsed.title,
    publishedAt: pubDate.toISOString(),
  });

  console.log(`[regen] OK: ${entry.slug}`);
  return { result: 'regenerated' };
}

async function readRequestFile() {
  try {
    const raw = await fs.readFile(REQUEST_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function archiveRequestFile(request) {
  const archive = { ...request, processedAt: new Date().toISOString() };
  let history = [];
  try {
    const raw = await fs.readFile(ARCHIVE_PATH, 'utf8');
    history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [history];
  } catch {}
  history.push(archive);
  await fs.writeFile(ARCHIVE_PATH, JSON.stringify(history, null, 2) + '\n', 'utf8');
  await fs.unlink(REQUEST_PATH).catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv);
  const request = await readRequestFile();

  const opts = {
    dryRun: args.dryRun || false,
    keepNonAI: args.keepNonAI || false,
    limit: args.limit ?? request?.limit ?? null,
    only: args.only ?? request?.only ?? null,
  };

  console.log('[regen] options:', opts);

  const creators = await loadCreators();
  const creatorsByHandle = new Map(creators.map((c) => [c.handle, c]));
  const seen = await loadSeen();
  const entries = await readArticleEntries();

  let filtered = entries;
  if (opts.only) {
    const c = creators.find((x) => x.id === opts.only);
    if (!c) {
      console.error(`[regen] unknown --only creator id: ${opts.only}`);
      process.exit(1);
    }
    filtered = filtered.filter((e) => e.creatorHandle === c.handle);
  }
  if (opts.limit) filtered = filtered.slice(0, opts.limit);

  console.log(`[regen] processing ${filtered.length} / ${entries.length} articles`);

  const counts = {};
  for (const entry of filtered) {
    const { result } = await processOne(entry, creatorsByHandle, seen, opts);
    counts[result] = (counts[result] || 0) + 1;
    if (!opts.dryRun) {
      // Save state regularly so we don't lose progress on a crash.
      await saveSeen(seen);
    }
  }

  console.log('[regen] done:', counts);

  if (request) {
    await archiveRequestFile(request);
    console.log(`[regen] archived request → ${path.relative(ROOT, ARCHIVE_PATH)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
