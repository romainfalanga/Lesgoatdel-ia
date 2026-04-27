import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const UA =
  'Mozilla/5.0 (Linux; X11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Cache secUid per process (cheap and stable per user).
const secUidCache = new Map();

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

async function resolveSecUid(handle, retries = 3) {
  if (secUidCache.has(handle)) return secUidCache.get(handle);
  const url = `https://www.tiktok.com/@${handle}`;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      const html = await res.text();
      const universal = extractEmbeddedJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
      const secUid =
        universal?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user?.secUid;
      if (secUid) {
        secUidCache.set(handle, secUid);
        return secUid;
      }
      lastErr = new Error('secUid not found in page payload');
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw lastErr || new Error('Could not resolve TikTok secUid');
}

async function ytDlpUserList(secUid, { limit = 10 } = {}) {
  const { stdout } = await execFileP(
    'yt-dlp',
    [
      '--dump-single-json',
      '--flat-playlist',
      '--playlist-end',
      String(limit),
      '--no-warnings',
      `tiktokuser:${secUid}`,
    ],
    { maxBuffer: 1024 * 1024 * 32 }
  );
  return JSON.parse(stdout);
}

export async function fetchTikTokFeed(creator, { limit = 10 } = {}) {
  let secUid;
  try {
    secUid = await resolveSecUid(creator.channelHandle);
  } catch (err) {
    console.warn(`[tiktok] secUid resolve failed for ${creator.handle}: ${err.message}`);
    return [];
  }

  let data;
  try {
    data = await ytDlpUserList(secUid, { limit });
  } catch (err) {
    console.warn(`[tiktok] yt-dlp failed for ${creator.handle}: ${err.message}`);
    return [];
  }

  const entries = (data.entries || []).filter(Boolean);
  return entries.map((e) => {
    const ts = e.timestamp || e.upload_date || null;
    const published = e.timestamp
      ? new Date(e.timestamp * 1000).toISOString()
      : null;
    const desc = String(e.description || e.title || '');
    return {
      videoId: String(e.id),
      title: (e.title || desc.split('\n')[0] || `Vidéo TikTok de ${creator.name}`).slice(0, 140),
      url: `https://www.tiktok.com/@${creator.channelHandle}/video/${e.id}`,
      published,
      author: creator.name,
      thumbnail: e.thumbnail || (e.thumbnails?.[0]?.url ?? null),
      description: desc.slice(0, 4000),
      duration: e.duration || null,
      platform: 'tiktok',
    };
  });
}

// Optional helper if we ever want to download videos for further processing.
export async function downloadTikTokVideo(url, outPath) {
  await execFileP(
    'yt-dlp',
    ['-f', 'mp4', '-o', outPath, '--no-warnings', url],
    { maxBuffer: 1024 * 1024 * 64 }
  );
  return outPath;
}
