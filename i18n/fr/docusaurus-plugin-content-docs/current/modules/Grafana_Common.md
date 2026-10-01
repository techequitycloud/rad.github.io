---
title: "Grafana Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Grafana — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Grafana_Common.md @ 3055034 sha256:90b91c416d7f -->

# Grafana Common — Configuration applicative partagée {#grafana-common--shared-application-configuration}

`Grafana_Common` est la **couche applicative partagée** de Grafana. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Grafana sur laquelle
s'appuient [Grafana_GKE](Grafana_GKE.md) et [Grafana_CloudRun](Grafana_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Grafana, consultez les
guides des plateformes ([Grafana_GKE](Grafana_GKE.md), [Grafana_CloudRun](Grafana_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Grafana_Common | Où cela apparaît |
|---|---|---|
| Image du conteneur | Épingle l'image de base officielle `grafana/grafana` et le contexte Cloud Build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme moteur obligatoire | §Base de données dans les guides des plateformes |
| Stockage objet | Déclare le bucket **Cloud Storage** `grafana-data` | Sortie `storage_buckets` |
| Paramètres principaux | Définit `container_port = 3000`, `cloudsql_volume_mount_path = /cloudsql` et le point d'entrée qui traduit les variables `DB_*` du socle en variables `GF_DATABASE_*` de Grafana | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les valeurs par défaut des sondes de démarrage, de vivacité et de disponibilité ciblant `/api/health` | §Observabilité dans les guides des plateformes |
| Aucun secret généré automatiquement | Renvoie `secret_ids = {}` — le mot de passe administrateur de Grafana n'est pas généré automatiquement ; il doit être injecté via `secret_environment_variables` | §Comportement de l'application dans les guides des plateformes |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Contrairement à d'autres modules applicatifs, `Grafana_Common` ne génère PAS
automatiquement de mot de passe administrateur Grafana. Grafana est livré avec les
identifiants par défaut `admin`/`admin`. Avant le premier déploiement, créez un secret
Secret Manager et injectez-le :

```bash
gcloud secrets create grafana-admin-password \
  --replication-policy="automatic" --project "$PROJECT"
printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
  --data-file=- --project "$PROJECT"
```

Configurez ensuite le déploiement avec :
`secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }`

Récupérez à tout moment le mot de passe administrateur actuel :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin"
gcloud secrets versions access latest --secret=grafana-admin-password --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré par le socle ; le nom de son
secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Grafana nécessite **PostgreSQL 15** ; le moteur est fixe et aucune alternative n'est
prise en charge. Contrairement à des applications comme Mautic, Grafana ne nécessite
PAS de job d'initialisation de la base de données distinct. Grafana se connecte à
l'instance PostgreSQL provisionnée au premier démarrage, puis crée et migre
automatiquement son schéma.

Le script de point d'entrée personnalisé (`entrypoint.sh`) traduit les variables
d'environnement génériques `DB_*` du socle au format `GF_DATABASE_*` de Grafana au
démarrage du conteneur. Il gère aussi de manière transparente le chemin du socket du
Cloud SQL Auth Proxy : lorsque le socket du proxy est détecté, le point d'entrée
résout l'hôte de la base de données vers l'IP privée en TCP, afin que le pilote
PostgreSQL de Grafana (qui ne sait pas analyser les chemins de socket Unix) puisse se
connecter correctement.

Inspectez directement la base de données après le déploiement :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Grafana_Common` établit l'environnement Grafana de base pour que l'application
démarre correctement dès le premier lancement :

- **Port du conteneur** — `3000` est le port HTTP natif de Grafana ; aucun ajustement
  de redirection ou de proxy n'est nécessaire.
- **Type de base de données** — le `grafana.tf` parent injecte
  `GF_DATABASE_TYPE=postgres` dans l'environnement fusionné. C'est obligatoire — sans
  lui, Grafana revient à SQLite même lorsque toutes les autres variables
  `GF_DATABASE_*` sont présentes.
- **Socket de l'Auth Proxy** — `enable_cloudsql_volume = true` par défaut ; le sidecar
  du proxy monte son socket Unix sur `/cloudsql`. Le point d'entrée détecte le chemin
  du socket et se rabat sur l'IP privée Cloud SQL en TCP afin que le pilote de Grafana
  puisse analyser correctement l'hôte.
- **Mode SSL** — défini sur `disable` lors d'une connexion via l'Auth Proxy (qui gère
  le chiffrement au niveau du proxy) et sur `require` lors d'une connexion directe via
  l'IP privée.
- **Image personnalisée** — Cloud Build compile une image personnalisée à partir du
  Dockerfile situé dans `scripts/`, qui étend `grafana/grafana:<version>` avec bash,
  curl, jq et le point d'entrée de traduction.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les trois sondes ciblent `/api/health` — le point de terminaison de santé dédié de
Grafana, qui renvoie HTTP 200 lorsque l'application et sa connexion à la base de
données sont opérationnelles :

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/api/health` | 30s | 10s | 12 (tolérance totale : ~150s) |
| Vivacité | HTTP | `/api/health` | 60s | 30s | 3 |
| Disponibilité | HTTP | `/api/health` | 15s | 10s | 3 |

La tolérance généreuse au démarrage laisse le temps à la migration du schéma lors du
premier démarrage de Grafana, qui s'exécute de manière synchrone avant que le serveur
commence à accepter des requêtes.

Contrairement à certaines applications PHP, Grafana n'effectue pas de redirection
HTTP→HTTPS sur les chemins de contrôle de santé ; les sondes HTTP fonctionnent donc
sans modification sur les variantes GKE et Cloud Run.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié `grafana-data` est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail. Ce
bucket peut servir au stockage des plugins, aux exports de tableaux de bord et aux
sauvegardes. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Des buckets supplémentaires et des montages de volumes GCS Fuse (pour un accès direct
aux objets GCS depuis le système de fichiers du conteneur) peuvent être déclarés dans
le module de la plateforme via `storage_buckets` et `gcs_volumes`.

---

Pour la configuration propre à Grafana destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Grafana_GKE](Grafana_GKE.md)** et
**[Grafana_CloudRun](Grafana_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Grafana sur Google Cloud Run](Grafana_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Grafana sur GKE Autopilot](Grafana_GKE.md) — cette configuration déployée sur GKE.
