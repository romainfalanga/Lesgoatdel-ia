const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const MODELS = {
  // Short videos & individual articles — cheapest fast multimodal Gemini.
  short: 'google/gemini-2.5-flash-lite',
  // Longer videos / heavier reasoning — Gemini 2.5 Pro.
  long: 'google/gemini-2.5-pro',
};

export function pickModelForVideo({ durationSeconds, transcriptLength }) {
  const longByDuration = durationSeconds && durationSeconds > 20 * 60;
  const longByTranscript = transcriptLength && transcriptLength > 12000;
  return longByDuration || longByTranscript ? MODELS.long : MODELS.short;
}

export async function callOpenRouter({
  model,
  messages,
  apiKey = process.env.OPENROUTER_API_KEY,
  temperature = 0.6,
  maxTokens = 4096,
  responseFormat = null,
}) {
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://lesgoatsdelia.netlify.app',
      'X-Title': "Les GOATs de l'IA",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty completion from OpenRouter');
  }
  return { content, raw: json };
}

export function buildVideoMessages({
  creator,
  videoTitle,
  videoUrl,
  platform,
  description,
  transcript,
  thumbnailUrl,
  publishedAt,
}) {
  const platformLabel = platform === 'youtube' ? 'YouTube' : 'TikTok';
  const transcriptBlock = transcript
    ? `\n\nTRANSCRIPTION DE LA VIDÉO :\n"""\n${transcript.slice(0, 30000)}\n"""`
    : '\n\nLa transcription n\'est pas disponible pour cette vidéo. Appuie-toi sur le titre, la description, la miniature et le contexte du créateur.';

  const userContent = [
    {
      type: 'text',
      text: `Tu écris un article de blog en français pour le site "Les GOATs de l'IA", qui synthétise les vidéos des meilleurs créateurs de contenu IA.

CRÉATEUR : ${creator.name} (${creator.handle}) sur ${platformLabel}
TITRE DE LA VIDÉO : ${videoTitle}
URL : ${videoUrl}
PUBLIÉE LE : ${publishedAt || 'récemment'}
DESCRIPTION FOURNIE PAR LE CRÉATEUR :
"""
${(description || '').slice(0, 4000)}
"""${transcriptBlock}

INSTRUCTIONS :
1. Écris un article de blog clair, structuré et fidèle au contenu original.
2. Pas d'invention : si une info n'est pas dans le transcript ou la description, ne l'affirme pas.
3. Ton journalistique mais accessible, en français.
4. Structure : intro (2-3 phrases), 3 à 6 sections (## titre), conclusion / "À retenir".
5. Mets en avant ce qui est concret (modèles, outils, chiffres, démos).
6. Cite le créateur avec naturel ("${creator.name} montre que…").
7. Ne mentionne PAS que tu es une IA ou que c'est une transcription.
8. Réponds UNIQUEMENT avec un objet JSON valide au format :
{
  "title": "Titre de l'article (≤ 80 car)",
  "description": "Résumé d'une phrase (≤ 160 car)",
  "tags": ["3 à 5 tags en minuscules sans accents"],
  "markdown": "le corps de l'article au format markdown"
}`,
    },
  ];

  if (thumbnailUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: thumbnailUrl },
    });
  }

  return [
    {
      role: 'system',
      content:
        'Tu es un journaliste tech francophone spécialisé en intelligence artificielle. Tu rédiges des articles synthétiques, fidèles aux sources et bien structurés. Tu réponds toujours avec un JSON valide quand on te le demande.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

export function parseJsonContent(content) {
  // Models sometimes wrap JSON in code fences. Strip them.
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  // Find first { and last } if there's stray text.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1) {
    cleaned = cleaned.slice(first, last + 1);
  }
  return JSON.parse(cleaned);
}
