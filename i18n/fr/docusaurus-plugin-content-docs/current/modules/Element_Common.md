---
title: "Element Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Element — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Element_Common.md @ 3055034 sha256:d3c2fb00cbbf -->

# Element Common — Configuration applicative partagée {#element-common--shared-application-configuration}

`Element_Common` est la **couche applicative partagée** d'Element, le client web
Matrix. Elle n'est pas déployée seule ; elle fournit la configuration propre à Element
sur laquelle s'appuient à la fois [Element_GKE](Element_GKE.md) et
[Element_CloudRun](Element_CloudRun.md), afin que les deux variantes de plateforme se
comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Element, consultez les
guides des plateformes ([Element_GKE](Element_GKE.md),
[Element_CloudRun](Element_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Element_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `vectorim/element-web` avec un point d'entrée personnalisé qui génère `config.json` ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Épinglage de version | Associe `application_version = "latest"` à un tag éprouvé épinglé (`v1.11.86`) via un ARG de build propre à l'application, `ELEMENT_VERSION` | `container_build_config.build_args` |
| Configuration du serveur d'accueil à l'exécution | Écrit `/app/config.json` au démarrage du conteneur à partir de `HOMESERVER_URL` / `HOMESERVER_NAME` | Comportement de l'application dans les guides des plateformes |
| Moteur de base de données | Définit `database_type = "NONE"` — Element est un client statique sans stockage côté serveur | §Base de données dans les guides des plateformes |
| Secrets | **Aucun** — `secret_ids` et `secret_values` sont des maps vides | — |
| Stockage d'objets | **Aucun** — `storage_buckets` est une liste vide | Sortie `storage_buckets` |
| Paramètres principaux | Port de conteneur `80`, limites de ressources, bornes de mise à l'échelle, valeurs par défaut sans télémétrie | Comportement de l'application dans les guides des plateformes |
| Vérifications de santé | Fournit les sondes de démarrage, de vivacité et de disponibilité par défaut ciblant `/` | §Observabilité dans les guides des plateformes |

---

## 2. Ni secrets, ni base de données, ni stockage {#2-no-secrets-no-database-no-storage}

Contrairement aux applications avec état, Element est une **application monopage
statique** servie par nginx. Le navigateur communique directement avec un serveur
d'accueil Matrix via HTTPS ; le conteneur ne contient donc rien qui doive être persisté
ou protégé :

- **Aucun secret Secret Manager.** `Element_Common` n'en génère aucun. `secret_ids`
  (map variable d'environnement → ID de secret) et `secret_values` (valeurs brutes pour
  le pilote CSI Secret Store de GKE) sont tous deux des maps vides. Il n'y a ni clé de
  chiffrement, ni secret JWT, ni mot de passe de base de données à gérer ou à faire
  tourner.
- **Aucune base de données.** `database_type = "NONE"` et
  `enable_cloudsql_volume = false`. Aucune instance Cloud SQL, aucun job `db-init` et
  aucune migration de schéma — `initialization_jobs`
  est vide.
- **Aucun stockage persistant.** `storage_buckets = []` et `gcs_volumes = []`. Rien de
  ce que sert Element ne nécessite de bucket GCS, de montage NFS ou de PVC.

C'est pourquoi les variables Base de données, Redis, Sauvegarde et (sur GKE)
StatefulSet/NFS des guides des plateformes sont documentées comme **héritées mais sans
effet** — elles n'existent que pour satisfaire la reproduction des variables du
socle et n'ont aucun effet pour Element.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

L'image personnalisée encapsule `vectorim/element-web:<version>` avec un point d'entrée
léger en shell POSIX (`element-entrypoint.sh`) qui s'exécute avant le démarrage de
nginx :

- **Génère `/app/config.json`** — Element lit sa configuration d'exécution depuis ce
  fichier. Comme Cloud Run et GKE ne peuvent pas monter un fichier de l'hôte, le point
  d'entrée l'écrit au démarrage du conteneur à partir des variables d'environnement
  `HOMESERVER_URL` et `HOMESERVER_NAME`, de sorte qu'une même image peut pointer vers
  n'importe quel serveur d'accueil Matrix sans nouveau build.
- **Applique des valeurs par défaut sûres** — lorsque les variables d'environnement ne
  sont pas définies, il se rabat sur les valeurs publiques
  `https://matrix-client.matrix.org` / `matrix.org`, ainsi que `brand: "Element"`,
  `disable_guests: false` et `default_theme: "light"`.
- **Passe la main à nginx** — exécute (exec) le point d'entrée nginx standard
  d'`element-web` s'il est présent, sinon `nginx -g 'daemon off;'`. Dans les deux cas,
  nginx écoute sur le port 80, ce qui correspond à `container_port`.

Le build est défini par `scripts/Dockerfile` et poussé par `scripts/cloudbuild.yaml`
(un build Kaniko). Le tag de version est défini via un **ARG de build propre à
l'application, `ELEMENT_VERSION`**, plutôt que via l'`APP_VERSION` générique — le
socle injecte `APP_VERSION` et écraserait sinon le tag par `latest`, qui n'est pas
un tag `element-web` valide. `Element_Common` résout `application_version = "latest"`
en `v1.11.86` épinglé avant de définir l'ARG.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Element_Common` établit l'environnement d'exécution de base d'Element afin que le
client démarre correctement dès le premier lancement :

- **Image de conteneur** — `vectorim/element-web`, `image_source = "custom"` (passe
  par Cloud Build / Artifact Registry).
- **Port** — `container_port = 80` (nginx).
- **Base de données** — `database_type = "NONE"` ; `enable_cloudsql_volume = false`.
- **Ressources** — `cpu_limit` / `memory_limit` transmis par le module appelant
  (`1000m` / `512Mi` sur Cloud Run ; `500m` / `512Mi` sur GKE).
- **Mise à l'échelle** — `min_instance_count` / `max_instance_count` transmis par le
  module appelant. Cloud Run fusionne `min = 0` (mise à l'échelle jusqu'à zéro) ; GKE
  fusionne `min = 1`.
- **Serveur d'accueil** — le module Application transmet `HOMESERVER_URL` /
  `HOMESERVER_NAME` en tant que `module_env_vars`, que le point d'entrée écrit dans
  `config.json` à l'exécution.

Ajustements propres à chaque plateforme, gérés par le module appelant :

- **Cloud Run** fusionne `min_instance_count = 0` et l'associe à une facturation à la
  requête (`cpu_always_allocated = false`) — un serveur statique ne coûte rien au repos.
- **GKE** fusionne `min_instance_count = 1` (GKE ne descend pas à zéro) et s'exécute en
  tant que `Deployment` sans état (`session_affinity = None`).

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le chemin racine `/` — nginx y répond immédiatement avec
le squelette statique de la SPA et sans authentification ; c'est donc un signal de
vivacité valide et peu coûteux sur les deux plateformes. Element démarre en moins de
5 secondes (ni migrations de base de données ni pools de connexions), si bien que les
délais initiaux sont volontairement courts.

- **Cloud Run** utilise des sondes HTTP ciblant `/` — démarrage avec un délai initial de
  10 secondes et une fenêtre de 6 échecs, vivacité avec un délai de 15 secondes.
- **GKE** utilise les mêmes sondes HTTP `/` ; le pod devient prêt (Ready) dès que nginx
  écoute sur le port 80. Le chemin `/` est public et non authentifié ; les sondes de
  type HTTP comme TCP sont donc envisageables.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/` | 10 s | 10 s | 6 |
| Vivacité | HTTP | `/` | 15 s | 30 s | 3 |
| Disponibilité | HTTP | `/` | 10 s | 10 s | 3 |

---

## 6. Sorties {#6-outputs}

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Objet complet de configuration de l'application (image, port, variables d'environnement, sondes, limites de ressources, mise à l'échelle). |
| `secret_ids` | `map(string)` | Toujours vide — Element ne nécessite aucun secret. |
| `secret_values` | `map(string)` | Toujours vide (sensible) — Element ne nécessite aucun secret. |
| `storage_buckets` | `list` | Toujours vide — Element est sans état. |
| `path` | `string` | Chemin absolu, dans le système de fichiers, du répertoire du module `Element_Common`. Utilisé pour résoudre `scripts_dir`. |

---

## 7. Scripts {#7-scripts}

| Fichier | Rôle |
|---|---|
| `scripts/Dockerfile` | Build personnalisé léger `FROM vectorim/element-web:${ELEMENT_VERSION}` qui copie le point d'entrée et expose le port 80. |
| `scripts/element-entrypoint.sh` | Génère `/app/config.json` à partir de `HOMESERVER_URL` / `HOMESERVER_NAME`, puis passe la main à nginx. |
| `scripts/cloudbuild.yaml` | Pipeline Cloud Build fondé sur Kaniko qui construit et pousse l'image personnalisée vers Artifact Registry. |

---

Pour la configuration propre à Element destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes :
**[Element_GKE](Element_GKE.md)** et **[Element_CloudRun](Element_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Element sur Google Cloud Run](Element_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Element sur GKE Autopilot](Element_GKE.md) — cette configuration déployée sur GKE.
