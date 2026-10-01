---
title: "UrBackup Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module UrBackup — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/UrBackup_Common.md @ 3055034 sha256:6f805af973b3 -->

# UrBackup Common — Configuration applicative partagée {#urbackup-common--shared-application-configuration}

`UrBackup_Common` est la **couche applicative partagée** d'UrBackup. Elle n'est pas
déployée seule ; elle fournit la configuration propre à UrBackup sur laquelle
s'appuie [UrBackup_GKE](UrBackup_GKE.md). Les utilisateurs finaux ne configurent
jamais directement cette couche — elle ne possède aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

**GKE uniquement.** Le protocole client d'UrBackup a besoin que trois ports TCP
bruts (`55413` back-end FastCGI, `55414` interface web directe, `55415` transfert
client en mode internet) ainsi que la diffusion UDP de découverte LAN
(`35622`-`35623`) soient joignables simultanément. L'entrée de Cloud Run (le GFE)
n'accepte qu'un seul port HTTP(S) et ne peut exposer ni du TCP brut multiport, ni
aucun trafic UDP. Les vrais clients de sauvegarde s'exécutent sur les propres PC
des utilisateurs, en dehors de ce projet GCP, et se connectent directement sur
ces ports — même une variante Cloud Run « interface de gestion uniquement »
n'apporterait guère de valeur, puisque le véritable protocole de transfert des
données de sauvegarde ne pourrait jamais l'atteindre. Il s'agit de la même
catégorie architecturale de lacune que celle des autres modules **Common + GKE
uniquement** de ce catalogue (Kopia, RocketChat, Immich, Temporal, Prowlarr,
VictoriaMetrics, Plausible, LobeChat, Supabase, Woodpecker), mais en plus
difficile : il ne s'agit pas d'un verbe ou d'une négociation bloqués (comme
l'exigence TLS+ALPN de Kopia ou le rejet de `MKCOL` WebDAV par GoToSocial) —
c'est toute une catégorie de ports (TCP multiport et UDP) que le modèle d'entrée
de Cloud Run ne peut exprimer, quelle que soit la configuration.

Pour l'infrastructure qui provisionne et exécute réellement UrBackup, consultez
le guide de la plateforme [UrBackup_GKE](UrBackup_GKE.md) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **Non déployé sur un cluster GKE réel.** Ce module a été validé statiquement
> (`tofu validate`) et son image de conteneur personnalisée a été construite et
> exécutée localement avec Docker (un montage bind explicite sur `/var/urbackup`,
> simulant un volumeMount Kubernetes) — ce qui a confirmé que le serveur démarre
> réellement et sert une véritable interface web fonctionnelle. Il n'a toutefois
> pas été déployé sur un cluster GKE réel pendant le développement. Les
> affirmations sur le comportement ci-dessous proviennent de la documentation et
> du code source officiels du projet en amont
> (`github.com/uroni/urbackup-server-docker`), ainsi que de cette vérification locale.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par UrBackup_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Fine surcouche `FROM uroni/urbackup-server:${URBACKUP_VERSION}` (Docker Hub) plus un point d'entrée redirigeant par lien symbolique ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Stockage de données | Fixe `database_type = "NONE"` — pas de Cloud SQL. UrBackup initialise sa propre base de données SQLite intégrée au premier démarrage | §Comportement de l'application dans le guide de la plateforme |
| Secrets | **Aucun.** UrBackup crée son compte administrateur via son propre assistant de configuration web au premier lancement | s.o. — les sorties `secret_ids`/`secret_values` sont des maps vides |
| Stockage persistant | Déclare un bucket GCS `storage` FACULTATIF servant d'échappatoire (non monté par défaut) — ce n'est PAS là que résident les données réelles d'UrBackup, voir §3 | Sortie `storage_buckets` |
| Paramètres principaux | Fixe `container_port = 55414`, une mise à l'échelle à serveur unique (`max_instance_count = 1`), SANS mise à l'échelle à zéro (`min_instance_count = 1`) | Comportement de l'application dans le guide de la plateforme |
| Tests de santé | Fournit des sondes de démarrage/vivacité TCP uniquement sur le port `55414` | §Observabilité dans le guide de la plateforme |

---

## 2. Aucun secret — configuration via l'interface web au premier lancement {#2-no-secrets--first-run-web-ui-setup}

Contrairement à la plupart des modules Common de ce catalogue, qui génèrent au
moins un identifiant stocké dans Secret Manager, `UrBackup_Common` n'en crée
**aucun**. L'image de base n'a pas de variable d'environnement documentée pour
pré-créer un compte administrateur — la première visite de l'interface web dans
un navigateur (port `55414`) présente le propre assistant de configuration
d'UrBackup, qui permet de créer le compte administrateur de manière interactive.

`secret_ids` et `secret_values` sont tout de même exportées sous forme de sorties
de maps vides (plutôt qu'omises entièrement), conformément au modèle sans secret
déjà utilisé ailleurs dans ce catalogue (Beszel, Audiobookshelf, Element,
CloudBeaver) — cela garde le câblage de transmission de la variante `UrBackup_GKE`
(`module_secret_env_vars = module.urbackup_app.secret_ids`) uniforme avec tous
les autres modules Common, sans traitement particulier du cas sans secret.

---

## 3. Image de conteneur et point d'entrée — un correctif au moment du build, pas un script d'encapsulation {#3-container-image-and-entrypoint--a-build-time-patch-not-a-wrapper-script}

L'image personnalisée encapsule `uroni/urbackup-server:<version>` (l'image
officielle de Docker Hub, publiée depuis `github.com/uroni/urbackup-server-docker`)
avec un correctif `sed` d'une ligne appliqué au point d'entrée PROPRE de l'image
de base — sans script d'encapsulation distinct :

```dockerfile
ARG URBACKUP_VERSION=2.5.x
FROM uroni/urbackup-server:${URBACKUP_VERSION}

RUN sed -i \
      -e 's#echo "/backups" > /var/urbackup/backupfolder#mkdir -p /var/urbackup/backups \&\& echo "/var/urbackup/backups" > /var/urbackup/backupfolder#' \
      /usr/bin/entrypoint.sh \
    && grep -q '/var/urbackup/backups' /usr/bin/entrypoint.sh

ENTRYPOINT ["/usr/bin/entrypoint.sh"]
CMD ["run"]
```

- **ARG de version propre à l'application.** Le Dockerfile lit `URBACKUP_VERSION` — *et non*
  le `APP_VERSION` générique qu'injecte le socle. `application_version =
  "latest"` se résout en la version épinglée `URBACKUP_VERSION=2.5.x`.

**Une version antérieure de ce Dockerfile adoptait une autre approche** — un
point d'entrée d'encapsulation distinct qui, au démarrage du conteneur, créait
des liens symboliques des deux chemins de données attendus par l'image de base
(`/var/urbackup`, `/backups`) vers un unique volume monté. **Défaillance
confirmée** par un test local `docker build` + `docker run` : `ln -sfn` ne peut
pas remplacer un répertoire existant par un lien symbolique — il place
silencieusement le nouveau lien *à l'intérieur* du répertoire. L'image de base
déclare les deux chemins comme `VOLUME` Docker, si bien qu'un simple
`docker run` (sans `-v` explicite) les recrée en tant que répertoires avant même
l'exécution du point d'entrée, et l'étape de lien symbolique échouait exactement
de cette façon.

Le correctif modifie plutôt un mécanisme sur lequel le conteneur s'appuie déjà :
le point d'entrée de base (confirmé en le lisant directement) écrit la
destination des données de sauvegarde dans `/var/urbackup/backupfolder` à
**chaque démarrage**, inconditionnellement :

```sh
echo "/backups" > /var/urbackup/backupfolder
```

Modifier cette ligne pour écrire `/var/urbackup/backups` au lieu de `/backups`
fait atterrir les données de sauvegarde des clients sous le MÊME chemin monté que
la base de données, à l'aide d'un mécanisme de configuration que l'image prend
déjà en charge.

**Vérifié localement, pas seulement en théorie :** construire cette image et
l'exécuter avec un montage bind explicite sur `/var/urbackup` (`docker run -v
/tmp/data:/var/urbackup ...` — simulant un volumeMount Kubernetes) a produit un
serveur UrBackup réel et fonctionnel : `backupfolder` indiquait correctement
`/var/urbackup/backups`, la base de données SQLite s'est initialisée (visible
dans le journal de démarrage sous la forme d'une suite de lignes « Upgrading
database to version N »), et l'interface web a renvoyé une véritable réponse
`HTTP 200` intitulée *« UrBackup - Keeps your data safe »* sur le port `55414`.

---

## 4. Stockage persistant — un seul PVC sur `/var/urbackup`, pas GCS {#4-persistent-storage--one-pvc-at-varurbackup-not-gcs}

L'image en amont attend **deux volumes distincts** :

| Chemin | Contenu |
|---|---|
| `/var/urbackup` | La base de données SQLite et la configuration propres au serveur (emplacement fixé par le `$HOME` de l'utilisateur système `urbackup`, défini dans le script `postinst` du paquet `.deb`) |
| `/backups` (redirigé vers `/var/urbackup/backups` par ce module — voir §3) | Les données de sauvegarde de chaque client enregistré (fichiers + images disque facultatives), dédupliquées entre les sauvegardes incrémentielles d'une même arborescence au moyen de **liens physiques** |

Aucun des deux n'a sa place sur un montage GCS FUSE : gcsfuse ne prend pas en
charge les liens physiques dont dépend la déduplication d'UrBackup au sein de
l'arborescence des données de sauvegarde, et sa sémantique de verrouillage de
fichiers n'est pas sûre pour une base de données SQLite active — la même
catégorie de risque de corruption gcsfuse/SQLite déjà documentée dans le
CLAUDE.md de ce catalogue pour d'autres applications. Notez que les liens
physiques n'ont besoin de fonctionner *qu'à l'intérieur* de l'arborescence des
données de sauvegarde elle-même (entre différentes sauvegardes incrémentielles)
— ils n'exigent **pas** que le répertoire de la base de données et celui des
sauvegardes partagent un système de fichiers ; le montage des deux sous
`/var/urbackup` découle de la contrainte du socle d'un seul PVC par StatefulSet,
et non d'une exigence liée aux liens physiques.

`UrBackup_GKE` utilise donc par défaut une Persistent Volume Claim de stockage en
mode bloc GKE (`stateful_pvc_enabled = true`) montée directement sur `/var/urbackup`.

Le bucket GCS `storage` que ce module déclare BIEN
(`enable_gcs_storage_volume`, `false` par défaut) est une **échappatoire
facultative entièrement distincte** — par exemple pour des rapports exportés — et
ce n'est pas là que résident les données réelles d'UrBackup :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

## 5. Variables d'environnement — PUID/PGID/TZ {#5-environment-variables--puidpgidtz}

Les variables d'environnement documentées de l'image de base sont exposées en tant que variables Common :

| Variable Common | Variable d'environnement du conteneur | Valeur par défaut | Rôle |
|---|---|---|---|
| `puid` | `PUID` | `1000` | UID auquel le point d'entrée de base attribue (chown) `/var/urbackup` (le PVC monté) |
| `pgid` | `PGID` | `1000` | GID pour ce même chown |
| `timezone` | `TZ` | `Etc/UTC` | Influe sur la planification et l'horodatage des sauvegardes |

Elles sont fusionnées avec toute variable `environment_variables` fournie par l'opérateur.

---

## 6. Serveur unique, incompatible avec la mise à l'échelle à zéro {#6-single-server-not-scale-to-zero-safe}

`max_instance_count` doit rester à **1** — la base de données SQLite intégrée et
la déduplication par liens physiques n'ont aucune coordination multi-instance ;
des serveurs concurrents corrompraient l'état les uns des autres ou entreraient
en concurrence. `min_instance_count` vaut **1** par défaut (délibérément SANS
mise à l'échelle à zéro, contrairement à la plupart des applications
requête/réponse de ce catalogue) — les vrais clients d'UrBackup sont des PC
distants qui se connectent selon leur propre planning de sauvegarde automatique,
à des moments arbitraires ; un serveur mis à l'échelle à zéro manquerait donc
silencieusement ces connexions plutôt que de servir une page lente à démarrer à froid.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut sont de type **TCP**, et non HTTP, sur le port `55414` :

- **Sonde de démarrage** — TCP, délai initial de 15 secondes, période de 10 secondes,
  fenêtre de 10 tentatives.
- **Sonde de vivacité** — TCP, délai initial de 30 secondes, période de 30 secondes,
  fenêtre de 3 tentatives.

Les tests locaux ont confirmé que le chemin `/` de l'interface web renvoie BIEN
une véritable réponse `HTTP 200` sans authentification — mais comme cette
confirmation provient d'un test Docker local plutôt que d'un déploiement GKE
réel, TCP reste le choix retenu ici : dès que le port accepte une connexion,
`urbackupsrv` a terminé sa propre séquence de démarrage, indépendamment du
comportement de routage HTTP propre à la plateforme, qui n'a pas été vérifié de
bout en bout sur GKE.

---

Pour la configuration propre à UrBackup exposée aux utilisateurs (variables par
groupe, sorties, le Service dédié multiport d'accès client, et comment explorer
chaque ressource depuis la console et la CLI), consultez le guide de la plateforme :
**[UrBackup_GKE](UrBackup_GKE.md)**. Il n'existe pas de `UrBackup_CloudRun` —
voir la note en haut de ce guide pour comprendre pourquoi Cloud Run ne peut pas
prendre en charge le protocole client multiport d'UrBackup.

<!-- related-guides -->

## Guides associés {#related-guides}

- [UrBackup sur GKE Autopilot](UrBackup_GKE.md) — cette configuration déployée sur GKE.
