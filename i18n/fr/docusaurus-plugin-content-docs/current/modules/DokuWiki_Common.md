---
title: "DokuWiki Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module DokuWiki — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/DokuWiki_Common.md @ 3055034 sha256:4bc650931786 -->

# DokuWiki Common — Configuration applicative partagée {#dokuwiki-common--shared-application-configuration}

`DokuWiki_Common` est la **couche applicative partagée** de DokuWiki. Elle n'est pas
déployée seule ; elle fournit la configuration propre à DokuWiki sur laquelle
s'appuient à la fois [DokuWiki_GKE](DokuWiki_GKE.md) et
[DokuWiki_CloudRun](DokuWiki_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où c'est important. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement DokuWiki, consultez
les guides des plateformes ([DokuWiki_GKE](DokuWiki_GKE.md),
[DokuWiki_CloudRun](DokuWiki_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par DokuWiki_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | **Aucun.** DokuWiki stocke les identifiants administrateur dans le répertoire de données à fichiers plats (créés via `/install.php`), et non dans une variable d'environnement secrète d'exécution — `secret_ids` est une table vide | n/a |
| Image de conteneur | Build personnalisé léger **FROM `dokuwiki/dokuwiki`** avec un point d'entrée enveloppe ; construit via Cloud Build (Kaniko) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** (`database_type = "NONE"`). DokuWiki est un wiki à fichiers plats — ni Cloud SQL, ni MySQL, ni PostgreSQL | Section Base de données des guides des plateformes |
| Initialisation de la base | **Aucune.** `initialization_jobs = []` — il n'y a aucun schéma à créer | n/a |
| Stockage persistant | Déclare le bucket de données **Cloud Storage** qui adosse `/storage` (montage gcsfuse sur Cloud Run). GKE le remplace par un PVC bloc | `storage_buckets` / `gcs_volumes` dans les guides des plateformes |
| Paramètres essentiels | Fixe le port du conteneur (`8080`), la source de l'image (`custom`) et le tag de version DokuWiki épinglé | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes par défaut de démarrage / vivacité / disponibilité ciblant `/` | Section Observabilité des guides des plateformes |

---

## 2. Aucun secret cryptographique, aucune base de données {#2-no-cryptographic-secrets-no-database}

DokuWiki est un **wiki léger à fichiers plats** : il stocke *tout* son état — pages,
médias, plugins, utilisateurs et configuration — dans un unique répertoire persistant
(`/storage` dans l'image `dokuwiki/dokuwiki`). Il n'y a :

- **Aucune base de données externe.** `database_type = "NONE"`,
  `enable_cloudsql_volume = false`, `initialization_jobs = []`. Aucune instance
  Cloud SQL n'est provisionnée. Les deux variantes de plateforme comportent une garde
  de validation au moment du plan qui rejette tout `database_type` différent de
  `NONE`.
- **Aucun Redis ni cache en mémoire.**
- **Aucune variable d'environnement secrète d'exécution.** `secret_ids` et
  `secret_values` sont deux tables vides. Le compte administrateur n'est **pas**
  injecté depuis Secret Manager — il est créé de manière interactive lors de la
  première visite de `/install.php` (voir §5).

Comme il n'y a ni secrets générés ni mots de passe de base de données, le flux
habituel de récupération via `gcloud secrets` ne s'applique pas à DokuWiki. Tout
l'état durable réside dans le seul volume `/storage`.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

L'image personnalisée est une **enveloppe légère** autour de l'image officielle
amont :

```dockerfile
ARG DOKUWIKI_VERSION=2024-02-06b
FROM dokuwiki/dokuwiki:${DOKUWIKI_VERSION}
USER root
COPY dokuwiki-entrypoint.sh /usr/local/bin/dokuwiki-entrypoint.sh
RUN chmod +x /usr/local/bin/dokuwiki-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/dokuwiki-entrypoint.sh"]
```

- **Image de base :** `dokuwiki/dokuwiki` (construite sur l'image officielle
  `php:apache`), qui sert Apache sur le **port 8080**.
- **Version épinglée :** `dokuwiki/dokuwiki` publie des tags de version datés (p. ex.
  `2024-02-06b`) ainsi que les alias mobiles `stable`/`latest`. `DokuWiki_Common`
  associe la valeur par défaut de la campagne `application_version = "latest"` à un
  **tag daté épinglé** (`2024-02-06b`) afin que le build ne dépende jamais d'un alias
  mobile. L'ARG de build est `DOKUWIKI_VERSION`, propre à l'application (et non le
  générique `APP_VERSION`, que le socle injecte dans `build_args` et qui serait sinon
  écrasé par `latest`).
- **Point d'entrée enveloppe (`dokuwiki-entrypoint.sh`) :** il ne remplace *pas* le
  point d'entrée amont. Il se contente de s'assurer que le répertoire de données monté
  (`/storage`) existe et est accessible en écriture — des volumes fraîchement
  provisionnés peuvent être vides ou appartenir à root — puis passe la main, sans
  modification, au `/dokuwiki-entrypoint.sh` d'origine, qui amorce `/storage` avec le
  contenu du wiki par défaut au premier lancement et démarre Apache sur 8080. Si le
  point d'entrée d'origine est absent, il se replie sur
  `docker-php-entrypoint apache2-foreground`.

L'image est construite avec Cloud Build à l'aide de Kaniko (voir
`scripts/cloudbuild.yaml`) et, par défaut, mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`).

---

## 4. Stockage persistant {#4-persistent-storage}

DokuWiki a besoin d'un **répertoire de données durable** sur `/storage` qui survive
aux redémarrages du conteneur. Les deux variantes de plateforme l'adossent
différemment :

- **Cloud Run** — `DokuWiki_Common` déclare un unique bucket de données
  **Cloud Storage** et le monte sur `/storage` en tant que gcs_volume nommé `dokuwiki-data` via **gcsfuse** (`implicit-dirs`,
  `stat-cache-ttl=60s`, `type-cache-ttl=60s`). Le nom du bucket correspond à celui
  que le socle crée effectivement : `gcs-${application_name}${tenant_resource_prefix}-data`
  (propre à l'application). Listez-le avec :
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/       # bucket name is in the platform Outputs
  ```
- **GKE** — la variante GKE remplace `gcs_volumes = []` et monte à la place un
  **PersistentVolumeClaim bloc** sur `/storage` (`stateful_pvc_enabled = true`,
  `stateful_pvc_mount_path = "/storage"`). Un PVC bloc gère bien mieux que gcsfuse le
  verrouillage de fichiers plats de DokuWiki ; `module_storage_buckets` est donc vide
  sur GKE.

---

## 5. Configuration au premier lancement et sondes de santé {#5-first-run-setup-and-health-probes}

- **Installateur du premier lancement.** Lors de la première visite, ouvrez
  `/install.php` pour créer le compte administrateur, définir le titre du wiki et
  choisir la politique d'ACL. Une fois le compte administrateur créé, **supprimez ou
  désactivez `install.php`** (DokuWiki refuse de relancer l'installateur dès qu'une
  configuration existe, mais le supprimer reste une bonne pratique). Tout cela est
  écrit dans `/storage` et persiste donc pendant toute la durée de vie du volume.
- **Pas de migrations automatiques.** Il n'y a ni base de données ni job de
  migration ; la mise à niveau de l'image livre simplement un nouveau code PHP / de
  moteur de wiki qui lit les mêmes données `/storage`.
- **Sondes de santé.** Les sondes par défaut de démarrage, de vivacité et de
  disponibilité sont toutes des requêtes HTTP sur le chemin racine `/` — DokuWiki y
  sert sa page d'accueil sans authentification, si bien que la sonde réussit dès
  qu'Apache est prêt et que `/storage` est amorcé. Le démarrage prévoit une fenêtre
  modeste (délai initial de 10 s) ; DokuWiki démarre en quelques secondes, puisqu'il
  n'y a aucune base de données à migrer.

---

Pour la configuration propre à DokuWiki destinée aux utilisateurs (variables par
groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[DokuWiki_GKE](DokuWiki_GKE.md)** et
**[DokuWiki_CloudRun](DokuWiki_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [DokuWiki sur Google Cloud Run](DokuWiki_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [DokuWiki sur GKE Autopilot](DokuWiki_GKE.md) — cette configuration déployée sur GKE.
