---
title: "Metabase Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Metabase — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Metabase_Common.md @ 3055034 sha256:38ee3f33bbd8 -->

# Metabase Common — Configuration applicative partagée {#metabase-common--shared-application-configuration}

`Metabase_Common` est la **couche applicative partagée** de Metabase. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Metabase sur laquelle
s'appuient à la fois [Metabase_GKE](Metabase_GKE.md) et
[Metabase_CloudRun](Metabase_CloudRun.md), afin que les deux variantes de plateforme se
comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent
jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de
déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que
vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Metabase, consultez les
guides de plateforme ([Metabase_GKE](Metabase_GKE.md), [Metabase_CloudRun](Metabase_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Metabase_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle `metabase/metabase` et construit une couche Cloud Build personnalisée avec le point d'entrée de la plateforme | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la tâche `db-init` du premier déploiement qui crée la base de données et l'utilisateur | Sortie `initialization_jobs` |
| Variables d'environnement fixes | Définit `MB_JETTY_PORT = "3000"` et `JAVA_TIMEZONE = "UTC"` — elles ne doivent pas être remplacées | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage/de vivacité ciblant `/api/health`, avec des délais généreux adaptés à la JVM | §Observabilité dans les guides de plateforme |
| Stockage d'objets | Renvoie une liste de buckets de stockage vide — Metabase stocke tout son état dans PostgreSQL | Sortie `storage_buckets` (vide) |

---

## 2. Moteur de base de données et amorçage {#2-database-engine-and-bootstrap}

Metabase requiert **PostgreSQL 15** ; le moteur est fixé et MySQL n'est pas pris en
charge. Lors du premier déploiement, une tâche ponctuelle `db-init` s'exécute avant le
démarrage de la charge de travail Metabase. Elle utilise `postgres:15-alpine` et se
connecte à Cloud SQL via le socket Unix de l'Auth Proxy pour, de manière idempotente :

1. créer la base de données Metabase (si elle est absente),
2. créer l'utilisateur de l'application avec le mot de passe généré automatiquement,
3. accorder à cet utilisateur tous les privilèges sur cette base de données.

La tâche s'exécute avec `execute_on_apply = true` (elle s'exécute pendant `tofu apply`),
avec jusqu'à 3 nouvelles tentatives et un délai d'expiration de 600 secondes. Elle peut
être relancée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 3. Paramètres principaux de l'application {#3-core-application-settings}

`Metabase_Common` établit l'environnement Metabase de base afin que l'application
démarre correctement dès le premier lancement :

- **`MB_JETTY_PORT = "3000"`** — le serveur Jetty intégré de Metabase doit écouter sur
  le port 3000. Cette valeur est fixée pour correspondre à `container_port = 3000`. La
  remplacer via `environment_variables` dans le module de plateforme casse tout le
  routage et les contrôles de santé.
- **`JAVA_TIMEZONE = "UTC"`** — le fuseau horaire de la JVM est fixé à UTC afin de
  garantir un traitement cohérent des horodatages dans les tableaux de bord, les
  questions planifiées et les exports de rapports. Le remplacer fait diverger le
  filtrage par date et la planification de Metabase du fuseau horaire de la base de
  données.
- Les variables d'environnement supplémentaires fournies via `environment_variables`
  dans le module de plateforme sont fusionnées au moment du déploiement. Utilisez-les
  pour des paramètres Metabase tels que `MB_EMBEDDING_ENABLED`, `MB_SITE_URL` ou les
  options de tas Java.

---

## 4. Comportement des sondes de santé {#4-health-probe-behaviour}

Les sondes de démarrage et de vivacité ciblent toutes deux `/api/health` en HTTP. Ce
point de terminaison ne renvoie HTTP 200 qu'une fois la JVM complètement initialisée et
connectée à PostgreSQL. Des délais initiaux généreux sont nécessaires, car la JVM de
Metabase met 60 à 120 secondes à démarrer :

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec | Tolérance totale |
|---|---|---|---|---|---|---|
| Démarrage | HTTP | `/api/health` | 120s | 10s | 15 | ~270s |
| Vivacité | HTTP | `/api/health` | 120s | 30s | 3 | — |
| Disponibilité | HTTP | `/api/health` | 60s | 15s | 3 | — |

Les variantes GKE et Cloud Run utilisent toutes deux des sondes HTTP — les contrôles de
santé de Cloud Run atteignent directement le conteneur Metabase en HTTP/2 et ne
rencontrent pas le comportement de redirection qui impose un contournement par sonde
TCP dans les applications basées sur Apache.

Inspectez les événements des sondes sur GKE :
```bash
kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
```

---

## 5. Aucun secret applicatif {#5-no-application-secrets}

Contrairement à certains autres modules applicatifs, `Metabase_Common` ne génère aucun
mot de passe administrateur au niveau de l'application. Metabase gère sa propre clé de
chiffrement interne et les identifiants des utilisateurs via son assistant de
configuration au premier démarrage. Le seul secret dont s'occupe cette couche est le
**mot de passe de la base de données**, qui est généré et géré par le module socle.

Récupérez le nom du secret du mot de passe de la base de données dans la sortie
`database_password_secret` du déploiement de plateforme, puis accédez-y avec :

```bash
gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
```

---

## 6. Stockage d'objets {#6-object-storage}

`Metabase_Common` renvoie une liste de buckets de stockage vide. Metabase stocke tout
l'état de l'application — questions, tableaux de bord, collections, utilisateurs,
autorisations — dans PostgreSQL. Aucun bucket GCS n'est provisionné par défaut.

Si votre déploiement nécessite un stockage d'objets (par exemple pour configurer le
stockage compatible S3 de Metabase Enterprise Edition pour la mise en cache des
résultats de requêtes, ou pour stocker des artefacts de plugins personnalisés), ajoutez
des buckets via la variable `storage_buckets` du module de plateforme
(`Metabase_CloudRun` ou `Metabase_GKE`) :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 7. Scripts {#7-scripts}

Le répertoire `scripts/` de `Metabase_Common` contient :

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Image Metabase personnalisée qui étend `metabase/metabase` avec le script de point d'entrée de la plateforme. |
| `entrypoint.sh` | Point d'entrée de la plateforme qui injecte les détails de connexion du Cloud-SQL-Proxy avant de passer la main au processus Metabase. |
| `db-init.sh` | Script idempotent de configuration de PostgreSQL — crée la base de données et l'utilisateur de l'application et accorde les privilèges. Exécuté avec `postgres:15-alpine`. |

---

Pour la configuration propre à Metabase destinée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Metabase_GKE](Metabase_GKE.md)** et
**[Metabase_CloudRun](Metabase_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Metabase sur Google Cloud Run](Metabase_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Metabase sur GKE Autopilot](Metabase_GKE.md) — cette configuration déployée sur GKE.
