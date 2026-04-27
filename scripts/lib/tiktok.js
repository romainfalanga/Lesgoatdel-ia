import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { XMLParser } from 'fast-xml-parser';

const execFileP = promisify(execFile);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

const UA =
  'Mozilla/5.0 (Linux; X11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// TikTok no longer exposes the video list in its static HTML (it's lazy-loaded via XHR).
// We therefore use RSSHub, an open-source RSS gateway with TikTok support.
// You can self-host RSSHub and set RSSHUB_BASE in env, otherwise the public instance is used.
const RSSHUB_BASE = process.env.RSSHUB_BASE || 'https://rsshub.app';

function extractVideoIdFromLink(link) {
  if (!link) return null;
  const m = link.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

async function fetchRsshub(creator, { limit = 10 } = {}) {
  const url = `${RSSHUB_BASE}/tiktok/user/@${creator.channelHandle}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch (err) {
    console.warn(`[tiktok] rsshub fetch failed for ${creator.handle}: ${err.message}`);
    return [];
  }
  if (!res.ok) {
    console.warn(`[tiktok] rsshub HTTP ${res.status} for ${creator.handle}`);
    return [];
  }
  const xml = await res.text();
  let data;
  try {
    data = xmlParser.parse(xml);
  } catch (err) {
    console.warn(`[tiktok] rsshub parse failed for ${creator.handle}: ${err.message}`);
    return [];
  }
  const items = []
    .concat(data?.rss?.channel?.item ?? [])
    .slice(0, limit);

  return items
    .map((item) => {
      const videoId = extractVideoIdFromLink(item.link) || item.guid?.['#text'] || item.guid;
      if (!videoId) return null;
      const desc = String(item.description || item.title || '');
      // RSSHub puts <video> + thumbnail in description HTML — try to extract.
      const thumbMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
      const cleanedTitle = String(item.title || '').replace(/<[^>]+>/g, '').slice(0, 140);
      return {
        videoId: String(videoId),
        title: cleanedTitle || `Vidéo TikTok de ${creator.name}`,
        url: item.link || `https://www.tiktok.com/@${creator.channelHandle}/video/${videoId}`,
        published: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        author: creator.name,
        thumbnail: thumbMatch ? thumbMatch[1] : null,
        description: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000),
        duration: null,
        platform: 'tiktok',
      };
    })
    .filter(Boolean);
}

export async function fetchTikTokFeed(creator, opts = {}) {
  return await fetchRsshub(creator, opts);
}

// Optional helper: download a TikTok video (for future Whisper transcription).
export async function downloadTikTokVideo(url, outPath) {
  await execFileP(
    'yt-dlp',
    ['-f', 'mp4', '-o', outPath, '--no-warnings', url],
    { maxBuffer: 1024 * 1024 * 64 }
  );
  return outPath;
}
