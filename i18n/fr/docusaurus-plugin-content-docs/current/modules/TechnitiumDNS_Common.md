---
title: "TechnitiumDNS Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module TechnitiumDNS — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/TechnitiumDNS_Common.md @ 3055034 sha256:9f821737055c -->

# TechnitiumDNS Common — Configuration applicative partagée {#technitiumdns-common--shared-application-configuration}

`TechnitiumDNS_Common` est la **couche applicative partagée** de Technitium DNS Server. Elle n'est pas
déployée seule ; elle fournit la configuration propre à TechnitiumDNS sur laquelle s'appuient à la fois
[TechnitiumDNS_GKE](TechnitiumDNS_GKE.md) et [TechnitiumDNS_CloudRun](TechnitiumDNS_CloudRun.md), afin
que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous
voyez dans la documentation des plateformes.

> **Rappel sur le périmètre :** cette couche (et les deux variantes de plateforme qui s'appuient sur
> elle) ne déploie que la console d'administration web + l'API REST de Technitium (port 5380/HTTP). Le
> protocole de résolveur DNS (port 53/udp+tcp) n'est jamais exposé — consultez les guides des
> plateformes pour l'explication complète.

Pour l'infrastructure qui provisionne et exécute réellement TechnitiumDNS, consultez les guides des
plateformes ([TechnitiumDNS_GKE](TechnitiumDNS_GKE.md), [TechnitiumDNS_CloudRun](TechnitiumDNS_CloudRun.md))
et les guides des fondations ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par TechnitiumDNS_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | L'image officielle `technitium/dns-server`, déployée **sans modification** (`image_source = "prebuilt"`, sans Dockerfile personnalisé) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — `database_type = "NONE"`. Les zones, paramètres et journaux sont des fichiers plats locaux sous `/etc/dns` | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | **Aucune** — aucun job `db-init` n'est injecté. `initialization_jobs` est transmis sans modification (vide par défaut) | Sortie `initialization_jobs` |
| Secrets cryptographiques | Génère `DNS_SERVER_ADMIN_PASSWORD` (24 caractères alphanumériques) et le stocke dans **Secret Manager** | Sortie `secret_ids` |
| Stockage d'objets | Déclare le bucket Cloud Storage **config**, monté sur `/etc/dns` via GCS FUSE | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement TechnitiumDNS de base : port du service web (5380) et chemin des journaux redirigé à l'intérieur du volume monté | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde par défaut de démarrage/liveness ciblant `/` | §Observabilité dans les guides des plateformes |

La forme de la sortie `config` (l'objet utilisé par les deux variantes) est fixée ici :
`container_port = 5380`, `database_type = "NONE"`, `image_source = "prebuilt"`,
`container_build_config.enabled = false`, `enable_image_mirroring = true`, et un ensemble
`initialization_jobs` vide.

---

## 2. Un secret, pas de base de données, un bucket {#2-one-secret-no-database-one-bucket}

Contrairement à la plupart des modules applicatifs, `TechnitiumDNS_Common` ne provisionne **aucune**
instance Cloud SQL et ne génère qu'un seul identifiant d'initialisation :

- **`DNS_SERVER_ADMIN_PASSWORD`** — un mot de passe alphanumérique de 24 caractères généré avec
  `random_password`, stocké dans Secret Manager et injecté comme variable d'environnement secrète à
  chaque démarrage du conteneur. Technitium **ne l'applique qu'au tout premier démarrage** (lorsqu'aucun
  `auth.config` n'existe encore dans `/etc/dns`) — il initialise le compte `admin` initial de la console
  web/API. À chaque redémarrage ou redéploiement ultérieur, le `auth.config` existant sur le volume
  persisté prévaut et la variable d'environnement est ignorée.
- `database_type = "NONE"` — aucun Cloud SQL for PostgreSQL/MySQL n'est créé. Les variables liées à la
  base de données qui apparaissent dans les guides des plateformes (`db_name`, `db_user`, `enable_cloudsql_volume`,
  `database_password_length`, …) sont sans effet, sauf si vous optez délibérément pour une base de
  données externe, ce dont TechnitiumDNS n'a pas besoin.
- `storage_buckets` déclare exactement un bucket (`name_suffix = "config"`), monté sur `/etc/dns` afin
  que les zones, les paramètres et les journaux survivent aux redémarrages et aux redéploiements du
  conteneur.

Récupérez le mot de passe administrateur après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 3. Image de conteneur — préconstruite, sans Dockerfile personnalisé {#3-container-image--prebuilt-no-custom-dockerfile}

`TechnitiumDNS_Common` déploie l'image officielle `technitium/dns-server` **sans modification** :

- `image_source = "prebuilt"`, `container_build_config.enabled = false` — aucune étape Cloud Build ne
  s'exécute ; l'image est récupérée et (optionnellement) répliquée telle quelle dans Artifact Registry.
- **Vérifié via un `docker run` local :** l'image du fournisseur démarre proprement sans problème de
  shell ni de point d'entrée, respecte `DNS_SERVER_ADMIN_PASSWORD` et `DNS_SERVER_DOMAIN` au premier
  démarrage, et sert la racine de sa console (`/`) sans authentification avec HTTP 200 (~600KB de HTML
  de console, pas un corps vide) — aucun point d'entrée wrapper n'est nécessaire, contrairement à la
  plupart des modules construits sur mesure de ce dépôt.
- `enable_image_mirroring = true` — réplique `technitium/dns-server` dans l'Artifact Registry du projet
  pour éviter les limites de débit de Docker Hub en production.

---

## 4. Paramètres de base de l'application et stockage persistant {#4-core-application-settings-and-persistent-storage}

`TechnitiumDNS_Common` établit l'environnement TechnitiumDNS de base afin que le serveur démarre
correctement dès le premier démarrage :

- **`DNS_SERVER_WEB_SERVICE_HTTP_PORT = "5380"`** — le port d'écoute de la console web, qui correspond à
  `container_port = 5380`.
- **`DNS_SERVER_LOG_FOLDER_PATH = "/etc/dns/logs"`** — les journaux sont redirigés à l'intérieur du
  volume `/etc/dns` monté, afin que la journalisation continue de fonctionner sous le système de fichiers
  racine en lecture seule de Cloud Run (le chemin de journaux par défaut du fournisseur,
  `/var/log/technitium/dns`, ne se trouve PAS sur un volume monté et l'écriture y échouerait).

**Stockage persistant.** Un volume GCS FUSE (bucket `name_suffix = "config"`) est monté par défaut sur
`/etc/dns` ; il couvre les fichiers de zone, le JSON de configuration, la base d'authentification et les
journaux (redirigés). Sur GKE, définissez `stateful_pvc_enabled = true` pour utiliser à la place un
véritable PVC bloc de StatefulSet sur le même chemin — `TechnitiumDNS_GKE` désactive alors
automatiquement le volume GCS pour éviter un double montage, selon le même modèle que celui utilisé par
`Chroma_GKE`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut de démarrage et de liveness ciblent **`/`** — la page racine de la console web de
Technitium, qui renvoie HTTP 200 avec le HTML complet de la console dès que le serveur se lie à son port,
sans authentification requise. Comme Technitium n'a aucune migration de base de données à exécuter, il
devient sain quelques secondes après le démarrage ; la fenêtre de démarrage (délai initial de
20 secondes, 30 tentatives) constitue une marge prudente plutôt qu'une nécessité.

---

## 6. Périmètre — console web uniquement, pas de résolveur DNS {#6-scoping--web-console-only-no-dns-resolver}

Cette couche (et les deux variantes de plateforme) déploie **uniquement** la console d'administration
web + l'API REST de Technitium. La fonction principale de résolveur DNS de Technitium (répondre aux
requêtes sur le port 53/udp+tcp) n'est jamais exposée : Cloud Run n'offre qu'un ingress HTTP(S), sans
écouteur TCP/UDP brut, et la variante GKE utilise le modèle Gateway HTTP(S) standard plutôt qu'un
LoadBalancer L4 brut sur le port 53. Il s'agit d'un choix de périmètre délibéré et permanent — la même
catégorie de limitation liée aux frontières de la plateforme que celle déjà documentée pour les modules
Headscale, Kopia et RocketChat de ce dépôt.

---

Pour la configuration propre à TechnitiumDNS destinée aux utilisateurs (variables par groupe, sorties et
exploration de chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[TechnitiumDNS_GKE](TechnitiumDNS_GKE.md)** et **[TechnitiumDNS_CloudRun](TechnitiumDNS_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [TechnitiumDNS sur Google Cloud Run](TechnitiumDNS_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md) — cette configuration déployée sur GKE.
