# 🐐 Les GOATs de l'IA

Blog automatisé qui suit 5 créateurs de contenu IA (3 YouTube, 2 TikTok). Chaque
nouvelle vidéo est analysée par **Gemini via OpenRouter** et transformée en
article. Une seule page : la timeline (du plus récent au plus ancien).

- 🌐 Site statique en **Astro**
- 🚀 Déploiement **Netlify** branché sur ce repo
- 🤖 Automatisation via **GitHub Actions** (cron) avec commits auto

## Stack & flux

```
YouTube RSS / TikTok (yt-dlp tiktokuser:secUid)
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

Sélection automatique dans `scripts/lib/openrouter.js`.

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
- Les articles sont commités dans le repo par les GitHub Actions.

### 4. Workflows

| Workflow                              | Cron               | Action                                 |
|---------------------------------------|--------------------|----------------------------------------|
| `.github/workflows/poll-feeds.yml`    | `*/30 * * * *` + push | Poll des feeds, génération d'articles |
| `.github/workflows/backfill.yml`      | push de `data/backfill-request.json` ou workflow_dispatch | Génération rétroactive sur une période |

Le workflow `poll-feeds` se déclenche aussi à chaque push (sauf sur les fichiers
qu'il modifie lui-même : `src/content/articles/**`, `data/seen.json`,
`src/data/creators.json` — pour éviter les boucles).

## Développement local

```bash
npm run dev                          # site en dev
node scripts/poll-feeds.js --dry-run # poll sans appeler OpenRouter
npm run poll                         # poll réel (nécessite OPENROUTER_API_KEY)
npm run backfill -- --month 2026-04  # backfill d'un mois
npm run refresh-avatars              # rafraîchit les avatars
npm run build                        # build statique
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
  "socialUrl": "https://www.youtube.com/@HandleYouTube",
  "channelHandle": "HandleYouTube",
  "avatar": "",
  "bio": ""
}
```

Pour TikTok, mets `"platform": "tiktok"` et `"channelHandle"` doit être le handle
TikTok sans le `@`. L'avatar est rempli automatiquement par `refresh-avatars.js`
au prochain run du workflow.

## Structure du repo

```
.
├── src/
│   ├── pages/             # / et /articles/[slug]/
│   ├── layouts/           # BaseLayout (header minimal)
│   ├── components/        # CreatorAvatar, TimelineItem
│   ├── content/articles/  # Markdown articles auto-générés
│   ├── data/creators.json # Liste des 5 GOATs
│   └── styles/global.css
├── scripts/
│   ├── poll-feeds.js      # Polling régulier (filtre 30 jours)
│   ├── backfill.js        # Backfill paramétré (--month / --from --to)
│   ├── refresh-avatars.js # Rafraîchissement des avatars
│   └── lib/
│       ├── youtube.js     # RSS + youtube-transcript
│       ├── tiktok.js      # secUid + yt-dlp tiktokuser:secUid
│       ├── openrouter.js  # Appels Gemini + prompts
│       ├── markdown.js    # Génération frontmatter / slug
│       ├── generate.js    # Logique partagée (poll + backfill)
│       └── state.js       # data/seen.json
├── data/
│   ├── seen.json          # Tracking des vidéos déjà traitées
│   └── backfill-request.json # (optionnel) demande de backfill
├── .github/workflows/
│   ├── poll-feeds.yml     # cron 30 min + push
│   └── backfill.yml       # déclenché par data/backfill-request.json
├── astro.config.mjs
├── netlify.toml
└── package.json
```

## Comment ça marche en détail

### Détection des vidéos
- **YouTube** — RSS officiel `feeds/videos.xml?channel_id=...`. Le channel ID est
  résolu automatiquement à partir du handle.
- **TikTok** — extraction du `secUid` depuis le HTML de la page profil, puis
  `yt-dlp tiktokuser:<secUid>` pour récupérer la liste des vidéos avec toutes
  leurs métadonnées (titre, description, miniature, durée, timestamp).

### Génération d'article
1. Le transcript YouTube est récupéré via `youtube-transcript` (FR puis EN).
2. Le titre, la description et la miniature sont passés à Gemini.
3. Gemini renvoie un JSON avec `title`, `description`, `tags`, `markdown`.
4. Le markdown est écrit dans `src/content/articles/YYYY-MM-DD-creator-slug.md`.

## Notes & limites

- Le seuil de 30 jours dans `poll-feeds.js` empêche que la première exécution
  ne génère 100 articles d'un coup. Pour rétro-générer, utilise `backfill.js`.
- Les vidéos TikTok n'ont pas de transcript — Gemini se base donc sur le titre,
  la description (souvent verbeuse sur TikTok) et la miniature.

## Crédits

Articles écrits par Gemini 2.5. Les vidéos originales et la propriété
intellectuelle restent celle des créateurs — chaque article inclut le lien
vers la vidéo source.
