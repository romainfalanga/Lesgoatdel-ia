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
 * Controlled topic vocabulary. Used to keep tagging consistent across articles
 * so that playlists group meaningfully. The model can add ONE additional topic
 * if strongly justified, but must reuse existing ids first.
 */
export const TOPIC_VOCABULARY = [
  { id: 'chatgpt',            label: 'ChatGPT',            desc: 'Modèle et outils OpenAI/ChatGPT (GPT-4o, GPT-5, Sora, etc.)' },
  { id: 'claude',             label: 'Claude',             desc: "Anthropic Claude, Claude Code, Claude Cowork, Claude Design, Sonnet/Opus/Haiku" },
  { id: 'gemini',             label: 'Gemini',             desc: 'Modèles Gemini de Google, Gemma, Nano Banana' },
  { id: 'open-source-models', label: 'Modèles open-source', desc: 'DeepSeek, Llama, Mistral, Qwen, Kimi, Gemma, autres modèles open' },
  { id: 'agents-ia',          label: 'Agents IA',          desc: 'Agents autonomes, orchestration, systèmes multi-agents' },
  { id: 'prompt-engineering', label: 'Prompt engineering', desc: 'Techniques de prompt, meta-prompts, prompts secrets' },
  { id: 'automatisation',     label: 'Automatisation',     desc: 'n8n, Make, workflows, RPA, intégrations' },
  { id: 'no-code',            label: 'No-code',            desc: 'Créer des applis / sites / agents sans coder' },
  { id: 'developpement',      label: 'Développement',      desc: 'Coding assistants, Cursor, Codex, dev IA' },
  { id: 'productivite',       label: 'Productivité',       desc: 'Outils IA pour la productivité personnelle et pro' },
  { id: 'business-ia',        label: 'IA pour le business', desc: 'Entreprise, entrepreneuriat, ROI, cas d\'usage business' },
  { id: 'formation',          label: 'Formation & tutoriels', desc: 'Guides pas à pas, tutoriels, méthodes structurées' },
  { id: 'image-generation',   label: 'Génération d\'images', desc: 'Midjourney, DALL-E, Flux, Stable Diffusion, design visuel' },
  { id: 'video-generation',   label: 'Génération vidéo',   desc: 'Sora, Veo, Runway, Kling, création vidéo IA' },
  { id: 'audio-voix',         label: 'Audio & voix',       desc: 'Voix IA, TTS, doublage, ElevenLabs, agents vocaux' },
  { id: 'multimodal',         label: 'Multimodal',         desc: 'Vision + texte + audio combinés, LMM' },
  { id: 'rag-memoire',        label: 'RAG & mémoire',      desc: 'Retrieval-augmented generation, mémoire persistante, vector DB' },
  { id: 'fine-tuning',        label: 'Fine-tuning & training', desc: 'Entraînement, fine-tuning, LoRA, distillation' },
  { id: 'benchmarks',         label: 'Benchmarks',         desc: 'Évaluations, comparaisons, performances des modèles' },
  { id: 'recherche',          label: 'Recherche IA',       desc: 'Papers, avancées scientifiques, laboratoires' },
  { id: 'ethique-securite',   label: 'Éthique & sécurité', desc: 'Sécurité IA, biais, alignement, prompt injection, garde-fous' },
  { id: 'regulation',         label: 'Régulation & législation', desc: 'AI Act, régulation, cadre juridique' },
  { id: 'deepfake',           label: 'Deepfakes',          desc: 'Fausses images/vidéos, détection, manipulation' },
  { id: 'ia-emploi',          label: 'IA & emploi',        desc: 'Impact sur le marché du travail, métiers, carrière' },
  { id: 'ia-education',       label: 'IA & éducation',     desc: 'Apprentissage, tutorat, école, université' },
  { id: 'ia-sante',           label: 'IA & santé',         desc: 'Applications médicales, biologie, découvertes cliniques' },
  { id: 'robots',             label: 'Robots & embodied AI', desc: 'Robots humanoïdes, world models, robotique' },
  { id: 'gouvernement-geopolitique', label: 'Géopolitique IA', desc: 'États, Chine/USA/Europe, souveraineté, enjeux stratégiques' },
  { id: 'chatbots',           label: 'Chatbots & assistants', desc: 'Perplexity, Meta AI, Grok, assistants conversationnels' },
  { id: 'ia-quotidien',       label: 'IA au quotidien',    desc: 'Astuces pratiques, hacks, usages courants' },
  { id: 'ia-creation-contenu', label: 'Création de contenu', desc: 'Marketing, réseaux sociaux, création éditoriale' },
  { id: 'nouveautes-modeles', label: 'Nouveautés & releases', desc: 'Actualité chaude, nouveaux modèles/produits' },
  { id: 'outils-gratuits',    label: 'Outils gratuits',    desc: 'Ressources et outils IA gratuits' },
  { id: 'critique-ia',        label: 'Regard critique',    desc: 'Limites, arnaques, débats sur l\'IA' },
];

/**
 * Ask Gemini to normalize the article into a small set of topic ids from the
 * controlled vocabulary above. Returns { topics: [ids...] }.
 */
export function buildTopicsMessages({ articleTitle, articleDescription, articleBody, existingTags = [] }) {
  const vocab = TOPIC_VOCABULARY
    .map((t) => `  - ${t.id}: ${t.label} — ${t.desc}`)
    .join('\n');
  const bodySnippet = String(articleBody || '').slice(0, 6000);
  const existingBlock = existingTags.length
    ? `\nTags existants (indicatif, à ignorer si non pertinent) : ${existingTags.join(', ')}`
    : '';

  return [
    {
      role: 'system',
      content:
        "Tu classes des articles francophones sur l'intelligence artificielle en topics thématiques standardisés. Tu réponds toujours avec un JSON valide.",
    },
    {
      role: 'user',
      content: `Analyse l'article ci-dessous et donne les topics qui le décrivent le mieux, à choisir DANS LA LISTE FERMÉE (vocabulaire contrôlé). Sélectionne 3 à 6 topics VRAIMENT pertinents (pas tous — seulement ceux dont le contenu est réellement présent dans l'article). Priorise la SPÉCIFICITÉ (ex: préférer \`claude\` si l'article parle de Claude, plutôt qu'ajouter \`ia-quotidien\` en plus si ce n'est pas central).

Si un thème récurrent ne rentre dans AUCUNE catégorie existante, tu peux ajouter AU MAXIMUM UN nouveau topic sous la forme \`{"id": "kebab-case", "label": "Nom lisible"}\`. Ne pas abuser de cette possibilité.

VOCABULAIRE CONTRÔLÉ :
${vocab}

ARTICLE
Titre : ${articleTitle}
Description : ${articleDescription}${existingBlock}

Corps (extrait) :
"""
${bodySnippet}
"""

Réponds UNIQUEMENT avec un JSON valide au format :
{
  "topics": ["topic-id-1", "topic-id-2", "topic-id-3"],
  "newTopic": { "id": "kebab-case", "label": "Nom" } | null
}`,
    },
  ];
}

/**
 * Ask Gemini to write a nice title + editorial description for a playlist,
 * given the topic id/label and a sample of article titles.
 */
export function buildPlaylistIntroMessages({ topicLabel, articleTitles }) {
  const sample = articleTitles.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n');
  return [
    {
      role: 'system',
      content:
        "Tu es un éditeur de contenu francophone. Tu rédiges des titres et introductions concises pour des playlists thématiques d'articles sur l'IA. JSON valide uniquement.",
    },
    {
      role: 'user',
      content: `Rédige un titre et une courte introduction pour une playlist thématique regroupant plusieurs articles autour du sujet "${topicLabel}".

Voici quelques articles qui la composent :
${sample}

Contraintes :
- Titre court, éditorial, sans emoji, sans point final. (≤ 60 caractères)
- Description : 1 phrase qui décrit ce qu'on trouvera dans la playlist et pourquoi c'est intéressant. (≤ 180 caractères)
- Intro : 2 à 4 phrases qui articulent la COMPLÉMENTARITÉ des articles — quels angles ils couvrent ensemble, pourquoi les lire en série. (≤ 500 caractères)
- Pas d'invention : reste fidèle au thème.
- Aucun nom de créateur individuel.

Réponds UNIQUEMENT avec un JSON valide au format :
{
  "title": "…",
  "description": "…",
  "intro": "…"
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

  // Banned tokens: every creator name + handle on the site. The model must
  // not insert any of these in the markdown body OR in the title.
  const bannedNames = [
    'Vision IA',
    'VisionIA',
    'Yassine Sdiri',
    'Yassine',
    'Shubham Sharma',
    'Shubham',
    'Estherium',
    'estherium',
    'Une Fille IA',
    'unefille.ia',
    'unefille',
    'le créateur',
    'la créatrice',
    'le youtubeur',
    'la youtubeuse',
    'le tiktokeur',
    'la tiktokeuse',
    "l'auteur de la vidéo",
    "l'autrice de la vidéo",
  ];

  const userContent = [
    {
      type: 'text',
      text: `Tu rédiges un article de blog en français pour "Les GOATs de l'IA".

OBJECTIF
L'article doit être une VERSION ÉCRITE ET REFORMULÉE du contenu de la vidéo.
Toute la valeur informative de la vidéo (étapes, exemples, démos, chiffres,
comparaisons, conseils, mises en garde, citations clés) doit se retrouver dans
l'article, en français écrit clair.

CONTEXTE INTERNE (NE JAMAIS INSÉRER DANS L'ARTICLE)
Source vidéo : ${platformLabel} — ${videoUrl}
Titre original : ${videoTitle}
Publiée le : ${publishedAt || 'récemment'}
Description fournie :
"""
${(description || '').slice(0, 4000)}
"""${transcriptBlock}

────────────────────────────────────────────────────────
RÈGLE ABSOLUE — TOLÉRANCE ZÉRO :
L'article (titre + markdown) ne doit JAMAIS contenir :
- Le nom du créateur ni aucune variante ni le handle. Liste interdite (ne JAMAIS
  écrire l'un de ces tokens, ni dans le corps, ni dans le titre, ni en fin de
  phrase) :
${bannedNames.map((n) => `  • ${n}`).join('\n')}
- Aucune périphrase qui désigne le créateur : "le créateur", "la créatrice",
  "le youtubeur", "la tiktokeuse", "l'auteur de la vidéo", "l'autrice", etc.
- Aucune référence au format vidéo : "dans cette vidéo", "dans sa dernière vidéo",
  "comme on le voit dans la vidéo", "vidéo récente", "le présentateur explique",
  "comme expliqué", "il/elle nous montre", "il/elle propose", "selon X",
  "d'après X", "X met en avant", "X met en garde", "X partage", "X décortique",
  etc.
- Aucune introduction du type "Dans sa dernière vidéo, X partage…" ou
  "X, créateur de contenu spécialisé en IA, propose…" ou
  "X met en lumière…" ou "X, expert en IA, …".

L'article s'exprime À LA TROISIÈME PERSONNE NEUTRE et ne fait JAMAIS référence
à un créateur, à une vidéo, à un présentateur, ni à une chaîne. Le sujet est
TOUJOURS le contenu lui-même.

EXEMPLES
❌ INACCEPTABLE :
   "Dans sa dernière vidéo, Yassine Sdiri partage 7 outils IA…"
   "Selon Shubham Sharma, 93% des entreprises…"
   "Le créateur détaille comment choisir une PDP…"
   "Yassine Sdiri met en lumière des solutions concrètes…"

✅ ACCEPTABLE :
   "Sept outils IA permettent aujourd'hui aux entrepreneurs de…"
   "93 % des entreprises ne sont pas prêtes pour la facturation électronique…"
   "Pour choisir une plateforme de dématérialisation partenaire (PDP)…"
   "Plusieurs solutions concrètes existent pour intégrer l'IA…"
────────────────────────────────────────────────────────

CONTRAINTES
1. Plonge directement dans le sujet dès la première phrase. L'intro pose
   l'enjeu, pas le format. Pas de "Dans cette vidéo…".
2. Structure :
   - Intro de 2-3 phrases qui pose le sujet et son enjeu concret.
   - 3 à 6 sections en \`##\` avec des titres concrets, qui développent
     les points abordés.
   - Une section finale \`## À retenir\` avec 3 à 5 puces concrètes.
3. Donne TOUS les éléments concrets : noms exacts des outils/modèles,
   chiffres, étapes de manip, citations courtes (sans attribuer à un
   créateur), comparaisons.
4. Pas d'invention : ne mentionne que ce qui est dans le transcript ou
   la description.
5. Ton journalistique francophone, accessible, sans tutoiement systématique
   ni ton promo.
6. Ne mentionne PAS que tu es une IA, ni que c'est une transcription.
7. Le titre de l'article ne doit PAS contenir de nom de créateur ni de
   format ("vidéo", "tutoriel", etc.).

RÉPONSE
Réponds UNIQUEMENT avec un objet JSON valide :
{
  "title": "Titre de l'article (≤ 80 car, sans nom de créateur)",
  "description": "Phrase d'accroche (≤ 160 car, sans nom de créateur)",
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
        "Tu es un journaliste tech francophone spécialisé en intelligence artificielle. Tu rédiges des articles riches en contenu, qui transposent fidèlement la matière d'une vidéo en texte écrit. RÈGLE ABSOLUE : tu ne mentionnes JAMAIS le nom d'un créateur (ni Yassine Sdiri, ni Shubham Sharma, ni Une Fille IA, ni Estherium, ni Vision IA, ni leurs handles, ni leurs périphrases comme 'le créateur', 'la tiktokeuse', etc.) dans le corps ou le titre de l'article. L'article s'exprime de manière neutre, à la troisième personne, sans jamais référer à une vidéo ni à un présentateur. Tu réponds toujours avec un JSON valide quand on te le demande.",
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
