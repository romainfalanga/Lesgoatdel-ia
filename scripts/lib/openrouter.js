const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const MODELS = {
  // Cheapest model — used for the AI relevance pre-filter.
  filter: 'google/gemini-2.5-flash-lite',
  // Default for individual articles.
  short: 'google/gemini-2.5-flash-lite',
  // Heavier reasoning for long videos.
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

/**
 * Build the messages used to ask Gemini whether a video is genuinely about AI.
 * Uses title + description + a transcript snippet (if any). Cheap and fast.
 */
export function buildRelevanceMessages({
  videoTitle,
  description,
  transcript,
}) {
  const transcriptSnippet = transcript ? transcript.slice(0, 3000) : '';

  return [
    {
      role: 'system',
      content:
        "Tu es un classifieur strict mais juste. Ta mission est de dire si une vidéo parle PRINCIPALEMENT d'intelligence artificielle. Tu réponds toujours avec un JSON valide.",
    },
    {
      role: 'user',
      content: `Détermine si cette vidéo a l'intelligence artificielle (IA) comme SUJET PRINCIPAL.

PERTINENT (isAI: true) :
- Modèles d'IA (ChatGPT, Claude, Gemini, Llama, Mistral, DeepSeek, etc.)
- Outils, agents, frameworks IA
- Prompt engineering, fine-tuning, RAG
- Actualités, débats, régulation IA
- Démonstrations concrètes d'usage de l'IA
- Vulgarisation IA / explications techniques IA

NON PERTINENT (isAI: false) :
- Sketchs, anecdotes personnelles où l'IA n'est qu'un détail
- Vidéos lifestyle / divertissement sans rapport avec l'IA
- Vidéos qui mentionnent l'IA en passant sans en faire le sujet
- Vidéos sur la tech en général (cloud, web, etc.) sans focus IA

TITRE : ${videoTitle}

DESCRIPTION :
"""
${(description || '').slice(0, 2000)}
"""
${transcriptSnippet ? `\nDÉBUT DU TRANSCRIPT :\n"""\n${transcriptSnippet}\n"""` : ''}

Réponds UNIQUEMENT avec un JSON valide au format :
{
  "isAI": true | false,
  "reason": "courte explication en français (≤ 200 car)"
}`,
    },
  ];
}

/**
 * Build the messages used to generate the actual article. The article is a
 * rewritten / reformulated version of the video's content. The creator is
 * intentionally NOT mentioned in the body — attribution is handled by the
 * page footer.
 */
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
    : '\n\nPas de transcription disponible. Appuie-toi sur le titre, la description et la miniature.';

  const userContent = [
    {
      type: 'text',
      text: `Tu rédiges un article de blog en français pour "Les GOATs de l'IA".

OBJECTIF
L'article doit être une VERSION ÉCRITE ET REFORMULÉE du contenu de la vidéo.
Toute la valeur informative de la vidéo (étapes, exemples, démos, chiffres,
comparaisons, conseils, mises en garde, citations clés) doit se retrouver dans
l'article, en français écrit clair.

CONTEXTE INTERNE (NE PAS INSÉRER DANS L'ARTICLE)
Source vidéo : ${platformLabel} — ${videoUrl}
Titre original : ${videoTitle}
Publiée le : ${publishedAt || 'récemment'}
Description fournie :
"""
${(description || '').slice(0, 4000)}
"""${transcriptBlock}

CONTRAINTES
1. NE PRÉSENTE PAS LE CRÉATEUR. Pas de "${creator.name} explique…",
   "${creator.name} nous montre…", "Dans cette vidéo, ${creator.name} partage…",
   "le créateur de contenu…", "le youtubeur…", "la tiktokeuse…", etc.
   L'attribution est gérée automatiquement par la page (footer + lien vers la
   vidéo originale). Le corps de l'article parle DIRECTEMENT du sujet.
2. Pas de méta-commentaire sur la vidéo : pas de "dans cette vidéo…",
   "comme on va le voir…", "voici le résumé de la vidéo…".
3. Plonge directement dans le sujet dès la première phrase. L'intro pose
   l'enjeu, pas le format.
4. Structure :
   - Intro de 2-3 phrases qui pose le sujet et son enjeu concret.
   - 3 à 6 sections en \`##\` avec des titres concrets, qui développent
     les points de la vidéo.
   - Une section finale \`## À retenir\` avec 3 à 5 puces concrètes.
5. Donne TOUS les éléments concrets : noms exacts des outils/modèles,
   chiffres, étapes de manip, citations courtes, comparaisons.
6. Pas d'invention : ne mentionne que ce qui est dans le transcript ou
   la description.
7. Ton journalistique francophone, accessible, sans tutoiement systématique
   ni ton promo.
8. Ne mentionne PAS que tu es une IA, ni que c'est une transcription.
9. Le titre de l'article ne doit PAS contenir le nom du créateur.

RÉPONSE
Réponds UNIQUEMENT avec un objet JSON valide :
{
  "title": "Titre de l'article (≤ 80 car, sans nom de créateur)",
  "description": "Phrase d'accroche (≤ 160 car)",
  "tags": ["3 à 5 tags en minuscules sans accents"],
  "markdown": "le corps de l'article en markdown (sans h1, commence par l'intro)"
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
        "Tu es un journaliste tech francophone spécialisé en intelligence artificielle. Tu rédiges des articles riches en contenu, qui transposent fidèlement la matière d'une vidéo en texte écrit. Tu ne présentes JAMAIS le créateur dans le corps de l'article. Tu réponds toujours avec un JSON valide quand on te le demande.",
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
