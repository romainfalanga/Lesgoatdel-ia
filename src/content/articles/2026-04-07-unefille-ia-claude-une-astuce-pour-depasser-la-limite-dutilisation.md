---
title: "Optimiser l'utilisation des tokens avec Claude"
description: "Découvrez une méthode pour réduire la consommation de tokens lors de l'interaction avec Claude, améliorant ainsi l'efficacité."
pubDate: 2026-04-07T22:04:27.000Z
creator: "Une Fille IA"
creatorHandle: "@unefille.ia"
platform: "tiktok"
videoId: "7626141624715709718"
videoUrl: "https://www.tiktok.com/@unefille.ia/video/7626141624715709718"
thumbnail: "https://p16-common-sign.tiktokcdn-us.com/tos-no1a-p-0037-no/ocFm9rASIEO3Z6AFXfpEqD2C1Q2jkuAfgA4FGR~tplv-tiktokx-dmt-logom:tos-no1a-i-0068-no/ocRC9FFaAcmfG8112pidAOkqRAIEQAcUDXfrEg.image?dr=9634&x-expires=1777579200&x-signature=dQcdqiC5om%2Bi62wT4zT4eMqSBlg%3D&t=4d5b0474&ps=13740610&shp=81f88b70&shcp=43f4a2f9&idc=useast8"
duration: "0 min 17s"
tags:
  - "ia"
  - "claude"
  - "tokens"
  - "prompt"
  - "optimisation"
model: "google/gemini-2.5-flash-lite"
---

Il est possible de gérer plus efficacement la consommation de tokens lors de l'utilisation de modèles comme Claude. Une approche consiste à adopter un style de réponse concis, qui supprime les éléments superflus.

## Réduire la verbosité des réponses

Pour limiter la quantité de tokens en sortie, une technique consiste à demander au modèle d'adopter un style de communication très direct. Cela implique de supprimer les articles, les mots parasites tels que "juste", "vraiment", "en gros", "en fait", "simplement", ainsi que les formules de politesse et les hésitations. L'objectif est d'obtenir des réponses sous forme de fragments ou de phrases courtes, utilisant des synonymes concis et des termes techniques précis.

## Structurer les réponses

Une structure de réponse suggérée est la suivante : "[chose] [action] [raison]". Les étapes suivantes peuvent être indiquées de manière claire. Les blocs de code, lorsqu'ils sont présents, doivent rester inchangés.

## Modes de communication alternatifs

Il est possible de basculer vers des modes de communication plus spécifiques sur demande. Le mode "lite" maintient des phrases complètes mais sans mots parasites. Le mode "ultra" utilise des abréviations et des flèches pour indiquer la causalité. Ces modes sont conçus pour une économie de tokens encore plus poussée.

## Gestion des exceptions

L'abandon du style de communication simplifié est recommandé uniquement dans des situations spécifiques. Cela inclut les avertissements de sécurité, les actions irréversibles, ou les séquences multi-étapes qui pourraient être mal interprétées. Dans ces cas, le modèle doit reprendre un mode de communication normal. L'utilisation des commandes "stop caveman" ou "mode normal" permet d'annuler ce style de réponse.

## Astuce pour Claude Code

Pour ceux qui utilisent Claude spécifiquement pour des tâches de codage, une solution existe pour gérer la limite d'utilisation des tokens. Ce repository, nommé "caveman" et disponible sur GitHub sous "JuliusBrussee/caveman", est conçu pour optimiser la sortie des tokens dans ce contexte.

## À retenir

* Adopter un style de réponse concis pour économiser les tokens.
* Supprimer les mots parasites, les formules de politesse et les hésitations.
* Utiliser une structure de réponse claire : [chose] [action] [raison].
* Les modes "lite" et "ultra" offrent des optimisations supplémentaires.
* Le repository "caveman" est une solution pour Claude Code.
