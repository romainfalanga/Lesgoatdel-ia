import { getCollection } from 'astro:content';

export async function GET(context) {
  const articles = (await getCollection('articles')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );
  const site = context.site?.toString() ?? 'https://lesgoatsdelia.netlify.app';
  const items = articles
    .map(
      (a) => `
    <item>
      <title><![CDATA[${a.data.title}]]></title>
      <link>${site}/articles/${a.slug}/</link>
      <guid isPermaLink="true">${site}/articles/${a.slug}/</guid>
      <pubDate>${a.data.pubDate.toUTCString()}</pubDate>
      <description><![CDATA[${a.data.description}]]></description>
      <author>${a.data.creator}</author>
    </item>`
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Les GOATs de l'IA</title>
    <link>${site}</link>
    <description>Le récap quotidien des meilleurs créateurs IA, généré par Gemini.</description>
    <language>fr-FR</language>
    <atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
