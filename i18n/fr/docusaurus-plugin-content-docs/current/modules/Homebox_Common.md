---
title: "Homebox Common \u2014 Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Homebox — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Homebox_Common.md @ 15fd4c7 sha256:11fb38772947 -->

# Homebox Common — Configuration d'application partagée {#homebox-common--shared-application-configuration}

`Homebox_Common` est la **couche d'application partagée** pour Homebox. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Homebox
sur laquelle s'appuient [Homebox_GKE](Homebox_GKE.md) et [Homebox_CloudRun](Homebox_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte.
Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Homebox, consultez les
guides de la plateforme ([Homebox_GKE](Homebox_GKE.md), [Homebox_CloudRun](Homebox_CloudRun.md))
et les guides de la fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Homebox_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Référence directement l'image officielle `ghcr.io/sysadminsmedia/homebox` — pas de build personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** ; définit `HBOX_DATABASE_DRIVER=postgres` explicitement | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket GCS `data` (photos/pièces jointes d'articles) et le monte à `/data` via `gcs_volumes` | Sortie `storage_buckets` |
| Sondes de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/v1/status` | §Observabilité dans les guides de la plateforme |
| Secrets | Génère `HBOX_AUTH_API_KEY_PEPPER`, un vrai secret que Homebox utilise pour saler le hachage des clés API | Sortie `secret_ids` |

---

## 2. Pas de credential admin par défaut — auto-enregistrement ouvert {#2-no-default-admin-credential--open-self-registration}

`Homebox_Common` ne génère **aucun secret de credential admin**. Contrairement à certaines applications
de ce catalogue qui codent en dur un credential bien connu, Homebox utilise l'auto-enregistrement ouvert : **la première personne à soumettre le formulaire "Register" sur une
instance fraîche devient l'utilisateur admin initial.** Il n'y a rien pour ce
module à générer ou à injecter pour amorcer un compte.

C'est un contraste significatif et positif — il n'y a pas de risque de sécurité lié aux credentials par défaut
sur un nouveau déploiement Homebox. Le risque pratique est plutôt lié au timing : sur une instance accessible publiquement,
celui qui s'enregistre *en premier* devient l'admin. Les opérateurs doivent **compléter l'enregistrement immédiatement après le premier
déploiement**, puis définir `HBOX_OPTIONS_ALLOW_REGISTRATION=false` (via le
`environment_variables` du module d'application) pour fermer les inscriptions publiques. Voir
la section *Pièges de configuration* des guides de la plateforme pour cet élément de risque.

Le mot de passe de la base de données et le secret `HBOX_AUTH_API_KEY_PEPPER` sont
générés et gérés respectivement par la fondation et ce module — voir
[App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity
utilisés ailleurs dans le catalogue.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Homebox nécessite **PostgreSQL** ; le moteur est fixe et
`HBOX_DATABASE_DRIVER=postgres` est défini explicitement (Homebox utilise par défaut
SQLite embarqué, dont le DSN par défaut force `journal_mode=WAL` —
dangereux sur NFS/gcsfuse, la même classe de risque que Karakeep/UptimeKuma dans ce
catalogue). Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute en utilisant
`postgres:15-alpine` et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit accessible,
3. Crée (ou met à jour) le rôle d'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données d'application avec ce rôle comme propriétaire,
5. Accorde tous les privilèges sur la base de données,
6. Signale au proxy d'authentification Cloud SQL de s'arrêter gracieusement.

L'ORM Ent de Homebox applique ensuite ses propres migrations internes automatiquement à
chaque démarrage — aucun job de migration séparé ne s'exécute au niveau de la plateforme.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Variables d'environnement Postgres discrètes, pas un DSN {#4-discrete-postgres-env-vars-not-a-dsn}

Homebox lit des variables d'environnement **discrètes** plutôt qu'une URL de connexion combinée :

| Variable d'environnement Homebox | Alias de (standard de la plateforme) |
|---|---|
| `HBOX_DATABASE_HOST` | `DB_HOST` |
| `HBOX_DATABASE_USERNAME` | `DB_USER` |
| `HBOX_DATABASE_PASSWORD` | `DB_PASSWORD` |
| `HBOX_DATABASE_DATABASE` | `DB_NAME` |
| `HBOX_DATABASE_PORT` | `DB_PORT` |

Cet alias est configuré via les variables `db_host_env_var_name` /
`db_user_env_var_name` / `db_password_env_var_name` / `db_name_env_var_name` /
`db_port_env_var_name` de la Fondation, définies au niveau du **Module d'application**
(`Homebox_CloudRun`/`Homebox_GKE`), et non par cette couche Common. Comme ce sont
des champs clé=valeur simples (pas une URL), **aucun encodage d'URL n'est nécessaire** pour
les caractères spéciaux dans le mot de passe, et **aucun script de point d'entrée personnalisé** n'est
requis — une simplification significative par rapport aux applications qui construisent une chaîne DSN.

---

## 5. Image de conteneur {#5-container-image}

`Homebox_Common` définit `container_image = "ghcr.io/sysadminsmedia/homebox"` et
`image_source = "prebuilt"` directement — pas de Dockerfile, pas d'étape Cloud Build.
Homebox publie une véritable balise `latest` (contrairement à plusieurs applications de ce catalogue
qui nécessitent de remapper `"latest"` à un fallback épinglé), donc `application_version`
passe directement comme balise d'image.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/v1/status` — le véritable point de terminaison de statut non authentifié de Homebox,
confirmé par l'instruction `HEALTHCHECK` du Dockerfile officiel (`wget ... http://localhost:7745/api/v1/status`).

- **Cloud Run et GKE** utilisent tous deux une sonde HTTP ciblant `/api/v1/status` avec
  un délai initial de 30 secondes et un seuil d'échec généreux (30 pour le démarrage).

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket GCS `data` est déclaré ici et provisionné par la fondation, pour
le stockage des photos et pièces jointes d'articles, et ce module déclare également une
entrée `gcs_volumes` qui le monte (en tant que `gcs-<application_name><tenant-prefix>-data`)
au chemin `/data` de Homebox — ainsi les photos et pièces jointes d'articles téléchargées persistent
par défaut à travers les révisions/redémarrages. `enable_gcs_storage_volume = false` supprime
ce montage ; `Homebox_GKE` le définit chaque fois que `stateful_pvc_enabled = true`, car
un PVC monté au même chemin `/data` entrerait en collision avec lui. Une liste `gcs_volumes` fournie par l'opérateur
(au niveau du module d'application) a la priorité sur l'entrée de ce module
lorsqu'elle n'est pas vide. Les *métadonnées* des articles (noms, emplacements, quantités) ne sont
pas affectées de toute façon — elles sont stockées dans PostgreSQL.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
```

---

## 8. Secrets {#8-secrets}

`Homebox_Common` génère un secret réel, toujours actif :

| Secret | But |
|---|---|
| `HBOX_AUTH_API_KEY_PEPPER` | Une valeur aléatoire de 32 caractères qui sale le hachage des clés API de Homebox. Réellement lue par l'application au moment de l'exécution. |

Contrairement à certains modules Common de ce catalogue qui génèrent un secret qu'une
application en amont ignore ensuite, celui-ci est réel et porteur de charge — il est
injecté comme variable d'environnement secrète et consommé directement par Homebox.

---

Pour la configuration spécifique à Homebox, orientée utilisateur (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et la CLI), consultez les
guides de la plateforme : **[Homebox_GKE](Homebox_GKE.md)** et
**[Homebox_CloudRun](Homebox_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Homebox sur Google Cloud Run](Homebox_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Homebox sur GKE Autopilot](Homebox_GKE.md) — cette configuration déployée sur GKE.
