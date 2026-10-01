---
title: "Mealie Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Mealie — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Mealie_Common.md @ 3055034 sha256:654cfa1022a1 -->

# Mealie Common — Configuration applicative partagée {#mealie-common--shared-application-configuration}

`Mealie_Common` est la **couche applicative partagée** de Mealie. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration propre à Mealie sur laquelle
s'appuient à la fois [Mealie_GKE](Mealie_GKE.md) et
[Mealie_CloudRun](Mealie_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Mealie, consultez les
guides des plateformes ([Mealie_GKE](Mealie_GKE.md), [Mealie_CloudRun](Mealie_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Mealie_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Référence directement l'image officielle `ghcr.io/mealie-recipes/mealie` — aucun build personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** ; définit explicitement `DB_ENGINE=postgres` | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les octrois | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket GCS `data` (images des recettes) et le monte sur `/app/data` via `gcs_volumes` | Sortie `storage_buckets` |
| Contrôles de santé | Fournit la sonde de démarrage/d'activité par défaut ciblant `/api/app/about` | §Observabilité dans les guides des plateformes |

---

## 2. Aucun secret propre à l'application — et l'identifiant administrateur initial fixe {#2-no-app-specific-secrets--and-the-fixed-initial-admin-credential}

`Mealie_Common` ne génère aucun secret Secret Manager qui lui soit propre. Mealie
n'a **aucun identifiant administrateur initial configurable par variable
d'environnement** : depuis Mealie v3.x, les paramètres qui pouvaient autrefois
être remplacés (`DEFAULT_EMAIL`/`DEFAULT_PASSWORD`) sont désormais des champs
pydantic-settings privés, préfixés d'un tiret bas
(`_DEFAULT_EMAIL`/`_DEFAULT_PASSWORD`), sans aucune liaison à l'environnement —
la docstring du code source amont indique elle-même « it should no longer be set
by end users ». Une révision antérieure de ce module générait et injectait un
secret `DEFAULT_PASSWORD` en s'attendant à ce qu'il initialise le compte
administrateur ; il a été vérifié en conditions réelles que Mealie l'ignore
silencieusement, et ce mécanisme a donc été supprimé.

**Chaque nouveau déploiement de Mealie initialise toujours le même compte initial
bien connu : `changeme@example.com` / `MyPassword`.** Mealie impose une
réinitialisation du mot de passe à la première connexion, ce qui constitue la
véritable barrière de sécurité — les opérateurs **doivent se connecter
immédiatement après le premier déploiement et modifier à la fois le mot de passe
et (recommandé) l'adresse e-mail de l'administrateur**, car l'identifiant initial
est documenté publiquement en amont et n'est pas un secret généré. Consultez la
section *Pièges de configuration* des guides des plateformes, où ce point est
signalé comme un risque critique.

Le mot de passe de la base de données est généré et géré séparément par le
socle. Voir [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity utilisé ailleurs dans le catalogue.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Mealie requiert **PostgreSQL** ; le moteur est fixé et `DB_ENGINE=postgres` est
défini explicitement (sinon, Mealie utilise par défaut SQLite embarqué). Au premier
déploiement, un job ponctuel (`db-init`) s'exécute avec `postgres:15-alpine`
et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec ce rôle comme propriétaire,
5. Accorde tous les privilèges sur la base de données,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Mealie applique ensuite automatiquement ses propres migrations internes à chaque
démarrage — aucun job de migration distinct ne s'exécute au niveau de la
plateforme.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Variables d'environnement Postgres distinctes, et non un DSN {#4-discrete-postgres-env-vars-not-a-dsn}

Contrairement à de nombreuses applications Go/GORM de ce catalogue, Mealie lit
des variables d'environnement **distinctes** plutôt qu'une URL de connexion
combinée ou une chaîne GORM key=value :

| Variable d'environnement Mealie | Alias de (standard de la plateforme) |
|---|---|
| `POSTGRES_SERVER` | `DB_HOST` |
| `POSTGRES_USER` | `DB_USER` |
| `POSTGRES_PASSWORD` | `DB_PASSWORD` |
| `POSTGRES_DB` | `DB_NAME` |
| `POSTGRES_PORT` | `DB_PORT` |

Cet aliasing est configuré via les variables du socle `db_host_env_var_name` /
`db_user_env_var_name` / `db_password_env_var_name` / `db_name_env_var_name` /
`db_port_env_var_name`, définies au niveau du **module applicatif**
(`Mealie_CloudRun`/`Mealie_GKE`), et non par cette couche Common. Comme il s'agit
de simples champs key=value (et non d'une URL), **aucun encodage d'URL n'est
nécessaire** pour les caractères spéciaux du mot de passe, et **aucun script de
point d'entrée personnalisé** n'est requis — une simplification notable par
rapport aux applications qui construisent une chaîne DSN.

---

## 5. Image de conteneur {#5-container-image}

`Mealie_Common` définit directement `container_image = "ghcr.io/mealie-recipes/mealie"`
et `image_source = "prebuilt"` — pas de Dockerfile, pas d'étape Cloud Build.
Mealie publie un véritable tag `latest` (contrairement à plusieurs applications de
ce catalogue qui nécessitent de réassocier `"latest"` à une version de repli
épinglée) ; `application_version` est donc transmis tel quel comme tag d'image.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/app/about` — le véritable point de terminaison
d'information non authentifié de Mealie, qui ne répond qu'une fois le serveur
entièrement initialisé.

- **Cloud Run et GKE** utilisent tous deux une sonde HTTP ciblant
  `/api/app/about`, avec un délai initial de 30 secondes et un seuil d'échec
  généreux (30 pour le démarrage).

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket GCS `data` est déclaré ici et provisionné par le socle pour le stockage
des images des recettes, et ce module déclare également une entrée `gcs_volumes`
qui le monte (sous le nom `gcs-<application_name><tenant-prefix>-data`) sur le
chemin `/app/data` de Mealie — de sorte que les images de recettes téléversées
persistent par défaut d'une révision ou d'un redémarrage à l'autre. Une liste
`gcs_volumes` fournie par l'opérateur (au niveau du module applicatif) est
prioritaire lorsqu'elle n'est pas vide. Les données *textuelles* des recettes ne
sont pas concernées dans un cas comme dans l'autre — elles sont stockées dans
PostgreSQL.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
```

---

Pour la configuration propre à Mealie destinée aux utilisateurs (variables par
groupe, sorties et façon d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Mealie_GKE](Mealie_GKE.md)** et
**[Mealie_CloudRun](Mealie_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Mealie sur Google Cloud Run](Mealie_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Mealie sur GKE Autopilot](Mealie_GKE.md) — cette configuration déployée sur GKE.
