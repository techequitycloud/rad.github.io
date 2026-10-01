---
title: "Karakeep Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Karakeep — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Karakeep_Common.md @ 3055034 sha256:aeedfd1010b6 -->

# Karakeep Common — Configuration applicative partagée {#karakeep-common--shared-application-configuration}

`Karakeep_Common` est la **couche applicative partagée** de Karakeep. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Karakeep sur laquelle
s'appuient à la fois [Karakeep_GKE](Karakeep_GKE.md) et
[Karakeep_CloudRun](Karakeep_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle ne possède aucune entrée propre
dans l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Karakeep, consultez les
guides de plateforme ([Karakeep_GKE](Karakeep_GKE.md),
[Karakeep_CloudRun](Karakeep_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Karakeep_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `NEXTAUTH_SECRET` (44 caractères alphanumériques) et `MEILI_MASTER_KEY` (32 caractères alphanumériques) et les stocke dans **Secret Manager** | Injectés automatiquement ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Référence directement l'image officielle `ghcr.io/karakeep-app/karakeep` — aucun build personnalisé | Output `container_image` du déploiement de plateforme |
| Moteur de base de données | **Aucun** — `database_type = "NONE"` ; Karakeep n'utilise aucune instance Cloud SQL | §Base de données dans les guides de plateforme |
| Persistance | Ne déclare aucun job d'amorçage de base de données ; l'état réside entièrement sur le volume NFS de la plateforme, câblé au niveau du module applicatif | Sans objet — aucun `initialization_jobs` provenant de cette couche |
| Stockage objet | Aucun — `storage_buckets = []` | Output `storage_buckets` (vide) |
| Paramètres principaux | Définit le port de base (3000) et les cibles des sondes | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :

- **`NEXTAUTH_SECRET`** — une chaîne alphanumérique aléatoire de 44 caractères. Elle
  signe tous les JWT de session. Sa rotation après le premier démarrage invalide
  immédiatement toutes les sessions utilisateur actives, obligeant chacun à se
  reconnecter.
- **`MEILI_MASTER_KEY`** — une chaîne alphanumérique aléatoire de 32 caractères,
  partagée entre l'application Karakeep et son sidecar Meilisearch. Tous deux doivent
  présenter cette clé pour communiquer avec Meilisearch. Elle peut faire l'objet
  d'une rotation, mais l'application et le sidecar doivent alors être redéployés
  ensemble — une clé obsolète d'un côté ou de l'autre casse l'authentification de la
  recherche entre eux.

Récupérez les secrets après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Aucun secret de mot de passe de base de données n'existe pour ce module — il n'y a
pas de base de données. Consultez [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity utilisé ailleurs dans le catalogue.

---

## 3. Pas de base de données, pas de job d'amorçage {#3-no-database-no-bootstrap-job}

Karakeep assure entièrement sa persistance dans une base SQLite intégrée et des
ressources téléversées sous `DATA_DIR` (`/data`) sur le volume NFS de la plateforme —
il n'y a pas d'instance Cloud SQL, et donc aucun job d'amorçage de type `db-init`
provenant de cette couche. `database_type = "NONE"` est défini explicitement dans
l'output `config` afin que le socle ignore entièrement le provisionnement d'une
instance Cloud SQL.

`enable_nfs` et `nfs_mount_path` sont des variables ordinaires du socle, déclarées et
transmises au niveau du **module applicatif** (`Karakeep_CloudRun`/`Karakeep_GKE`),
et non par cette couche Common — Common suppose seulement que le volume sera présent.

---

## 4. Image de conteneur {#4-container-image}

`Karakeep_Common` définit directement `container_image = "ghcr.io/karakeep-app/karakeep:<tag>"`
et `image_source = "prebuilt"` — pas de Dockerfile, pas d'étape Cloud Build. Il
s'agit d'un écart délibéré par rapport à la source de clonage de ce module
(`UptimeKuma_Common`), qui nécessitait un build personnalisé pour modifier le mode
de journalisation de SQLite et l'éloigner de WAL. Le code source de Karakeep
conditionne déjà le mode WAL à une variable d'environnement facultative
`DB_WAL_MODE` (avec par défaut le mode `DELETE`, compatible NFS), que ce module ne
définit jamais — aucun correctif n'est donc nécessaire.

`<tag>` est résolu à partir de `application_version` : `"latest"` correspond au tag
évolutif `"release"` propre à Karakeep (il n'existe pas de tag littéral `"latest"`
sur Docker Hub/GHCR) ; toute autre valeur est transmise telle quelle (par ex.
`"0.28.0"`).

---

## 5. Le sidecar Meilisearch (déclaré au niveau de la couche applicative) {#5-the-meilisearch-sidecar-declared-at-the-application-layer}

Karakeep a besoin de Meilisearch pour la recherche — sans lui, `MEILI_ADDR` n'est pas
défini et la recherche est désactivée silencieusement. Ce sidecar n'est **pas**
déclaré par `Karakeep_Common` ; il est ajouté par chaque module applicatif
(`Karakeep_CloudRun`/`Karakeep_GKE`) via le mécanisme `additional_services` du
socle, en référençant l'output secret `MEILI_MASTER_KEY` de `Karakeep_Common` afin
que l'application et le sidecar partagent la même clé d'authentification. Consultez
les guides de plateforme pour le câblage exact.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/` — la page publique de connexion/d'accueil de
Karakeep, accessible sans authentification. Karakeep ne documente pas de point de
terminaison dédié `/health` ou `/healthz`.

- **Cloud Run et GKE** utilisent tous deux une sonde HTTP ciblant `/` avec un délai
  initial de 30 secondes et un seuil d'échec généreux (30 pour le démarrage) afin de
  tolérer la mise en place du schéma au premier démarrage.

---

Pour la configuration propre à Karakeep et destinée aux utilisateurs (variables par
groupe, outputs et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Karakeep_GKE](Karakeep_GKE.md)** et
**[Karakeep_CloudRun](Karakeep_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Karakeep sur Google Cloud Run](Karakeep_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Karakeep sur GKE Autopilot](Karakeep_GKE.md) — cette configuration déployée sur GKE.
