# 🐐 Les GOATs de l'IA

Blog automatisé qui suit 5 créateurs de contenu IA (3 YouTube, 2 TikTok). Chaque
nouvelle vidéo est analysée par **Gemini via OpenRouter** et transformée en
article. Récaps quotidiens, hebdo et mensuels générés automatiquement.

- 🌐 Site statique en **Astro**
- 🚀 Déploiement **Netlify** branché sur ce repo
- 🤖 Automatisation via **GitHub Actions** (cron) avec commits auto

## Stack & flux

```
YouTube RSS / TikTok (RSSHub)
        │
        ▼
GitHub Actions (cron 30 min)
        │
        ▼
poll-feeds.js → Gemini 2.5 (OpenRouter) → markdown commit
        │
        ▼
Netlify rebuild auto
```

## Modèles utilisés

| Tâche                                | Modèle OpenRouter             |
|--------------------------------------|-------------------------------|
| Article (vidéo courte / par défaut)  | `google/gemini-2.5-flash-lite`|
| Article (vidéo longue >20 min)       | `google/gemini-2.5-pro`       |
| Récap quotidien / hebdo / mensuel    | `google/gemini-2.5-flash`     |

La sélection est faite dans `scripts/lib/openrouter.js`.

## Mise en place

### 1. Cloner & installer

```bash
npm install
```

### 2. Configurer les secrets GitHub

Dans **Settings → Secrets and variables → Actions** du repo, ajouter :

- `OPENROUTER_API_KEY` — la clé OpenRouter (obligatoire)

### 3. Connecter Netlify

- Lier le repo GitHub à un site Netlify.
- Netlify lit `netlify.toml` automatiquement (build : `npm run build`, output : `dist`).
- Aucune variable env n'est requise côté Netlify : les articles sont déjà
  commités dans le repo par les GitHub Actions.

### 4. Activer les workflows

Les 4 workflows tournent automatiquement :

| Workflow                       | Cron               | Action                                   |
|--------------------------------|--------------------|------------------------------------------|
| `.github/workflows/poll-feeds.yml`   | `*/30 * * * *` + push | Poll des feeds, articles individuels |
| `.github/workflows/recap-daily.yml`  | `55 22 * * *`    | Récap quotidien                         |
| `.github/workflows/recap-weekly.yml` | `10 23 * * 0`    | Récap hebdo (dimanche soir)             |
| `.github/workflows/recap-monthly.yml`| `0 2 1 * *`      | Récap du mois passé (le 1er du mois)    |

Le workflow `poll-feeds` se déclenche aussi à chaque push (sauf sur les fichiers
qu'il modifie lui-même : `src/content/articles/**`, `src/content/recaps/**`,
`data/seen.json` — pour éviter les boucles). Tu peux donc forcer un run en
poussant un commit. "Run workflow" est aussi disponible dans l'onglet Actions
de GitHub (clic sur le nom du workflow → bouton à droite).

## Développement local

```bash
# Lancer le site en dev
npm run dev

# Tester le polling (sans appeler OpenRouter)
node scripts/poll-feeds.js --dry-run

# Tester réellement (nécessite OPENROUTER_API_KEY)
export OPENROUTER_API_KEY=sk-or-...
npm run poll

# Générer un récap manuellement
npm run recap:daily
npm run recap:weekly
npm run recap:monthly

# Build du site
npm run build
```

## Ajouter / modifier des créateurs

Édite `src/data/creators.json`. Pour un nouveau YouTuber :

```json
{
  "id": "slug-unique",
  "name": "Nom affiché",
  "handle": "@HandleYouTube",
  "platform": "youtube",
  "url": "https://www.youtube.com/@HandleYouTube/videos",
  "channelHandle": "HandleYouTube",
  "bio": "Une phrase de bio."
}
```

Pour TikTok, mets `"platform": "tiktok"` et `"channelHandle"` doit être le handle
TikTok sans le `@`.

## Structure du repo

```
.
├── src/
│   ├── pages/             # Routes Astro (index, articles, recaps, créateurs)
│   ├── layouts/           # BaseLayout
│   ├── components/        # ArticleCard, RecapCard
│   ├── content/
│   │   ├── articles/      # Markdown articles auto-générés
│   │   └── recaps/        # Markdown récaps auto-générés
│   ├── data/creators.json # Liste des 5 GOATs
│   └── styles/global.css
├── scripts/
│   ├── poll-feeds.js      # Polling principal
│   ├── recap.js           # Récaps quotidien/hebdo/mensuel
│   └── lib/
│       ├── youtube.js     # RSS + youtube-transcript
│       ├── tiktok.js      # RSSHub gateway
│       ├── openrouter.js  # Appels Gemini + prompts
│       ├── markdown.js    # Génération frontmatter / slug
│       └── state.js       # data/seen.json
├── data/seen.json         # Tracking des vidéos déjà traitées
├── .github/workflows/     # 4 cron jobs
├── astro.config.mjs
├── netlify.toml
└── package.json
```

## Comment ça marche en détail

### Détection des vidéos
- **YouTube** — RSS officiel `feeds/videos.xml?channel_id=...`. Le channel ID est
  résolu automatiquement à partir du handle (scrape de la page chaîne).
- **TikTok** — pas d'API publique. On scrape la page profil pour en extraire le
  `secUid` (présent dans le payload `__UNIVERSAL_DATA_FOR_REHYDRATION__`), puis
  on appelle `yt-dlp tiktokuser:<secUid>` qui retourne la liste des vidéos avec
  toutes leurs métadonnées (titre, description, miniature, durée, timestamp).
  Aucune clé API ni aucun service tiers nécessaire.

### Génération d'article
Pour chaque nouvelle vidéo :
1. Le transcript YouTube est récupéré via `youtube-transcript` (FR puis EN).
2. Le titre, la description et la miniature sont passés à Gemini.
3. Gemini renvoie un JSON avec `title`, `description`, `tags`, `markdown`.
4. Le markdown est écrit dans `src/content/articles/YYYY-MM-DD-creator-slug.md`.

### Récaps
- Quotidien — agrège les articles publiés entre 00:00 et 23:59 UTC du jour.
- Hebdo — agrège la semaine en cours (lundi → dimanche).
- Mensuel — agrège le mois précédent (cron le 1er à 02:00 UTC).

Chaque récap commence par une intro **mélangée** (vue éditoriale transverse) puis
détaille **point par point** ce qu'a publié chaque créateur.

## Notes & limites

- Le seuil de 30 jours dans `poll-feeds.js` empêche que la première exécution ne
  génère 100 articles d'un coup. Modifie-le dans `scripts/poll-feeds.js` si tu
  veux re-traiter de l'historique.
- Les vidéos TikTok n'ont pas de transcript — Gemini se base donc sur le titre,
  la description (souvent verbeuse sur TikTok) et la miniature. Pour de la
  transcription audio, tu peux ajouter un step Whisper (yt-dlp + groq/whisper API).
- L'extraction du `secUid` TikTok dépend du HTML public. Si TikTok refactore son
  payload, il suffit d'adapter `scripts/lib/tiktok.js` (la résolution est isolée
  dans `resolveSecUid`).

## Crédits

Articles écrits par Gemini 2.5. Les vidéos originales et la propriété
intellectuelle restent celle des créateurs — chaque article inclut le lien
vers la vidéo source.
