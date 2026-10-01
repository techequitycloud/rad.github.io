---
title: "Gitea Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module Gitea — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Gitea_Common.md @ 3055034 sha256:6ee453174e43 -->

# Gitea Common — Configuration applicative partagée {#gitea-common--shared-application-configuration}

`Gitea_Common` est la **couche applicative partagée** de Gitea. Elle n'est pas déployée seule ; elle fournit la configuration propre à Gitea sur laquelle reposent les variantes GKE et [Gitea_CloudRun](Gitea_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle n'a pas d'entrées propres dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Gitea, consultez le guide de la plateforme ([Gitea_CloudRun](Gitea_CloudRun.md)) et les guides du socle ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Gitea_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé léger au-dessus de l'image officielle `gitea/gitea:<version>` (Cloud Build) avec un point d'entrée de plateforme | Output `container_image` du déploiement de la plateforme |
| Point d'entrée de plateforme | Compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}` à partir des variables d'environnement `DB_*` injectées par le socle au démarrage du conteneur, puis exécute le point d'entrée standard de Gitea | Comportement de l'application dans le guide de la plateforme |
| Moteur de base de données | Fixe **PostgreSQL** (`GITEA__database__DB_TYPE = "postgres"`) | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` (`postgres:15-alpine`) qui crée de façon idempotente le rôle et la base préfixés par le tenant | Output `initialization_jobs` |
| Secrets de l'application | Génère `SECRET_KEY` et `INTERNAL_TOKEN` dans Secret Manager ; réutilise le mot de passe de base de données du socle comme `GITEA__database__PASSWD` | Output `secret_ids` |
| Valeurs d'environnement de base | `INSTALL_LOCK=true`, `DISABLE_REGISTRATION=false`, domaine/URL racine/port du serveur, `APP_DATA_PATH` sur NFS | Environnement d'exécution du service |
| Contrôles de santé | Sondes par défaut de démarrage (`/api/healthz`, délai de 30 s) et de vivacité (`/api/healthz`, délai de 15 s) | §Observabilité dans le guide de la plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Deux secrets propres à Gitea sont générés une seule fois (valeurs aléatoires de 64 caractères) et stockés dans Secret Manager, car tous deux doivent rester stables entre les redémarrages :

- `secret-<prefix>-gitea-secret-key` — la `SECRET_KEY` de Gitea, utilisée pour chiffrer les données sensibles stockées (secrets 2FA, jetons OAuth2). La faire tourner invalide ces données chiffrées.
- `secret-<prefix>-gitea-internal-token` — l'`INTERNAL_TOKEN` de Gitea, qui authentifie les appels internes à l'API de Gitea.

Le mot de passe de la base de données n'est **pas** créé ici — il s'agit du secret `DB_PASSWORD` géré par le socle, repris dans la variable d'environnement `GITEA__database__PASSWD` par la variante de plateforme. Une attente de propagation de 30 secondes s'exécute après la création des secrets, avant que les ressources dépendantes ne les lisent.

Sur Cloud Run, les secrets sont injectés directement sous leurs noms d'environnement `GITEA__security__*`. Sur GKE, la CRD SecretSync interdit les tirets bas consécutifs dans les clés des secrets synchronisés : ils sont donc matérialisés sous des clés simples (`SECRET_KEY`, `INTERNAL_TOKEN`) et lus depuis des fichiers montés par CSI via la convention native `GITEA__section__KEY__FILE` de Gitea.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~gitea"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 3. Image de conteneur et point d'entrée de plateforme {#3-container-image-and-platform-entrypoint}

L'image est un **build quasi standard** : `FROM gitea/gitea:<application_version>` plus un script copié (`/platform-entrypoint.sh`), construit par Cloud Build et poussé dans Artifact Registry. Le socle injecte `APP_VERSION` comme argument de build qui sélectionne le tag amont.

Le point d'entrée existe parce que Cloud Run n'interpole **pas** les références d'environnement `$(VAR)` comme le fait Kubernetes. À chaque démarrage du conteneur, il :

1. Résout l'hôte de la base de données à partir de `DB_HOST` (avec repli sur `DB_IP`, puis sur le loopback).
2. Choisit le mode SSL Postgres pour chaque saut de connexion — socket Unix du Cloud SQL Auth Proxy ou loopback du proxy → `disable` ; TCP direct vers l'IP privée → `require` (Cloud SQL refuse le TCP non chiffré).
3. Exporte `GITEA__database__HOST`, `GITEA__database__NAME`, `GITEA__database__USER` et `GITEA__database__SSL_MODE` à partir des valeurs `DB_*` injectées (préfixées par le tenant), en journalisant une ligne `Gitea DB wired: …`.
4. Exécute le `/usr/bin/entrypoint` standard de Gitea, qui écrit toutes les variables d'environnement `GITEA__*` dans `app.ini` et lance le serveur sous s6.

```bash
# Confirm the DB wiring the entrypoint chose
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep "Gitea DB wired"
```

---

## 4. Initialisation de la base de données {#4-database-initialization}

Le job `db-init` par défaut (image `postgres:15-alpine`, `execute_on_apply = true`, jusqu'à 3 nouvelles tentatives) s'exécute à chaque apply et est idempotent :

1. Il attend que l'instance Cloud SQL accepte les connexions.
2. Il crée le rôle applicatif préfixé par le tenant s'il est absent (ou réinitialise son mot de passe), lui accorde `CREATEDB` et l'accorde à `postgres`.
3. Il crée la base Gitea dont ce rôle est propriétaire si elle est absente (ou corrige la propriété), puis accorde tous les privilèges.

Gitea exécute lui-même ses migrations de schéma automatiquement au démarrage, de sorte que les mises à niveau de version ne nécessitent aucune étape de migration manuelle.

```bash
gcloud run jobs executions list --job=<service-name>-db-init --project "$PROJECT" --region "$REGION"
```

---

## 5. Valeurs d'environnement de base {#5-core-environment-defaults}

- `GITEA__database__DB_TYPE = "postgres"` — le seul moteur pris en charge par cette couche.
- `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL` — issus de `public_domain` / `public_url` (ils déterminent les URL de clonage ; indiquez l'hôte réel en production).
- `GITEA__server__HTTP_PORT = 3000`, `GITEA__server__PROTOCOL = "http"` — TLS se termine à la périphérie de la plateforme.
- `GITEA__security__INSTALL_LOCK = "true"` — l'installateur web du premier lancement est ignoré ; la configuration est entièrement pilotée par l'environnement. Le premier utilisateur inscrit devient administrateur.
- `GITEA__service__DISABLE_REGISTRATION = "false"` — inscription en libre-service activée par défaut ; passez-la à `true` après avoir créé le compte administrateur sur les forges privées.
- `GITEA__server__APP_DATA_PATH = <nfs_mount_path>` — les dépôts, objets LFS et pièces jointes persistent sur le volume NFS partagé.

Les `environment_variables` fournies par l'utilisateur sont fusionnées par-dessus ces valeurs par défaut, de sorte que toute clé `GITEA__<section>__<KEY>` peut être surchargée par déploiement.

---

## 6. Stockage d'objets {#6-object-storage}

`Gitea_Common` ne déclare aucun bucket propre (l'output `storage_buckets` est vide) — les données durables de la forge résident sur le volume NFS via `APP_DATA_PATH`. Le socle de la variante de plateforme provisionne néanmoins un bucket GCS `data` à usage général et le bucket des sauvegardes automatisées :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~gitea"
```

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les deux sondes ciblent le point de terminaison de santé non authentifié de Gitea, `/api/healthz`, qui renvoie HTTP 200 dès que le serveur est opérationnel :

- **Sonde de démarrage** — HTTP `/api/healthz`, délai initial de 30 s (la variante de plateforme applique une période de 20 s et un seuil d'échec de 10).
- **Sonde de vivacité** — HTTP `/api/healthz`, délai initial de 15 s, période de 30 s, seuil d'échec de 3.

Gitea démarre rapidement (binaire Go unique), mais le premier démarrage exécute aussi les migrations de schéma sur une base fraîchement créée — le délai initial de 30 secondes en tient compte.

---

Pour la configuration de Gitea visible par l'utilisateur (variables par groupe, outputs et manière d'explorer chaque service depuis la console et la CLI), consultez le guide de la plateforme :
**[Gitea_CloudRun](Gitea_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Gitea sur Google Cloud Run](Gitea_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Gitea sur GKE Autopilot](Gitea_GKE.md) — cette configuration déployée sur GKE.
