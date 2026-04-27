#!/usr/bin/env node
/**
 * recap.js daily|weekly|monthly
 * Aggregates the articles published in the period and asks Gemini to produce a recap.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  callOpenRouter,
  buildRecapMessages,
  parseJsonContent,
  MODELS,
} from './lib/openrouter.js';
import { makeRecapSlug, writeMarkdownFile } from './lib/markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const RECAPS_DIR = path.join(ROOT, 'src/content/recaps');

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const fmRaw = match[1];
  const body = match[2];
  const data = {};
  let currentKey = null;
  for (const line of fmRaw.split('\n')) {
    if (/^\s+- /.test(line) && currentKey) {
      const value = line.replace(/^\s+- /, '').replace(/^"|"$/g, '');
      data[currentKey] = data[currentKey] || [];
      data[currentKey].push(value);
      continue;
    }
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      let value = m[2];
      if (value === '') {
        data[currentKey] = [];
      } else {
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1).replace(/\\"/g, '"');
        }
        data[currentKey] = value;
      }
    }
  }
  return { data, body };
}

async function loadArticles() {
  let entries;
  try {
    entries = await fs.readdir(ARTICLES_DIR);
  } catch {
    return [];
  }
  const items = [];
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(ARTICLES_DIR, file);
    const raw = await fs.readFile(filePath, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    if (!data.pubDate) continue;
    items.push({
      slug: file.replace(/\.md$/, ''),
      title: data.title,
      description: data.description,
      pubDate: new Date(data.pubDate),
      creator: data.creator,
      creatorHandle: data.creatorHandle,
      platform: data.platform,
      videoUrl: data.videoUrl,
      excerpt: body.slice(0, 1200),
    });
  }
  return items;
}

function periodRange(period, ref = new Date()) {
  const end = new Date(ref);
  const start = new Date(ref);
  if (period === 'daily') {
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
  } else if (period === 'weekly') {
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
    start.setUTCHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
  } else if (period === 'monthly') {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    end.setUTCHours(23, 59, 59, 999);
  } else {
    throw new Error(`Unknown period: ${period}`);
  }
  return { start, end };
}

function rangeLabel(period, start, end) {
  const fmt = (d) =>
    d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  if (period === 'daily') return `la journée du ${fmt(start)}`;
  if (period === 'weekly') return `la semaine du ${fmt(start)} au ${fmt(end)}`;
  if (period === 'monthly') {
    return `le mois de ${start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
  }
  return '';
}

const PERIOD_HUMAN = {
  daily: 'quotidien',
  weekly: 'hebdomadaire',
  monthly: 'mensuel',
};

async function main() {
  const period = process.argv[2];
  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    console.error('Usage: recap.js daily|weekly|monthly');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const ref = process.env.RECAP_REFERENCE_DATE
    ? new Date(process.env.RECAP_REFERENCE_DATE)
    : new Date();
  const { start, end } = periodRange(period, ref);
  const articles = (await loadArticles())
    .filter((a) => a.pubDate >= start && a.pubDate <= end)
    .sort((a, b) => a.pubDate - b.pubDate);

  if (articles.length === 0) {
    console.log(`[recap] no articles in ${period} window — skipping`);
    return;
  }

  const creators = [...new Set(articles.map((a) => a.creator))].sort();

  console.log(
    `[recap] ${period}: ${articles.length} articles, ${creators.length} creators`
  );

  const messages = buildRecapMessages({
    period,
    periodLabelHuman: PERIOD_HUMAN[period],
    rangeLabel: rangeLabel(period, start, end),
    articles,
  });

  if (dryRun) {
    console.log(JSON.stringify(messages, null, 2).slice(0, 2000));
    return;
  }

  const { content } = await callOpenRouter({
    model: MODELS.recap,
    messages,
    temperature: 0.6,
    maxTokens: 6000,
    responseFormat: { type: 'json_object' },
  });

  const parsed = parseJsonContent(content);
  if (!parsed.title || !parsed.markdown) {
    throw new Error('Recap response missing title/markdown');
  }

  const slug = makeRecapSlug({ period, periodEnd: end });
  const filePath = path.join(RECAPS_DIR, `${slug}.md`);
  const fm = {
    title: parsed.title,
    description: parsed.description || `${PERIOD_HUMAN[period]} récap`,
    pubDate: new Date(),
    period,
    periodStart: start,
    periodEnd: end,
    creatorCount: creators.length,
    videoCount: articles.length,
    creators,
    model: MODELS.recap,
  };
  await writeMarkdownFile(filePath, fm, parsed.markdown);
  console.log(`[ok] wrote ${path.relative(ROOT, filePath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
