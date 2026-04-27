import { promises as fs } from 'node:fs';
import path from 'node:path';

const STATE_PATH = path.resolve('data/seen.json');

export async function loadSeen() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { videos: {} };
    }
    throw err;
  }
}

export async function saveSeen(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function markSeen(state, videoId, meta = {}) {
  state.videos[videoId] = {
    seenAt: new Date().toISOString(),
    ...meta,
  };
}

export function isSeen(state, videoId) {
  return Boolean(state.videos[videoId]);
}
