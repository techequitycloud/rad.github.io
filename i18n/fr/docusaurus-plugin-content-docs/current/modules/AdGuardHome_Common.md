---
title: "AdGuardHome Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module AdGuardHome — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/AdGuardHome_Common.md @ 3055034 sha256:95c0bf9e2937 -->

# AdGuardHome Common — Configuration applicative partagée {#adguardhome-common--shared-application-configuration}

`AdGuardHome_Common` est la **couche applicative partagée** d'AdGuard Home. Elle
n'est pas déployée seule ; elle fournit la configuration propre à AdGuard Home
sur laquelle reposent à la fois [AdGuardHome_GKE](AdGuardHome_GKE.md) et
[AdGuardHome_CloudRun](AdGuardHome_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

> ⚠️ **Note CRITIQUE sur le périmètre.** La valeur essentielle d'AdGuard Home
> (blocage DNS des publicités et des traqueurs à l'échelle du réseau) exige que
> les clients l'interrogent sur le port 53 (TCP+UDP). **Ni Cloud Run, ni le
> modèle Gateway HTTP(S) standard de GKE utilisé par ces modules ne peuvent
> exposer le port 53 brut.** Cette couche met en place **uniquement la console
> d'administration web** d'AdGuard Home (port 3000), pour la gestion de la
> configuration des listes de filtres, des règles et des clients. L'instance
> déployée **n'est pas accessible en tant que résolveur DNS public** sur aucune
> des deux plateformes.

Pour l'infrastructure qui provisionne et exécute réellement AdGuard Home,
consultez les guides de plateforme ([AdGuardHome_GKE](AdGuardHome_GKE.md),
[AdGuardHome_CloudRun](AdGuardHome_CloudRun.md)) et les guides de fondation
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par AdGuardHome_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `adguard/adguardhome` avec un script de point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Aucune base de données externe (`database_type = "NONE"`) — la configuration est un fichier YAML plat | §Base de données dans les guides de plateforme |
| Stockage persistant | Déclare DEUX buckets Cloud Storage (`conf`, `work`) et les monte via GCS Fuse | Sortie `storage_buckets` ; `gcs_volumes` dans `config` |
| Paramètres de base | Fixe `container_port = 3000` (le port de l'assistant de configuration) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/` | §Observabilité dans les guides de plateforme |
| Secrets | Aucun — l'identifiant administrateur est défini via l'assistant web du premier lancement d'AdGuard Home | La sortie `secret_ids` vaut `{}` |

---

## 2. Image de conteneur et point d'entrée {#2-container-image-and-entrypoint}

L'image personnalisée (`modules/AdGuardHome_Common/scripts/Dockerfile`)
encapsule `adguard/adguardhome:<version>` avec un point d'entrée shell léger
(`adguardhome-entrypoint.sh`) :

- **Garantit que `conf/` et `work/` sont accessibles en écriture**, avec repli
  sur `/tmp` (accompagné d'un avertissement bien visible indiquant que rien n'y
  survit à un redémarrage) si les montages GCS Fuse sont indisponibles pour une
  raison quelconque — ce qui évite une boucle de plantage silencieuse sur un
  déploiement mal configuré.
- **Journalise la limitation de périmètre DNS** à chaque démarrage du
  conteneur, afin qu'elle soit visible dans Cloud Logging même sans lire cette
  documentation.
- **Construit explicitement l'invocation complète d'AdGuard Home**
  (`--no-check-update -c <conf>/AdGuardHome.yaml -h 0.0.0.0 -w <work>`) au lieu
  de s'appuyer sur un `CMD` hérité — déclarer un `ENTRYPOINT` personnalisé dans
  un Dockerfile écarte le `CMD` de l'image de base ; la convention de ce dépôt
  est donc que le script de point d'entrée fournisse lui-même la commande
  complète.

Le tag de base est piloté par un ARG de build spécifique à l'application,
`ADGUARDHOME_VERSION`, et non par l'`APP_VERSION` générique (que la fondation
injecte dans `build_args` et qui l'emporterait sinon lors de la fusion).
AdGuard Home publie des tags de version semver simples (sans combinaisons
`latest-<suffix>`), de sorte que `application_version = "latest"` se résout
déjà correctement sur Docker Hub — la version de repli épinglée (`v0.107.63`)
existe uniquement pour qu'un nouveau build ne dépende jamais silencieusement
d'un tag mouvant.

Récupérer l'image construite :

```bash
gcloud artifacts docker images list <artifact-repo> --project "$PROJECT" --filter="package~adguardhome"
```

---

## 3. Stockage persistant (aucun amorçage de base de données) {#3-persistent-storage-no-database-bootstrap}

AdGuard Home n'a pas de base de données externe et n'a besoin d'aucun job de
schéma/initialisation au premier déploiement — la configuration
`initialization_jobs` d'`AdGuardHome_Common` transmet simplement ce que fournit
l'opérateur (vide par défaut). À la place, cette couche provisionne **deux**
buckets Cloud Storage et monte chacun comme un volume GCS Fuse distinct :

| Bucket (`name_suffix`) | Chemin de montage | Contenu |
|---|---|---|
| `conf` | `/opt/adguardhome/conf` | `AdGuardHome.yaml` — toute la configuration (filtres DNS, clients, serveurs en amont, compte administrateur), écrite par l'assistant de configuration du premier lancement |
| `work` | `/opt/adguardhome/work` | Journal des requêtes et base de statistiques |

Deux buckets/montages distincts sont utilisés — plutôt qu'un seul montage sur
`/opt/adguardhome` — car ce répertoire parent contient aussi le binaire
AdGuardHome lui-même ; y monter un volume GCS Fuse unique masquerait le binaire
et casserait le conteneur (`exec: no such file or directory`), la même classe
d'échec par masquage de volume que celle documentée pour d'autres applications
de ce catalogue qui placent un binaire et son répertoire de données au même
endroit.

Les deux entrées `gcs_volumes` sont déclarées avec `bucket_name = null`, de
sorte que la fondation résout automatiquement le nom réel du bucket en faisant
correspondre le `name` du volume avec le `name_suffix` de la sortie
`storage_buckets` — aucune chaîne de nom de bucket calculée à la main n'est
nécessaire (et aucune ne peut se désynchroniser).

Inspecter après le déploiement :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml
```

---

## 4. Comportement des sondes de santé {#4-health-probe-behaviour}

Les sondes par défaut ciblent `/` — AdGuard Home n'a pas de point de
terminaison de santé dédié, mais la racine de sa console d'administration
renvoie `200` aussi bien avant la configuration initiale (la page de
l'assistant de configuration) qu'après (la page de connexion ou le tableau de
bord). Les variantes Cloud Run et GKE utilisent toutes deux par défaut une
sonde de démarrage et de vivacité HTTP `GET /`.

---

## 5. Ce que cette couche ne fournit délibérément PAS {#5-what-this-layer-deliberately-does-not-provide}

- **Aucune exposition du port DNS.** Cette couche ne tente pas de mettre en
  place le port 53 — voir la note sur le périmètre en haut de ce document. Un
  `Service type=LoadBalancer` L4 brut pour le port 53 est possible en principe
  sur GKE (contrairement à Cloud Run, qui ne le permet pas du tout), mais il est
  hors périmètre pour cette première version.
- **Aucun secret.** Aucun jeton d'API, mot de passe administrateur ni clé de
  chiffrement n'est généré ou injecté. Le nom d'utilisateur et le mot de passe
  administrateur sont entièrement définis via l'assistant de configuration web
  du premier lancement d'AdGuard Home et stockés dans sa propre configuration
  YAML sur le volume persistant `conf`.
- **Pas de Redis, pas de file d'attente, pas de processus worker.** AdGuard Home
  est un binaire statique unique ; `enable_redis` n'a aucun effet pour cette
  application.

---

Pour la configuration propre à AdGuard Home destinée aux utilisateurs
(variables par groupe, sorties et exploration de chaque service depuis la
console et la CLI), consultez les guides de plateforme :
**[AdGuardHome_GKE](AdGuardHome_GKE.md)** et
**[AdGuardHome_CloudRun](AdGuardHome_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [AdGuard Home sur Google Cloud Run](AdGuardHome_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md) — cette configuration déployée sur GKE.
