---
title: "Stirling-PDF Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Stirling-PDF — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/StirlingPDF_Common.md @ 3055034 sha256:c90fd7d52760 -->

# Stirling-PDF Common — Configuration applicative partagée {#stirling-pdf-common--shared-application-configuration}

`StirlingPDF_Common` est la **couche applicative partagée** de Stirling-PDF. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Stirling-PDF sur
laquelle s'appuient à la fois [StirlingPDF_GKE](StirlingPDF_GKE.md) et
[StirlingPDF_CloudRun](StirlingPDF_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où c'est important. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Stirling-PDF,
consultez les guides des plateformes ([StirlingPDF_GKE](StirlingPDF_GKE.md),
[StirlingPDF_CloudRun](StirlingPDF_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par StirlingPDF_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Fait pointer le déploiement vers l'image officielle préconstruite **`stirlingtools/stirling-pdf`** (`image_source = "prebuilt"`) ; aucune étape Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **`database_type = "NONE"`** — Stirling-PDF est sans état et n'utilise aucune base de données | §Base de données dans les guides des plateformes |
| Secrets | **Aucun.** `secret_ids` et `secret_values` sont des maps vides — la connexion est désactivée par défaut, aucun secret de session n'est donc requis | §Variables d'environnement et secrets dans les guides des plateformes |
| Stockage objet | **Aucun.** `storage_buckets` est toujours une liste vide — Stirling-PDF ne persiste rien | Sortie `storage_buckets` |
| Paramètres principaux | *Non fournis ici.* L'activation de la connexion (`SECURITY_ENABLELOGIN`) et la langue par défaut de l'interface (`SYSTEM_DEFAULTLOCALE`) sont définies par les variables `enable_login`/`default_locale` propres à chaque module applicatif et câblées via son `module_env_vars` — l'output `config` de `StirlingPDF_Common` ne contient aucune de ces deux clés | Comportement de l'application dans les guides des plateformes |
| Profil d'exécution | Port 8080, limites de CPU/mémoire (plancher de 2Gi) et nombres minimal/maximal d'instances propres à chaque plateforme | §Exécution et mise à l'échelle dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage / de vivacité / de disponibilité par défaut ciblant `/api/v1/info/status` | §Observabilité dans les guides des plateformes |

---

## 2. Ni secrets, ni base de données, ni stockage {#2-no-secrets-no-database-no-storage}

Stirling-PDF est une boîte à outils PDF **sans état**, et c'est le point le plus
important à comprendre à propos de ce déploiement. Contrairement à la plupart des
couches applicatives, `StirlingPDF_Common` ne génère **aucun secret** et ne
provisionne **aucune ressource persistante** :

- **`secret_ids` est une map vide.** La connexion étant désactivée par défaut
  (`SECURITY_ENABLELOGIN=false`), l'application ne requiert ni clé de session, ni
  secret JWT, ni mot de passe de base de données. `secret_values` est également vide.
  Il n'y a rien dans Secret Manager à faire tourner ni à divulguer.
- **`database_type = "NONE"`.** Aucune instance, base de données ou utilisateur Cloud
  SQL n'est créé. Chaque opération PDF — fusion, découpage, conversion, OCR,
  compression, filigrane, signature, caviardage — s'exécute entièrement dans un
  répertoire de travail propre à la requête, supprimé à la fin de celle-ci.
- **`storage_buckets` vaut toujours `[]`.** Aucun bucket Cloud Storage, aucun partage
  NFS, aucun volume GCS Fuse. Rien de ce qu'envoie un utilisateur n'est conservé
  après le retour de la réponse — les documents ne quittent jamais l'instance.

C'est cette absence d'état qui fait de Stirling-PDF un candidat naturel pour la
**mise à l'échelle jusqu'à zéro sur Cloud Run** et pour la **mise à l'échelle
horizontale sur GKE sans aucune coordination d'état partagé**. Il n'y a ni job
d'initialisation, ni migration, ni configuration de données au premier démarrage.

---

## 3. Image de conteneur {#3-container-image}

Le déploiement utilise directement l'image officielle en amont — il n'y a aucun build
personnalisé :

- **Image :** `stirlingtools/stirling-pdf:<version>` (étiquette par défaut `latest`).
- **Source de l'image :** `"prebuilt"` — le module applicatif transmet
  `container_image_source`, et `enable_image_mirroring = true` copie l'image dans
  Artifact Registry (en tenant compte du digest) avant le déploiement, afin d'éviter
  les limites de débit de Docker Hub.
- **Aucune étape Cloud Build.** `container_build_config.enabled = false` ; aucun
  Dockerfile n'est compilé au moment de l'application.

Comme l'image est celle d'origine, non modifiée, une montée de version de
l'application se résume à une nouvelle étiquette d'image — aucune reconstruction
n'est nécessaire, et il n'y a aucune migration de schéma à exécuter.

---

## 4. Paramètres principaux de l'application (gérés par les modules applicatifs, et non par Common) {#4-core-application-settings-owned-by-the-application-modules-not-common}

`StirlingPDF_Common/variables.tf` ne déclare aucune variable `enable_login` ou
`default_locale`, et son output `config` (dans `main.tf`) ne définit jamais
`SECURITY_ENABLELOGIN` ni `SYSTEM_DEFAULTLOCALE`. Ces deux paramètres relèvent
entièrement du fichier `stirlingpdf.tf` propre à chaque module applicatif
(`StirlingPDF_CloudRun`/`StirlingPDF_GKE`), qui déclare `enable_login`/`default_locale`
et les assemble dans `local.module_env_vars` :

- **`SECURITY_ENABLELOGIN`** — définie à partir de `enable_login` du module
  applicatif (valeur par défaut `false`). Une instance ouverte est livrée par défaut ;
  définissez `enable_login = true` et placez le service derrière IAP ou Cloud Armor
  pour un déploiement privé.
- **`SYSTEM_DEFAULTLOCALE`** — définie à partir de `default_locale` du module
  applicatif (valeur par défaut `en-US`) pour que la langue de l'interface reste
  prévisible.

D'autres paramètres Stirling-PDF (par exemple `SYSTEM_MAXFILESIZE` pour plafonner la
taille des envois) peuvent être fournis via l'entrée `environment_variables` du
module applicatif ; ils sont fusionnés dans l'environnement du conteneur à
l'exécution.

Aucune réécriture d'URL propre à une plateforme ni aucune correspondance de base de
données n'entre en jeu — Stirling-PDF est sans état et autonome, de sorte que la même
configuration fonctionne de manière identique sur Cloud Run et sur GKE. La seule
différence entre plateformes est le nombre minimal d'instances (voir ci-dessous).

---

## 5. Profil d'exécution et mise à l'échelle {#5-runtime-shape-and-scaling}

`StirlingPDF_Common` définit les valeurs d'exécution par défaut utilisées par le
socle :

- **Port** — `container_port = 8080`.
- **Ressources** — la JVM et le moteur de conversion LibreOffice ont besoin d'un
  **plancher mémoire de 2Gi** ; les modules applicatifs utilisent par défaut `1000m`
  de CPU / `2Gi` de mémoire et l'augmentent pour les charges de travail lourdes d'OCR /
  de conversion.
- **Nombres d'instances** — `min_instance_count` est redéfini pour chaque plateforme :
  **`0` sur Cloud Run** (mise à l'échelle jusqu'à zéro, facturation à la requête —
  Stirling-PDF n'effectue aucun travail en arrière-plan) et **`1` sur GKE** (qui ne
  prend pas en charge la mise à l'échelle jusqu'à zéro). `max_instance_count` vaut
  `3` par défaut ; comme il n'y a aucun état partagé, l'ajout d'instances est sûr sur
  l'une ou l'autre plateforme, sans cache de coordination.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/api/v1/info/status`** — un point de terminaison
Stirling-PDF public et non authentifié qui répond 200 une fois que la JVM et
LibreOffice ont terminé leur initialisation. Il constitue une cible de sonde sûre même
lorsque `enable_login = true`, car le point de terminaison de statut ne requiert
aucune authentification.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/api/v1/info/status` | 10s | 10s | 6 |
| Vivacité | HTTP | `/api/v1/info/status` | 15s | 30s | 3 |
| Disponibilité | HTTP | `/api/v1/info/status` | 20s | 10s | 3 |

La sonde de démarrage accorde jusqu'à environ **70 secondes** (délai initial de 10s +
6 × 10s) pour que la JVM et LibreOffice se préchauffent au premier démarrage — une
fenêtre généreuse qui absorbe le démarrage lent de Spring Boot et de LibreOffice sans
faire échouer la révision (Cloud Run) ou le pod (GKE). Une sonde pointant vers une
page authentifiée renverrait 403 et ne réussirait jamais ; `/api/v1/info/status` est
le bon point de terminaison public de vivacité.

---

## 7. Sorties {#7-outputs}

`StirlingPDF_Common` expose les outputs suivants, que le module applicatif fusionne
dans `application_config` avant de tout transmettre au socle :

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Configuration complète de l'application (image préconstruite, port 8080, `database_type = "NONE"`, sondes, variables d'environnement, limites de ressources). |
| `secret_ids` | `map(string)` | Toujours vide — Stirling-PDF ne requiert aucun secret. |
| `secret_values` | `map(string)` | Toujours vide (sensible). |
| `storage_buckets` | `list` | Toujours vide — Stirling-PDF est sans état. |
| `path` | `string` | Chemin absolu du répertoire du module dans le système de fichiers, utilisé pour résoudre `scripts_dir`. |

---

Pour la configuration propre à Stirling-PDF et visible par l'utilisateur (variables
par groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[StirlingPDF_GKE](StirlingPDF_GKE.md)** et
**[StirlingPDF_CloudRun](StirlingPDF_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Stirling-PDF sur Google Cloud Run](StirlingPDF_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Stirling-PDF sur GKE Autopilot](StirlingPDF_GKE.md) — cette configuration déployée sur GKE.
