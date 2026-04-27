import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

async function resolveChannelId(handle) {
  // handle without leading @
  const cleanHandle = handle.replace(/^@/, '');
  const url = `https://www.youtube.com/@${cleanHandle}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; X11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`YouTube channel resolve failed for ${handle}: ${res.status}`);
  }
  const html = await res.text();
  const match =
    html.match(/"channelId":"(UC[\w-]+)"/) ||
    html.match(/<meta itemprop="identifier" content="(UC[\w-]+)">/) ||
    html.match(/"externalId":"(UC[\w-]+)"/);
  if (!match) {
    throw new Error(`Could not extract channelId for handle ${handle}`);
  }
  return match[1];
}

export async function fetchYoutubeFeed(creator) {
  const channelId =
    creator.channelId || (await resolveChannelId(creator.channelHandle));
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(feedUrl);
  if (!res.ok) {
    throw new Error(`YouTube feed failed (${creator.handle}): ${res.status}`);
  }
  const xml = await res.text();
  const data = parser.parse(xml);
  const entries = [].concat(data?.feed?.entry ?? []);
  return entries.map((entry) => {
    const videoId = entry['yt:videoId'];
    const thumb = entry['media:group']?.['media:thumbnail']?.url
      || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const description = entry['media:group']?.['media:description'] || '';
    return {
      videoId,
      title: entry.title,
      url: entry.link?.href || `https://www.youtube.com/watch?v=${videoId}`,
      published: entry.published,
      author: entry.author?.name,
      thumbnail: thumb,
      description,
      platform: 'youtube',
      channelId,
    };
  });
}

export async function fetchYoutubeTranscript(videoId) {
  const tryLangs = ['fr', 'fr-FR', 'en', 'en-US'];
  for (const lang of tryLangs) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      if (items?.length) {
        return items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
      }
    } catch {
      // try next language
    }
  }
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    return items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

export function estimateDurationLabel(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h${String(m % 60).padStart(2, '0')}`;
  }
  return `${m} min${s ? ` ${s}s` : ''}`;
}
