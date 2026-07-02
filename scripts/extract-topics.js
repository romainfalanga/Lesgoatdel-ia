#!/usr/bin/env node
/**
 * extract-topics.js — extract normalized topics for every article in
 * src/content/articles/ and write them into the frontmatter (`topics: […]`).
 *
 * Usage:
 *   node scripts/extract-topics.js            # all articles missing topics
 *   node scripts/extract-topics.js --all      # every article (overwrite)
 *   node scripts/extract-topics.js --limit N  # cap on how many to process
 *   node scripts/extract-topics.js --dry-run  # log only, don't write
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  callOpenRouter,
  buildTopicsMessages,
  parseJsonContent,
  MODELS,
  TOPIC_VOCABULARY,
} from './lib/openrouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const VOCAB_EXT_PATH = path.join(ROOT, 'src/data/topics-extra.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
  }
  return args;
}

/**
 * Very small frontmatter reader/writer that preserves the body verbatim.
 */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fmRaw: '', body: raw, fmEnd: 0 };
  return { fmRaw: m[1], body: raw.slice(m[0].length), fmEnd: m[0].length };
}

function readTopicsList(fmRaw) {
  // Matches: topics:\n  - "a"\n  - "b"  OR  topics: []
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
  return null;
}

function readTagsList(fmRaw) {
  return readTopicsList(fmRaw.replace(/^topics:/gm, 'topics:').replace(/^tags:/gm, 'topics:'));
}

function readSingleField(fmRaw, key) {
  const m = fmRaw.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '');
}

function writeTopicsInFrontmatter(fmRaw, topics) {
  const yamlBlock =
    topics.length === 0
      ? 'topics: []'
      : `topics:\n${topics.map((t) => `  - "${t}"`).join('\n')}`;
  // Remove existing topics field (inline or block).
  let cleaned = fmRaw.replace(/^topics:\s*\[[^\]]*\]\n/m, '');
  cleaned = cleaned.replace(/^topics:\s*\n(?:\s+-\s+.*\n)+/m, '');
  // Insert before `model:` if present, otherwise at the end.
  const modelIdx = cleaned.search(/^model:/m);
  if (modelIdx >= 0) {
    return cleaned.slice(0, modelIdx) + yamlBlock + '\n' + cleaned.slice(modelIdx);
  }
  return cleaned.replace(/\n?$/, '\n') + yamlBlock + '\n';
}

async function loadExtraVocab() {
  try {
    const raw = await fs.readFile(VOCAB_EXT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { extras: [] };
  }
}

async function saveExtraVocab(data) {
  await fs.writeFile(VOCAB_EXT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function normalizeTopicId(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const args = parseArgs(process.argv);
  const files = (await fs.readdir(ARTICLES_DIR)).filter((f) => f.endsWith('.md'));
  const extraVocab = await loadExtraVocab();
  const knownIds = new Set([
    ...TOPIC_VOCABULARY.map((t) => t.id),
    ...extraVocab.extras.map((t) => t.id),
  ]);

  const toProcess = [];
  for (const file of files) {
    const filePath = path.join(ARTICLES_DIR, file);
    const raw = await fs.readFile(filePath, 'utf8');
    const { fmRaw, body } = splitFrontmatter(raw);
    const existingTopics = readTopicsList(fmRaw);
    const tags = readTagsList(fmRaw);
    if (!args.all && existingTopics && existingTopics.length > 0) continue;
    toProcess.push({
      file,
      filePath,
      raw,
      fmRaw,
      body,
      title: readSingleField(fmRaw, 'title'),
      description: readSingleField(fmRaw, 'description'),
      existingTags: tags || [],
    });
  }

  const limit = args.limit ?? toProcess.length;
  const batch = toProcess.slice(0, limit);
  console.log(`[topics] processing ${batch.length} / ${toProcess.length} (total files: ${files.length})`);

  let processed = 0, newTopicsAdded = 0;

  for (const item of batch) {
    const messages = buildTopicsMessages({
      articleTitle: item.title || item.file,
      articleDescription: item.description || '',
      articleBody: item.body,
      existingTags: item.existingTags,
    });

    let parsed;
    try {
      const { content } = await callOpenRouter({
        model: MODELS.filter,
        messages,
        temperature: 0,
        maxTokens: 300,
        responseFormat: { type: 'json_object' },
      });
      parsed = parseJsonContent(content);
    } catch (err) {
      console.warn(`[topics] ${item.file}: ${err.message}`);
      continue;
    }

    let topics = Array.isArray(parsed.topics) ? parsed.topics.map(normalizeTopicId).filter(Boolean) : [];
    // Keep only known ids, plus optionally the newTopic if provided.
    topics = topics.filter((id) => knownIds.has(id));

    const nt = parsed.newTopic;
    if (nt && nt.id && nt.label) {
      const id = normalizeTopicId(nt.id);
      if (id && !knownIds.has(id)) {
        extraVocab.extras.push({ id, label: String(nt.label).slice(0, 40) });
        knownIds.add(id);
        newTopicsAdded++;
      }
      if (id && !topics.includes(id)) topics.push(id);
    }

    // Dedupe and cap.
    topics = [...new Set(topics)].slice(0, 6);

    if (!topics.length) {
      console.log(`[topics] skip (no valid topic) ${item.file}`);
      continue;
    }

    if (args.dryRun) {
      console.log(`[topics] would-write ${item.file} → ${topics.join(', ')}`);
      continue;
    }

    const newFmRaw = writeTopicsInFrontmatter(item.fmRaw, topics);
    const newRaw = `---\n${newFmRaw}${newFmRaw.endsWith('\n') ? '' : '\n'}---\n${item.body}`;
    await fs.writeFile(item.filePath, newRaw, 'utf8');
    processed++;
    console.log(`[topics] ${item.file} → ${topics.join(', ')}`);
  }

  if (!args.dryRun && newTopicsAdded > 0) {
    await saveExtraVocab(extraVocab);
    console.log(`[topics] +${newTopicsAdded} nouveaux topics ajoutés au vocab (topics-extra.json)`);
  }

  console.log(`[topics] done — ${processed} articles taggés`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
