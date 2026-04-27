#!/usr/bin/env node
/**
 * poll-feeds.js — checks every creator's feed, detects new videos,
 * generates articles via Gemini (OpenRouter), commits markdown files.
 */
import { loadSeen, saveSeen, markSeen, isSeen } from './lib/state.js';
import { loadCreators, fetchFeed, processVideo } from './lib/generate.js';

const MAX_AGE_DAYS = 30;

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
        if (ageDays > MAX_AGE_DAYS) {
          markSeen(seen, video.videoId, {
            creator: creator.id,
            skipped: 'too-old',
            publishedAt: video.published,
          });
          continue;
        }
      }
      const created = await processVideo(creator, video, seen, { dryRun });
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
