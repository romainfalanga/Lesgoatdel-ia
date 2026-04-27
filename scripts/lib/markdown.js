import { promises as fs } from 'node:fs';
import path from 'node:path';
import slugify from 'slugify';

export function makeArticleSlug({ pubDate, creatorId, title }) {
  const d = new Date(pubDate);
  const datePart = d.toISOString().slice(0, 10);
  const titlePart = slugify(title, { lower: true, strict: true }).slice(0, 60);
  return `${datePart}-${creatorId}-${titlePart || 'video'}`;
}

export function makeRecapSlug({ period, periodEnd }) {
  const d = new Date(periodEnd);
  if (period === 'daily') return `quotidien-${d.toISOString().slice(0, 10)}`;
  if (period === 'weekly') {
    // ISO week
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return `hebdo-${tmp.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
  }
  if (period === 'monthly') {
    return `mensuel-${d.toISOString().slice(0, 7)}`;
  }
  return `${period}-${d.toISOString().slice(0, 10)}`;
}

function escapeYaml(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (/[":#\n\r]/.test(str)) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `"${str}"`;
}

function frontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${escapeYaml(v)}`);
    } else if (value instanceof Date) {
      lines.push(`${key}: ${value.toISOString()}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (value !== undefined && value !== null) {
      lines.push(`${key}: ${escapeYaml(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export async function writeMarkdownFile(filePath, frontmatterData, body) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = `${frontmatter(frontmatterData)}\n\n${body.trim()}\n`;
  await fs.writeFile(filePath, content, 'utf8');
}
