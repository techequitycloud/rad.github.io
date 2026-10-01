---
title: "Coder Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Coder — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Coder_Common.md @ 3055034 sha256:a4e54158b142 -->

# Coder Common — Configuration applicative partagée {#coder-common--shared-application-configuration}

`Coder_Common` est la **couche applicative partagée** de Coder. Elle n'est pas déployée seule ; elle fournit la configuration propre à Coder sur laquelle s'appuient [Coder_GKE](Coder_GKE.md) et [Coder_CloudRun](Coder_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Coder, consultez les guides des plateformes ([Coder_GKE](Coder_GKE.md), [Coder_CloudRun](Coder_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Coder_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Construit une fine surcouche personnalisée FROM `ghcr.io/coder/coder:<version>` via Cloud Build (image de base mise en miroir dans Artifact Registry) | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Installe `cloud-entrypoint.sh`, qui assemble `CODER_PG_CONNECTION_URL` à partir des variables d'environnement `DB_*` du socle et définit `CODER_ACCESS_URL` avant d'exécuter `coder server` | Comportement de l'application dans les guides des plateformes |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (Coder exige PostgreSQL 13+) | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la tâche `db-init` qui crée la base de données vide et le rôle propriétaire — Coder exécute ses propres migrations de schéma au démarrage | Sortie `initialization_jobs` |
| Secrets | **Aucun** — Coder génère lui-même ses clés de signature et les conserve dans PostgreSQL ; la sortie `secret_ids` est vide | Secret Manager ne contient que le mot de passe de la base de données géré par le socle |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Variables d'environnement de base | `CODER_HTTP_ADDRESS=0.0.0.0:3000`, `CODER_TELEMETRY_ENABLE=false`, `CODER_VERBOSE=false` | Environnement du conteneur en cours d'exécution |
| Contrôles de santé | Valeurs par défaut des sondes de démarrage (`/healthz`, délai de 60s, 30 échecs) et de vivacité (`/healthz`, délai de 60s) | §Observabilité dans les guides des plateformes |
| Sonde de disponibilité | HTTP `/healthz`, délai initial de 30s, période de 10s, 3 échecs | Appliquée au conteneur en cours d'exécution |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

`Coder_Common` construit une fine surcouche au-dessus de l'image en amont du plan de contrôle Coder. Le Dockerfile utilise un **ARG de build propre à l'application** (`CODER_VERSION`) plutôt que l'`APP_VERSION` générique — le socle injecte `APP_VERSION` dans chaque build et écraserait sinon le tag par `latest`, que les tags GHCR de Coder préfixés selon semver ne fournissent pas. Lorsque `application_version == "latest"`, le module épingle `v2.24.1`.

Le script `cloud-entrypoint.sh` (sh POSIX, installé dans `/usr/local/bin/cloud-entrypoint.sh`, exécuté en tant qu'utilisateur non root `coder`) effectue les actions suivantes à chaque démarrage du conteneur :

1. **Assemblage de l'URL de connexion.** Coder lit une seule variable, `CODER_PG_CONNECTION_URL`, analysée comme une URL `postgres://` — le chemin du socket Unix Cloud SQL ne peut pas figurer dans la partie autorité de l'URL (ses deux-points cassent l'analyse). Sur **Cloud Run**, où `DB_HOST` est le répertoire du socket, le script privilégie `DB_IP` (l'IP privée de l'instance) en TCP avec `sslmode=require` (Cloud SQL rejette le TCP non chiffré par IP privée). Sur **GKE**, `DB_HOST` est le side-car cloud-sql-proxy `127.0.0.1`, d'où `sslmode=disable` (le TLS est déjà terminé par le proxy).
2. **Encodage du mot de passe.** Le mot de passe de la base de données est encodé en pourcentage selon la RFC 3986 avant d'être placé dans la partie userinfo de l'URL, afin que les mots de passe générés contenant `%`, `@` ou `:` ne cassent jamais l'analyse de l'URL.
3. **URL d'accès.** Exporte `CODER_ACCESS_URL` à partir de `CLOUDRUN_SERVICE_URL` (ou `GKE_SERVICE_URL`) injecté. Coder construit à partir de cette valeur les URL de connexion des espaces de travail et des agents ainsi que les URI de redirection OAuth.
4. **Lancement.** Exécute `coder server` (`CMD ["/opt/coder", "server"]`). Coder exécute ses propres migrations de schéma au démarrage — il n'existe pas d'étape de migration distincte.

Les variables d'environnement `CODER_PG_CONNECTION_URL` ou `CODER_ACCESS_URL` fournies explicitement ont toujours la priorité. Pour examiner ce que le point d'entrée a résolu :

```bash
# Cloud Run — the entrypoint logs its resolved config at startup
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep "cloud-entrypoint"

# GKE — check the Coder pod startup output
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "cloud-entrypoint|Started HTTP listener"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Coder exige **PostgreSQL 13+** ; le moteur est fixé à `POSTGRES_15` dans `Coder_Common` et MySQL est rejeté par la validation au moment du plan de la variante de plateforme. Lors du déploiement, une tâche ponctuelle `db-init` (`postgres:15-alpine`, `execute_on_apply = true`, délai d'expiration de 600s) se connecte en tant que super-utilisateur `postgres` et, de manière idempotente :

1. Crée le rôle de l'application avec `LOGIN CREATEDB` (ou réinitialise son mot de passe s'il existe).
2. Crée la base de données (appartenant à `postgres` — le super-utilisateur de Cloud SQL ne peut pas faire `SET ROLE` vers les rôles applicatifs).
3. Accorde tous les privilèges sur la base de données et sur le schéma `public` au rôle de l'application, puis lui réattribue la propriété du schéma `public` — les migrations de Coder y créent tous les objets.
4. Envoie un signal d'arrêt `POST /quitquitquit` au side-car Cloud SQL Proxy afin que le pod du Job se termine proprement.

Coder applique lui-même les migrations de schéma à chaque démarrage du serveur ; la tâche ne touche donc jamais au schéma. Pour examiner directement la base de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Secrets — délibérément aucun {#4-secrets--deliberately-none}

Contrairement à la plupart des modules Common applicatifs, `Coder_Common` ne crée **aucun secret Secret Manager** et sa sortie `secret_ids` est une map vide. Coder génère automatiquement ses clés de signature au premier démarrage et les conserve dans la base de données PostgreSQL ; la recréation des conteneurs, la mise à l'échelle et la migration de plateforme ne désynchronisent donc jamais un identifiant. Le seul secret d'un déploiement Coder est le mot de passe de la base de données géré par le socle :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~coder"
gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
```

Les opérateurs qui souhaitent le SSO peuvent injecter des secrets client OIDC via la transmission `secret_environment_variables` de la variante de plateforme.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Coder_Common` établit l'environnement de base afin que le plan de contrôle démarre correctement dès le premier démarrage :

- **Adresse d'écoute** — `CODER_HTTP_ADDRESS = "0.0.0.0:3000"` écoute sur toutes les interfaces, sur le port de conteneur du socle (3000).
- **Télémétrie désactivée** — `CODER_TELEMETRY_ENABLE = "false"` ; le service est accessible via sa propre entrée Cloud Run / GKE, le tunnel de développement automatique de Coder est donc inutile.
- **Journaux structurés** — `CODER_VERBOSE = "false"` maintient un volume de journaux STDOUT raisonnable pour la capture par Cloud Logging / GKE.
- **Migrations au démarrage** — Coder applique automatiquement ses migrations de base de données à chaque démarrage ; les mises à niveau de version ne nécessitent donc aucune étape manuelle.
- **Plan de contrôle sans état** — ni NFS ni Redis ne sont raccordés : les sessions, la file d'attente des builds d'espaces de travail, les modèles et les clés de signature résident tous dans PostgreSQL.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/healthz`, que Coder sert sans authentification avec un HTTP 200 dès que le serveur est à l'écoute.

- **Sonde de démarrage** — HTTP `/healthz`, délai initial de 60 s, période de 15 s, seuil d'échec de 30. Cela laisse à Coder jusqu'à 60 + (30 × 15) = 510 secondes à partir du démarrage du conteneur — une marge généreuse pour la migration de schéma du premier démarrage sur une instance Cloud SQL fraîchement provisionnée.
- **Sonde de vivacité** — HTTP `/healthz`, délai initial de 60 s, période de 30 s, seuil d'échec de 3.
- **Sonde de disponibilité** — HTTP `/healthz`, délai initial de 30 s, période de 10 s, seuil d'échec de 3.

Comme `/healthz` ne requiert aucune authentification, les sondes réussissent sans identifiants — ne les redirigez pas vers des chemins d'API sous `/api/v2/*` qui exigent un jeton de session.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (suffixe de nom `storage`, classe `STANDARD`, prévention de l'accès public appliquée) est déclaré ici et provisionné par le socle dans la région du déploiement. Le plan de contrôle sans état n'en dépend pas — il reste disponible pour les ressources des modèles ou l'usage de l'opérateur. Pour le lister :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~coder"
```

---

Pour la configuration propre à Coder exposée aux utilisateurs (variables par groupe, sorties et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Coder_GKE](Coder_GKE.md)** et **[Coder_CloudRun](Coder_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Coder sur Google Cloud Run](Coder_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Coder sur GKE Autopilot](Coder_GKE.md) — cette configuration déployée sur GKE.
