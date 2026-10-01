---
title: "Homebox Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Homebox — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Homebox_Common.md @ 3055034 sha256:a977c2ceb892 -->

# Homebox Common — Configuration applicative partagée {#homebox-common--shared-application-configuration}

`Homebox_Common` est la **couche applicative partagée** de Homebox. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Homebox sur laquelle
reposent à la fois [Homebox_GKE](Homebox_GKE.md) et
[Homebox_CloudRun](Homebox_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Homebox, consultez les
guides de plateforme ([Homebox_GKE](Homebox_GKE.md), [Homebox_CloudRun](Homebox_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Homebox_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Référence directement l'image officielle `ghcr.io/sysadminsmedia/homebox` — aucun build personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** ; définit explicitement `HBOX_DATABASE_DRIVER=postgres` | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage objet | Déclare un bucket GCS `data` (photos et pièces jointes des objets) et le monte sur `/data` via `gcs_volumes` | Sortie `storage_buckets` |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/v1/status` | §Observabilité dans les guides de plateforme |
| Secrets | Génère `HBOX_AUTH_API_KEY_PEPPER`, un véritable secret que Homebox utilise comme poivre (pepper) pour le hachage des clés d'API | Sortie `secret_ids` |

---

## 2. Aucun identifiant administrateur par défaut — inscription libre {#2-no-default-admin-credential--open-self-registration}

`Homebox_Common` ne génère **aucun secret d'identifiant administrateur**.
Contrairement à certaines applications de ce catalogue qui codent en dur un
identifiant bien connu, Homebox utilise l'inscription libre : **la première
personne qui soumet le formulaire « Register » sur une instance neuve devient
l'utilisateur administrateur initial.** Ce module n'a rien à générer ni à injecter
pour amorcer un compte.

C'est un contraste significatif et positif — un déploiement Homebox neuf ne
présente aucun risque de sécurité lié à des identifiants par défaut. Le risque
pratique tient plutôt au timing : sur une instance accessible publiquement, la
personne qui s'inscrit *en premier* devient l'administrateur. Les opérateurs
doivent **effectuer l'inscription immédiatement après le premier déploiement**,
puis définir `HBOX_OPTIONS_ALLOW_REGISTRATION=false` (via les
`environment_variables` de l'Application Module) pour fermer les inscriptions
publiques. La section *Pièges de configuration* des guides de plateforme signale
ce point comme un élément de risque.

Le mot de passe de la base de données et le secret `HBOX_AUTH_API_KEY_PEPPER`
sont générés et gérés respectivement par le socle et par ce module —
consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity utilisé ailleurs dans le catalogue.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Homebox nécessite **PostgreSQL** ; le moteur est fixé et
`HBOX_DATABASE_DRIVER=postgres` est défini explicitement (sinon, Homebox utilise
par défaut SQLite intégré, dont le DSN par défaut impose `journal_mode=WAL` — ce
qui n'est pas sûr sur NFS/gcsfuse, la même catégorie de risque que
Karakeep/UptimeKuma dans ce catalogue). Au premier déploiement, un job ponctuel
(`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle de l'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec ce rôle comme
   propriétaire,
5. Accorde tous les privilèges sur la base de données,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

L'ORM Ent de Homebox applique ensuite automatiquement ses propres migrations
internes à chaque démarrage — aucun job de migration distinct ne s'exécute au
niveau de la plateforme.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Variables d'environnement Postgres distinctes, et non un DSN {#4-discrete-postgres-env-vars-not-a-dsn}

Homebox lit des variables d'environnement **distinctes** plutôt qu'une URL de
connexion combinée :

| Variable d'environnement Homebox | Alias de (standard de la plateforme) |
|---|---|
| `HBOX_DATABASE_HOST` | `DB_HOST` |
| `HBOX_DATABASE_USERNAME` | `DB_USER` |
| `HBOX_DATABASE_PASSWORD` | `DB_PASSWORD` |
| `HBOX_DATABASE_DATABASE` | `DB_NAME` |
| `HBOX_DATABASE_PORT` | `DB_PORT` |

Cet aliasing est configuré via les variables `db_host_env_var_name` /
`db_user_env_var_name` / `db_password_env_var_name` / `db_name_env_var_name` /
`db_port_env_var_name` du socle, définies au niveau de l'**Application
Module** (`Homebox_CloudRun`/`Homebox_GKE`), et non par cette couche Common.
Comme il s'agit de simples champs clé=valeur (et non d'une URL), **aucun encodage
d'URL n'est nécessaire** pour les caractères spéciaux du mot de passe, et **aucun
script de point d'entrée personnalisé** n'est requis — une simplification
significative par rapport aux applications qui construisent une chaîne DSN.

---

## 5. Image de conteneur {#5-container-image}

`Homebox_Common` définit directement
`container_image = "ghcr.io/sysadminsmedia/homebox"` et
`image_source = "prebuilt"` — pas de Dockerfile, pas d'étape Cloud Build. Homebox
publie un véritable tag `latest` (contrairement à plusieurs applications de ce
catalogue qui nécessitent de remapper `"latest"` vers une version de repli
épinglée), si bien que `application_version` est transmis tel quel comme tag de
l'image.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/v1/status` — le véritable point de terminaison
d'état de Homebox, non authentifié, confirmé par l'instruction `HEALTHCHECK` du
Dockerfile officiel lui-même (`wget ... http://localhost:7745/api/v1/status`).

- **Cloud Run et GKE** utilisent tous deux une sonde HTTP ciblant
  `/api/v1/status`, avec un délai initial de 30 secondes et un seuil d'échec
  généreux (30 pour le démarrage).

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket GCS `data` est déclaré ici et provisionné par le socle, pour le
stockage des photos et pièces jointes des objets, et ce module déclare également
une entrée `gcs_volumes` qui le monte (sous le nom
`gcs-<application_name><tenant-prefix>-data`) sur le chemin `/data` de Homebox —
si bien que les photos et pièces jointes téléversées persistent par défaut d'une
révision ou d'un redémarrage à l'autre. Une liste `gcs_volumes` fournie par
l'opérateur (au niveau de l'Application Module) a priorité sur l'entrée de ce
module lorsqu'elle n'est pas vide. Les *métadonnées* des objets (noms,
emplacements, quantités) ne sont pas concernées dans un cas comme dans l'autre —
elles sont stockées dans PostgreSQL.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
```

---

## 8. Secrets {#8-secrets}

`Homebox_Common` génère un seul véritable secret, toujours actif :

| Secret | Rôle |
|---|---|
| `HBOX_AUTH_API_KEY_PEPPER` | Valeur aléatoire de 32 caractères servant de poivre (pepper) au hachage des clés d'API de Homebox. Réellement lue par l'application à l'exécution. |

Contrairement à certains modules Common de ce catalogue qui génèrent un secret
ensuite ignoré par l'application en amont, celui-ci est réel et indispensable — il
est injecté comme variable d'environnement secrète et consommé directement par
Homebox.

---

Pour la configuration propre à Homebox destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Homebox_GKE](Homebox_GKE.md)** et
**[Homebox_CloudRun](Homebox_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Homebox sur Google Cloud Run](Homebox_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Homebox sur GKE Autopilot](Homebox_GKE.md) — cette configuration déployée sur GKE.
