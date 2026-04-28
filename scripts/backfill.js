#!/usr/bin/env node
/**
 * backfill.js — generate articles for every video published within a date range,
 * regardless of the 30-day filter applied by poll-feeds.js.
 *
 * Usage:
 *   node scripts/backfill.js --month 2026-04
 *   node scripts/backfill.js --from 2026-04-01 --to 2026-04-30
 *   node scripts/backfill.js                # reads data/backfill-request.json
 *
 * If a `data/backfill-request.json` file exists with a `month` field
 * (e.g. {"month": "2026-04"}), it's used as the default range, then the file
 * is renamed to `data/backfill-archive.json` so subsequent workflow runs
 * don't re-trigger the backfill.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { loadSeen, saveSeen } from './lib/state.js';
import { loadCreators, fetchFeed, processVideo, ROOT } from './lib/generate.js';

const REQUEST_PATH = path.join(ROOT, 'data/backfill-request.json');
const ARCHIVE_PATH = path.join(ROOT, 'data/backfill-archive.json');

function parseArgs(argv) {
  const args = { force: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--month') args.month = argv[++i];
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
  }
  return args;
}

function rangeFromMonth(monthStr) {
  // monthStr: 'YYYY-MM'
  const m = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Invalid --month: ${monthStr} (expected YYYY-MM)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
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
  const archive = {
    ...request,
    processedAt: new Date().toISOString(),
  };
  let history = [];
  try {
    const raw = await fs.readFile(ARCHIVE_PATH, 'utf8');
    history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [history];
  } catch {
    history = [];
  }
  history.push(archive);
  await fs.writeFile(ARCHIVE_PATH, JSON.stringify(history, null, 2) + '\n', 'utf8');
  await fs.unlink(REQUEST_PATH).catch(() => {});
  console.log(`[backfill] archived request → ${path.relative(ROOT, ARCHIVE_PATH)}`);
}

async function main() {
  const args = parseArgs(process.argv);

  let start, end, fromRequest = null;

  if (args.month) {
    ({ start, end } = rangeFromMonth(args.month));
  } else if (args.from && args.to) {
    start = new Date(args.from + 'T00:00:00.000Z');
    end = new Date(args.to + 'T23:59:59.999Z');
  } else {
    const req = await readRequestFile();
    if (req && req.month) {
      ({ start, end } = rangeFromMonth(req.month));
      fromRequest = req;
    } else if (req && req.from && req.to) {
      start = new Date(req.from);
      end = new Date(req.to);
      fromRequest = req;
    } else {
      console.error(
        'No range provided. Use --month YYYY-MM, --from/--to, or write data/backfill-request.json.'
      );
      process.exit(1);
    }
    // Honor flags coming from the request file too.
    if (fromRequest?.force) args.force = true;
    if (fromRequest?.limit) args.limit = fromRequest.limit;
  }

  console.log(
    `[backfill] range: ${start.toISOString()} → ${end.toISOString()}`
  );

  const creators = await loadCreators();
  const seen = await loadSeen();
  let written = 0;

  for (const creator of creators) {
    // For backfill, request a larger window — we may need older items.
    const videos = await fetchFeed(creator, { limit: 50 });
    if (!videos.length) {
      console.log(`[feed] ${creator.handle}: no videos`);
      continue;
    }
    // Filter to range. Drop videos with no publish date (we can't place them).
    const inRange = videos.filter((v) => {
      if (!v.published) return false;
      const t = new Date(v.published).getTime();
      return t >= start.getTime() && t <= end.getTime();
    });

    if (!inRange.length) {
      console.log(`[feed] ${creator.handle}: 0 vidéos dans la période`);
      continue;
    }
    console.log(`[feed] ${creator.handle}: ${inRange.length} vidéos dans la période`);

    // Process oldest-first.
    inRange.sort((a, b) => new Date(a.published) - new Date(b.published));

    let processedForCreator = 0;
    for (const video of inRange) {
      if (args.limit && processedForCreator >= args.limit) break;
      const created = await processVideo(creator, video, seen, {
        dryRun: args.dryRun,
        force: args.force,
      });
      if (created) {
        written++;
        processedForCreator++;
      }
    }
  }

  await saveSeen(seen);
  console.log(`[backfill] done — ${written} articles écrits`);

  if (fromRequest) {
    await archiveRequestFile(fromRequest);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
