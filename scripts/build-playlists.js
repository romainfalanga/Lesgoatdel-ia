#!/usr/bin/env node
/**
 * build-playlists.js — group articles by topic, keep topics with ≥ N articles,
 * ask Gemini for a title/description/intro, output src/data/playlists.json.
 *
 * Usage:
 *   node scripts/build-playlists.js           # rebuild everything
 *   node scripts/build-playlists.js --min 3   # min articles per playlist
 *   node scripts/build-playlists.js --dry-run # no writes
 *   node scripts/build-playlists.js --reuse   # keep existing playlist titles/intros
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  callOpenRouter,
  buildPlaylistIntroMessages,
  parseJsonContent,
  MODELS,
  TOPIC_VOCABULARY,
} from './lib/openrouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const OUT_PATH = path.join(ROOT, 'src/data/playlists.json');
const VOCAB_EXT_PATH = path.join(ROOT, 'src/data/topics-extra.json');

function parseArgs(argv) {
  const args = { min: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--reuse') args.reuse = true;
    else if (a === '--min') args.min = parseInt(argv[++i], 10);
  }
  return args;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  return { fmRaw: m[1], body: raw.slice(m[0].length) };
}

function readTopicsList(fmRaw) {
  const inlineMatch = fmRaw.match(/^topics:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  const blockMatch = fmRaw.match(/^topics:\s*\n((?:\s+-\s+.*\n)+)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  }
  return [];
}

function readField(fmRaw, key) {
  const m = fmRaw.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '');
}

async function loadExtraVocab() {
  try {
    const raw = await fs.readFile(VOCAB_EXT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { extras: [] };
  }
}

async function loadExistingPlaylists() {
  try {
    const raw = await fs.readFile(OUT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { playlists: [] };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const files = (await fs.readdir(ARTICLES_DIR)).filter((f) => f.endsWith('.md'));
  const extras = (await loadExtraVocab()).extras;
  const vocabById = new Map(
    [...TOPIC_VOCABULARY, ...extras].map((t) => [t.id, t])
  );
  const existing = await loadExistingPlaylists();
  const existingById = new Map(existing.playlists.map((p) => [p.id, p]));

  // Collect articles.
  const articles = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(ARTICLES_DIR, file), 'utf8');
    const parts = splitFrontmatter(raw);
    if (!parts) continue;
    const topics = readTopicsList(parts.fmRaw);
    if (!topics.length) continue;
    articles.push({
      slug: file.replace(/\.md$/, ''),
      title: readField(parts.fmRaw, 'title'),
      description: readField(parts.fmRaw, 'description'),
      thumbnail: readField(parts.fmRaw, 'thumbnail'),
      pubDate: readField(parts.fmRaw, 'pubDate'),
      creator: readField(parts.fmRaw, 'creator'),
      platform: readField(parts.fmRaw, 'platform'),
      topics,
    });
  }

  console.log(`[playlists] ${articles.length} articles taggés analysés`);

  // Group by topic.
  const byTopic = new Map();
  for (const a of articles) {
    for (const t of a.topics) {
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t).push(a);
    }
  }

  const kept = [];
  for (const [topicId, list] of byTopic.entries()) {
    if (list.length < args.min) continue;
    const meta = vocabById.get(topicId);
    if (!meta) {
      console.warn(`[playlists] topic "${topicId}" absent du vocabulaire, ignoré`);
      continue;
    }
    // Sort chronologically ascending (oldest first). The UI can reverse.
    list.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));
    kept.push({ id: topicId, label: meta.label, articles: list });
  }

  // Sort playlists by article count desc, then label.
  kept.sort((a, b) => b.articles.length - a.articles.length || a.label.localeCompare(b.label));

  console.log(`[playlists] ${kept.length} playlists retenues (min ${args.min} articles)`);

  const out = { generatedAt: null, playlists: [] };

  for (const p of kept) {
    const articleSlugs = p.articles.map((a) => a.slug);
    const firstPub = p.articles[0]?.pubDate || null;
    const lastPub = p.articles[p.articles.length - 1]?.pubDate || null;

    let title = null;
    let description = null;
    let intro = null;

    if (args.reuse && existingById.has(p.id)) {
      const prev = existingById.get(p.id);
      title = prev.title;
      description = prev.description;
      intro = prev.intro;
    }

    if (!args.dryRun && (!args.reuse || !title)) {
      try {
        const { content } = await callOpenRouter({
          model: MODELS.filter,
          messages: buildPlaylistIntroMessages({
            topicLabel: p.label,
            articleTitles: p.articles.map((a) => a.title),
          }),
          temperature: 0.5,
          maxTokens: 500,
          responseFormat: { type: 'json_object' },
        });
        const parsed = parseJsonContent(content);
        title = parsed.title || p.label;
        description = parsed.description || '';
        intro = parsed.intro || '';
      } catch (err) {
        console.warn(`[playlists] intro gen failed for ${p.id}: ${err.message}`);
        title = title || p.label;
        description = description || '';
        intro = intro || '';
      }
    } else if (args.dryRun) {
      title = p.label;
      description = '';
      intro = '';
    }

    out.playlists.push({
      id: p.id,
      label: p.label,
      title: title || p.label,
      description: description || '',
      intro: intro || '',
      articleCount: p.articles.length,
      firstPub,
      lastPub,
      articleSlugs,
    });

    console.log(`[playlists] ${p.id} · ${p.articles.length} articles · "${title}"`);
  }

  if (!args.dryRun) {
    await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`[playlists] wrote ${path.relative(ROOT, OUT_PATH)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
