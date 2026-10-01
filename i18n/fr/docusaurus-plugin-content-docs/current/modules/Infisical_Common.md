---
title: "Infisical Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Infisical — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Infisical_Common.md @ 3055034 sha256:17e18985143d -->

# Infisical Common — Configuration applicative partagée {#infisical-common--shared-application-configuration}

`Infisical_Common` est la **couche applicative partagée** d'Infisical. Elle n'est
pas déployée seule ; elle fournit plutôt la configuration propre à Infisical
sur laquelle reposent [Infisical_GKE](Infisical_GKE.md) et [Infisical_CloudRun](Infisical_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface
de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Infisical, consultez les
guides de plateforme ([Infisical_GKE](Infisical_GKE.md), [Infisical_CloudRun](Infisical_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Infisical_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `ENCRYPTION_KEY` (16 octets aléatoires, hex), `AUTH_SECRET` (32 octets aléatoires, base64) et `ADMIN_PASSWORD` (24 caractères aléatoires) et les stocke dans **Secret Manager**. Un secret `REDIS_URL` conditionnel est ajouté lorsque l'authentification Redis est configurée. | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `infisical/infisical` avec un script de point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Sortie `database_type` / §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job `db-init` (crée le rôle + la base de données) et le job `admin-bootstrap` (amorçage sans interface du super-administrateur via la CLI) | Sortie `initialization_jobs` |
| Stockage objet | Aucun — Infisical n'a besoin d'aucun bucket ; la sortie `storage_buckets` vaut toujours `[]` | s.o. |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/api/status` ; la variante CloudRun remplace ensuite la sonde de démarrage par une sonde TCP et désactive la sonde de vivacité au niveau du module | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en clair :

- **`ENCRYPTION_KEY`** — 16 octets aléatoires, encodés en hexadécimal (32 caractères hex). Utilisée par
  Infisical pour chiffrer chaque secret qu'il stocke. **Ne la renouvelez jamais après le premier
  démarrage** — son renouvellement rend tous les secrets précédemment stockés définitivement
  impossibles à déchiffrer.
- **`AUTH_SECRET`** — 32 octets aléatoires, encodés en base64. Utilisé pour signer les jetons
  JWT de session/d'authentification d'Infisical. Son renouvellement invalide toutes les sessions actives — ne le
  renouvelez que pendant une fenêtre de maintenance.
- **`ADMIN_PASSWORD`** — un mot de passe aléatoire de 24 caractères pour le premier compte
  super-administrateur amorcé. Ce secret est injecté **uniquement** dans les `secret_env_vars`
  du job d'initialisation `admin-bootstrap` — il n'est jamais présent dans l'environnement du
  conteneur du serveur en cours d'exécution.

Un quatrième secret, **`REDIS_URL`**, est créé de manière conditionnelle : uniquement lorsque
`enable_redis = true` **et** `redis_auth != ""`. Lorsque `redis_auth` est vide (la
valeur par défaut), le socle injecte lui-même une paire correcte de variables d'environnement en clair `REDIS_HOST`/
`REDIS_PORT` (résolue à partir de la découverte NFS au moment de l'apply) et aucun secret `REDIS_URL`
n'est créé ici — en créer un inconditionnellement figerait un hôte erroné
(`127.0.0.1`) dans le cas sans authentification. La condition `var.redis_auth != ""` qui
contrôle l'inclusion de ce secret dans `secret_ids` est encapsulée dans `nonsensitive()`
car `redis_auth` est une variable Terraform sensible ; sans cela, la
condition contamine toute la map `secret_ids` et casse le `for_each`
en aval qui la consomme.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~infisical"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom
de son secret est indiqué dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Infisical nécessite **PostgreSQL 15** ; le moteur est imposé et MySQL ou d'autres
moteurs ne sont pas pris en charge. Deux jobs d'initialisation s'exécutent en séquence :

1. **`db-init`** — un job ponctuel utilisant `postgres:15-alpine`. Il détecte le
   socket du Cloud SQL Auth Proxy (Cloud Run) ou le sidecar en loopback (GKE), attend que
   PostgreSQL accepte les connexions, puis crée (ou met à jour) de manière idempotente le
   rôle applicatif et crée (ou réattribue la propriété de) la base de données applicative,
   en accordant tous les privilèges. `execute_on_apply = true` — il s'exécute à
   chaque apply et peut être relancé sans risque.
2. **`admin-bootstrap`** — un job ponctuel utilisant `infisical/cli:latest`, qui dépend
   de `db-init`. Il exécute `infisical bootstrap --ignore-if-bootstrapped` contre
   l'API HTTP du serveur en cours d'exécution (`INFISICAL_API_URL`, définie à partir de `site_url` et,
   lorsque celle-ci est vide, résolue à l'exécution à partir de `GKE_SERVICE_URL`/`CLOUDRUN_SERVICE_URL`
   injectées par la plateforme, localhost n'étant qu'un dernier recours)
   pour créer le premier compte super-administrateur, l'organisation et l'identité machine
   d'administration de l'instance — évitant ainsi la fenêtre d'inscription via l'interface web « ouverte jusqu'à ce que le premier visiteur la revendique ».
   `execute_on_apply = false` : sur **Cloud Run**, les jobs d'initialisation
   s'exécutent strictement *avant* la création du Service, ce job ne peut donc pas atteindre un serveur
   actif au moment de l'apply et doit être déclenché manuellement après le premier déploiement
   sain. Sur **GKE**, `execute_on_apply` ne contrôle que l'*attente* du job par Terraform —
   le pod du job est planifié immédiatement dans tous les cas, et il réessaie (jusqu'à
   20 tentatives, à 15 secondes d'intervalle) jusqu'à ce que le serveur réponde à `site_url`.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée (`Infisical_Common/scripts/Dockerfile`) encapsule
`infisical/infisical:${INFISICAL_VERSION}` avec un point d'entrée shell léger
(`entrypoint.sh`) qui s'exécute avant le démarrage du serveur Infisical :

- **Assemble `DB_CONNECTION_URI` au démarrage du conteneur, et non au moment du plan.**
  Infisical accepte une seule variable d'environnement de chaîne de connexion, et non des variables
  distinctes pour l'hôte/l'utilisateur/le mot de passe — mais le `DB_PASSWORD` d'exécution (une valeur de Secret Manager)
  n'est pas connu lorsque Terraform génère l'image, et ne peut pas y être encodé en URL.
  Le point d'entrée l'encode en URL et construit l'URI à partir des valeurs distinctes `DB_HOST`/
  `DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` injectées par le socle.
- **Choisit `sslmode` selon la forme de `DB_HOST` :** un chemin de socket Unix (`/*`,
  Auth Proxy de Cloud Run, TLS terminé par le proxy) → `disable` ; `127.0.0.1` /
  `localhost` (loopback du sidecar Auth Proxy de GKE, TLS également déjà terminé) →
  `disable` ; tout le reste (une IP privée brute, TCP direct) → `require`, car
  Cloud SQL rejette les connexions TCP non chiffrées sur IP privée.
- **L'argument de build `INFISICAL_VERSION` fait correspondre `"latest"` à une version épinglée.** Plutôt
  que de transmettre `application_version = "latest"` directement au tag de l'image
  de base, l'ARG `INFISICAL_VERSION` du Dockerfile résout `"latest"` en une
  version éprouvée épinglée (`v0.162.10` au moment de la rédaction de ce module) — conformément à
  la convention de ce catalogue de ne pas construire sur un tag d'image de base `latest` mouvant,
  et à la recommandation d'Infisical lui-même de ne pas exécuter `latest` tel quel en production.
- **S'exécute en tant qu'utilisateur non root de l'image (UID 1000).** Le Dockerfile ne
  passe que brièvement en `USER root` pour exécuter `chmod +x` sur le script de point d'entrée, puis revient à
  l'utilisateur par défaut de l'image de base avant `ENTRYPOINT`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Infisical_Common` établit l'environnement Infisical de base afin que
l'application démarre correctement dès le premier lancement :

- **`HOST = "0.0.0.0"`** — Infisical écoute sur toutes les interfaces ; sa propre valeur par défaut est
  localhost uniquement, ce qui le rendrait inaccessible à l'intérieur du conteneur.
- **`PORT` n'est délibérément pas défini.** Cloud Run rejette `PORT` comme nom de variable
  d'environnement réservé sur les Jobs, et les Services Cloud Run l'injectent de toute façon automatiquement à partir de `container_port`.
  Le port d'écoute par défaut d'Infisical (8080) correspond à la valeur par défaut de `container_port`,
  de sorte que GKE (qui n'a pas d'injection automatique de ce type) se lie quand même correctement dès
  l'installation.
- **`SITE_URL`** — définie à partir de `var.site_url` lorsqu'elle n'est pas vide, sinon par défaut
  `http://localhost:${container_port}`. Utilisée pour les liens d'invitation/d'e-mail, CORS, et comme
  cible du job `admin-bootstrap`. La variante Cloud Run calcule une URL `run.app` prévisible
  et la transmet automatiquement comme `site_url` ; la variante GKE transmet
  `var.site_url` telle quelle sans aucun calcul — consultez les pièges du guide de plateforme GKE
  pour l'implication opérationnelle.
- **`DATABASE_URL`/`DB_CONNECTION_URI` n'est intentionnellement PAS construite ici** — voir
  le §4 ci-dessus ; elle est assemblée au démarrage du conteneur par `entrypoint.sh` à la place.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

L'objet de sonde par défaut (défini dans `Infisical_Common/variables.tf`) cible
`/api/status`, qui renvoie HTTP 200 avec un corps JSON une fois qu'Infisical, sa
connexion à la base de données et (si activé) Redis sont tous sains.

- **Cloud Run remplace ce comportement au niveau du module.** `/api/status` ne renvoie
  un code 2xx qu'après une disponibilité *complète* — une sonde de démarrage HTTP sur ce chemin ne réussirait jamais
  pendant la période précédant la connexion de Redis/de la base de données, c'est pourquoi `Infisical_CloudRun`
  définit par défaut sa `startup_probe` en **TCP** (réussit dès que le port est lié)
  et **désactive entièrement la sonde de vivacité** pour éviter de redémarrer en boucle un
  conteneur qui n'a pas encore fini de se connecter.
- **GKE conserve la valeur par défaut HTTP `/api/status`** pour les sondes de démarrage et de
  vivacité — les sondes natives de Kubernetes ne présentent pas le même mode de défaillance « le service n'est jamais
  créé » que la barrière de démarrage de Cloud Run, si bien qu'une sonde HTTP plus lente à réussir
  y est acceptable.

---

## 7. Stockage d'objets {#7-object-storage}

La propre sortie `storage_buckets` d'`Infisical_Common` est toujours une liste vide —
Infisical stocke tout son état persistant dans PostgreSQL et n'a besoin d'aucun stockage objet
propre. Le bucket GCS générique `data` visible dans les sorties des guides de plateforme
provient de la valeur par défaut de la variable `storage_buckets` du socle (partagée par
tous les modules applicatifs de ce catalogue), et non de quoi que ce soit qu'`Infisical_Common`
déclare ou que l'application utilise réellement.

---

Pour la configuration propre à Infisical destinée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Infisical_GKE](Infisical_GKE.md)** et
**[Infisical_CloudRun](Infisical_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Infisical sur Google Cloud Run](Infisical_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Infisical sur GKE Autopilot](Infisical_GKE.md) — cette configuration déployée sur GKE.
