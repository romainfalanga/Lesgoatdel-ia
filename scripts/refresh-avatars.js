#!/usr/bin/env node
/**
 * refresh-avatars.js — fills/refreshes the `avatar` field for each creator
 * in src/data/creators.json. Runs at the start of poll-feeds to ensure
 * fresh avatars on first deploy and self-heal if a CDN URL expires.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CREATORS_PATH = path.join(ROOT, 'src/data/creators.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function extractEmbeddedJson(html, id) {
  const re = new RegExp(
    `<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    'i'
  );
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

async function fetchYoutubeAvatar(handle) {
  const url = `https://www.youtube.com/@${handle}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  const html = await res.text();
  const og = html.match(/<meta property="og:image" content="([^"]+)">/);
  return og ? og[1] : null;
}

async function fetchTiktokAvatar(handle) {
  const url = `https://www.tiktok.com/@${handle}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`TikTok HTTP ${res.status}`);
  const html = await res.text();
  const json = extractEmbeddedJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const user =
    json?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
  return user?.avatarLarger || user?.avatarMedium || null;
}

async function main() {
  const raw = await fs.readFile(CREATORS_PATH, 'utf8');
  const data = JSON.parse(raw);
  let dirty = false;

  for (const creator of data.creators) {
    try {
      let avatar = null;
      if (creator.platform === 'youtube') {
        avatar = await fetchYoutubeAvatar(creator.channelHandle);
      } else if (creator.platform === 'tiktok') {
        avatar = await fetchTiktokAvatar(creator.channelHandle);
      }
      if (avatar && avatar !== creator.avatar) {
        console.log(`[avatar] ${creator.handle} → updated`);
        creator.avatar = avatar;
        dirty = true;
      } else {
        console.log(`[avatar] ${creator.handle} → unchanged`);
      }
    } catch (err) {
      console.warn(`[avatar] ${creator.handle} failed: ${err.message}`);
    }
    // Politeness delay between requests to avoid rate-limits.
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (dirty) {
    await fs.writeFile(
      CREATORS_PATH,
      JSON.stringify(data, null, 2) + '\n',
      'utf8'
    );
    console.log('[avatar] creators.json updated');
  } else {
    console.log('[avatar] no changes');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
