---
title: "Temporal Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Temporal — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Temporal_Common.md @ 3055034 sha256:27a3b885ad01 -->

# Temporal Common — Configuration applicative partagée {#temporal-common--shared-application-configuration}

`Temporal_Common` est la **couche partagée de provisionnement de base de données** de Temporal. Elle
n'est pas déployée seule ; elle fournit plutôt les ressources Cloud SQL et les identifiants de base de données
propres à Temporal sur lesquels s'appuie [Temporal_GKE](Temporal_GKE.md),
de sorte que le déploiement du serveur dispose toujours de bases de données correctement nommées et d'un secret de mot de passe
cohérent. Les utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les noms de base de données et de secret
que vous voyez dans les sorties de la plateforme.

Pour l'infrastructure qui exécute réellement Temporal, consultez le guide de la plateforme
([Temporal_GKE](Temporal_GKE.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **GKE uniquement.** Il n'existe pas de variante `Temporal_CloudRun`. L'architecture de Temporal fondée sur gRPC
> et son modèle d'exécution de workflows de longue durée ne sont pas compatibles avec le modèle sans état
> et limité à la requête de Cloud Run.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Temporal_Common | Où cela apparaît |
|---|---|---|
| Identifiant de base de données | Génère le mot de passe PostgreSQL de Temporal et le stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Base de données de persistance principale | Crée la base de données Cloud SQL qui stocke l'état des workflows, les files de tâches, les métadonnées des namespaces, les minuteurs et les enregistrements d'activités | Sortie `temporal_db_name` |
| Base de données de visibilité | Crée la base de données Cloud SQL utilisée pour la recherche et le filtrage des workflows | Sortie `temporal_visibility_db_name` |
| Utilisateur PostgreSQL | Crée l'utilisateur de base de données partagé (les deux bases partagent un seul utilisateur) | Sortie `temporal_db_user` |
| Injection de secrets | Expose `secret_ids = { POSTGRES_PWD = <secret-id> }`, utilisé par le pod du serveur Temporal | Injecté à l'exécution via le pilote Secret Store CSI |
| Buckets de stockage | Vide — Temporal ne nécessite aucun bucket Cloud Storage | La sortie `storage_buckets` vaut toujours `[]` |

---

## 2. Identifiant de base de données dans Secret Manager {#2-database-credential-in-secret-manager}

Le mot de passe de la base de données Temporal est généré automatiquement (32 caractères
alphanumériques) et stocké sous forme de secret Secret Manager. Il n'est jamais défini en clair.
Récupérez-le après le déploiement :

```bash
# The secret follows the deployment resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~temporal-db-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le nom du secret est indiqué dans les sorties du déploiement de la plateforme sous
`temporal_db_password_secret_id`. Consultez [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Temporal exige **PostgreSQL** ; MySQL n'est pas pris en charge. `Temporal_Common` cible
l'instance Cloud SQL for PostgreSQL gérée par Services_GCP (découverte par libellé d'instance
ou par un nom explicite de remplacement). À chaque déploiement, il effectue de manière idempotente les opérations suivantes :

1. Crée l'utilisateur PostgreSQL (partagé par les deux bases de données).
2. Crée la base de données de persistance principale.
3. Crée la base de données de visibilité (nommée `<prefix>_visibility`).

Une attente de 30 secondes garantit que la réplication globale de Secret Manager est terminée avant la résolution
des sorties du déploiement.

L'image `temporalio/auto-setup` exécute ensuite automatiquement toutes les migrations de schéma PostgreSQL
au premier démarrage — aucun job distinct d'initialisation du schéma n'est nécessaire.

Inspectez directement les bases de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
# List databases:
\l
# Inspect the Temporal schema:
\c <db-name>
\dt
```

Le nom de l'instance, les noms des bases de données et l'utilisateur figurent tous dans les sorties du déploiement
de la plateforme.

---

## 4. Paramètres essentiels de la base de données {#4-core-database-settings}

`Temporal_Common` met en place la topologie de base de données afin que le serveur se connecte correctement
dès le premier démarrage :

- **Deux bases de données.** La base de persistance principale contient tout l'état d'exécution des
  workflows. La base de visibilité stocke les enregistrements des exécutions en cours pour la recherche et le
  filtrage. Les deux partagent un seul utilisateur PostgreSQL par souci de simplicité.
- **Noms générés automatiquement.** Lorsque `temporal_database_name` et
  `temporal_visibility_database_name` sont laissés vides dans `Temporal_GKE`, les noms sont
  dérivés du préfixe de ressources du déploiement selon la convention de nommage `app<name><tenant><id>`,
  les traits d'union étant remplacés par des tirets bas (obligatoire pour obtenir des identifiants
  PostgreSQL valides). Cela évite les collisions lorsque plusieurs déploiements Temporal
  partagent une instance Cloud SQL.
- **Connexion directe par IP privée.** Temporal se connecte à Cloud SQL via l'IP privée
  — sans sidecar Auth Proxy. TLS est exigé par Cloud SQL et activé automatiquement dans la
  configuration du serveur.

---

## 5. Comportement du magasin de visibilité {#5-visibility-store-behaviour}

Le magasin de visibilité standard (PostgreSQL) permet un filtrage de base des workflows par
type de workflow, statut, heure de début/de fin et ID de workflow. Lorsque
`enable_elasticsearch = true` est défini dans `Temporal_GKE`, Elasticsearch prend le relais en tant que
magasin de visibilité avancé, ajoutant la recherche plein texte et les attributs de recherche personnalisés.
La base de visibilité PostgreSQL continue d'exister dans Cloud SQL mais n'est pas utilisée par
Temporal lorsque Elasticsearch est actif.

---

## 6. Scripts {#6-scripts}

`Temporal_Common` fournit un répertoire `scripts/` contenant un seul fichier :

| Fichier | Rôle |
|---|---|
| `schema-init.sh` | Utilise `temporal-sql-tool` de `ghcr.io/temporalio/admin-tools` pour initialiser manuellement les deux schémas. Conservé pour les cas d'usage où une gestion externe du schéma est préférée. Il n'est relié à aucune entrée `initialization_jobs` dans le déploiement par défaut (`Temporal_GKE` définit `initialization_jobs = []`) — `temporalio/auto-setup` gère automatiquement l'initialisation du schéma au premier démarrage. |

`Temporal_GKE` (le module de plateforme, et non `Temporal_Common`) embarque séparément son
propre `scripts/temporal-db-init.sh`, qui accorde `CREATEDB` au rôle PostgreSQL de Temporal
et précrée les deux bases de données pour faciliter l'initialisation de
`temporal-sql-tool`. Il n'est **actuellement relié à aucun Job** lui non plus — avec
`initialization_jobs = []`, l'utilisateur et les deux bases de données sont plutôt
créés directement par les ressources `google_sql_user`/`google_sql_database` propres à `Temporal_Common`
(§3), qui n'ont besoin d'aucun octroi `CREATEDB` puisque Terraform les provisionne
via la Cloud SQL Admin API au lieu de se connecter avec le rôle de l'application.

---

Pour la configuration propre à Temporal destinée aux utilisateurs (variables par groupe, sorties
et manière d'explorer chaque service depuis la console et la CLI), consultez le guide de la plateforme :
**[Temporal_GKE](Temporal_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Temporal sur GKE Autopilot](Temporal_GKE.md) — cette configuration déployée sur GKE.
