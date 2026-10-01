---
title: "Kopia Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Kopia — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Kopia_Common.md @ 3055034 sha256:663e3e81c56f -->

# Kopia Common — Configuration applicative partagée {#kopia-common--shared-application-configuration}

`Kopia_Common` est la **couche applicative partagée** de Kopia. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Kopia sur laquelle s'appuie
[Kopia_GKE](Kopia_GKE.md). Les utilisateurs finaux ne configurent jamais cette
couche directement — elle n'a aucune entrée propre dans l'interface de
déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que
vous voyez dans la documentation des plateformes.

**GKE uniquement.** Le protocole de sauvegarde client-serveur de Kopia est
exclusivement **gRPC** — confirmé dans le code source (`repo/open.go`, qui appelle
toujours `openGRPCAPIRepository()`, sans repli REST) — et gRPC n'obtient un
véritable HTTP/2 que lorsque le propre serveur de Kopia le négocie via **TLS+ALPN**.
Le mode `--insecure` simple de Kopia est un simple `Server.Serve()` de `net/http`
sans enveloppe h2c (confirmé dans `cli/command_server_start.go`), si bien qu'il ne
peut parler que HTTP/1.1 sans TLS. Le GFE de Cloud Run termine toujours le HTTPS
public à sa propre périphérie et ne peut jamais transmettre jusqu'au conteneur un
flux TLS terminé par le conteneur — le TLS propre de Kopia, seul moyen pour lui
d'obtenir un véritable HTTP/2, y est donc structurellement inaccessible. Une variante
`Kopia_CloudRun` a été construite, déployée et testée en conditions réelles : l'API
de contrôle REST fonctionnait bien en HTTP/1.1 simple, mais chaque session de
snapshot réelle échouait avec une erreur de protocole gRPC, quelle que soit la valeur
de `container_protocol = h2c`. Elle a été retirée — impossible à corriger sur le plan
architectural au niveau du module, la même catégorie de lacune de plateforme que les
variantes Cloud Run retirées de RocketChat et LobeChat (voir la section « Common +
GKE only » de CLAUDE.md). Le Service `LoadBalancer` L4 simple de GKE transmet le TCP
brut directement, sans périphérie propre qui terminerait le HTTP, si bien que le TLS
auto-signé de Kopia atteint directement le client et que gRPC fonctionne de bout en
bout — vérifié en conditions réelles avec un véritable aller-retour
`kopia snapshot create` / `kopia snapshot list`.

Pour l'infrastructure qui provisionne et exécute effectivement Kopia, consultez le
guide de plateforme [Kopia_GKE](Kopia_GKE.md) et les guides des socles
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Kopia_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Wrapper léger `FROM kopia/kopia:${KOPIA_VERSION}` (Docker Hub) plus un point d'entrée cloud personnalisé ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Stockage des données | Fixe `database_type = "NONE"` — pas de Cloud SQL. Le dépôt de Kopia réside nativement dans le bucket Cloud Storage, et non sur un montage de système de fichiers | §Stockage dans le guide de la plateforme |
| Deux secrets indépendants | Génère `ADMIN_PASSWORD` (connexion au serveur) et `REPO_PASSWORD` (clé de chiffrement du contenu du dépôt) dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| TLS | Le certificat auto-signé de Kopia est généré une seule fois et persisté sous `/var/lib/kopia/tls/` d'un redémarrage à l'autre | §TLS dans le guide de la plateforme |
| Stockage objet | Déclare le bucket **Cloud Storage** `storage`, utilisé à la fois pour le dépôt natif ET pour le certificat TLS persisté | Sortie `storage_buckets` |
| Paramètres principaux | Fixe `container_port = 51515`, la mise à l'échelle à serveur unique (`max_instance_count = 1`) et la mise à l'échelle à zéro (`min_instance_count = 0`) | Comportement de l'application dans le guide de la plateforme |
| Contrôles de santé | Fournit des sondes de démarrage/vivacité TCP uniquement sur le port `51515` (Kopia n'a aucun point de terminaison HTTP non authentifié) | §Observabilité dans le guide de la plateforme |

---

## 2. Deux secrets indépendants dans Secret Manager {#2-two-independent-secrets-in-secret-manager}

Kopia est livré **sans aucun identifiant intégré**. Deux secrets sont générés
automatiquement et stockés dans Secret Manager, avec des caractéristiques de
rotation très différentes :

| Secret | Variable d'environnement | Contenu | Rotation |
|---|---|---|---|
| `secret-<prefix>-admin-password` | `ADMIN_PASSWORD` | Mot de passe aléatoire de 24 caractères. La connexion HTTP Basic Auth de l'opérateur du serveur — protège l'interface web **et** l'API de contrôle distincte (`KOPIA_SERVER_PASSWORD` / `KOPIA_SERVER_CONTROL_PASSWORD`) | Rotation possible sans risque à tout moment |
| `secret-<prefix>-repo-password` | `REPO_PASSWORD` | Mot de passe aléatoire de 32 caractères. Le mot de passe de chiffrement du contenu du dépôt lui-même (`KOPIA_PASSWORD`) — il dérive la clé qui déchiffre **chaque snapshot jamais écrit** | **Défini une seule fois, au premier déploiement. Ne jamais le faire tourner indépendamment du contenu réel du dépôt — il n'existe aucun chemin de rechiffrement pris en charge, et le faire rend définitivement orphelins tous les snapshots existants.** |

Récupérez l'un ou l'autre secret après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~repo-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

`enable_auto_password_rotation` ne cible jamais que le mot de passe d'un
utilisateur Cloud SQL géré par le socle (conditionné à `database_type != "NONE"`, et
Kopia fixe `database_type = "NONE"`), il ne peut donc structurellement pas toucher à
`REPO_PASSWORD` — mais une rotation manuelle/hors bande reste possible et doit être
évitée.

**`ADMIN_PASSWORD` seul n'autorise pas une session de snapshot client** — voir le
§4 ci-dessous pour le troisième mécanisme, non évident, par lequel un véritable
client CLI `kopia` s'authentifie réellement.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

L'image personnalisée enveloppe `kopia/kopia:<version>` (l'image officielle Docker
Hub) avec un point d'entrée shell léger (`entrypoint.sh`) :

- **ARG de version propre à l'application.** Le Dockerfile lit `KOPIA_VERSION` — et
  *non* l'`APP_VERSION` générique qu'injecte le socle (qui forcerait le tag à
  `latest`, qui n'est pas un véritable tag Docker Hub). `application_version = "latest"`
  se résout en la version épinglée `KOPIA_VERSION=0.23.1`.
- **S'exécute en tant que root**, comme l'image amont (`FROM ubuntu:jammy`, sans
  utilisateur non root dédié).
- **`KOPIA_CHECK_FOR_UPDATES=false`** évite un appel réseau inutile au démarrage —
  c'est l'image elle-même dont la version est épinglée.
- **Se connecte au dépôt adossé à GCS (ou le crée)** à chaque démarrage :
  ```bash
  kopia repository connect gcs --bucket="$KOPIA_GCS_BUCKET" --prefix="repository/"
  # falls back to:
  kopia repository create gcs --bucket="$KOPIA_GCS_BUCKET" --prefix="repository/"
  ```
- **Provisionne l'utilisateur serveur stocké dans le dépôt + les ACL** — voir §4.
- **Génère (une seule fois) ou réutilise le certificat TLS auto-signé** — voir §5.
- **Lance `kopia server start`** comme `exec` final.

---

## 4. Le troisième mécanisme — un utilisateur stocké dans le dépôt + des ACL {#4-the-third-mechanism--a-repository-stored-user--acls}

`KOPIA_SERVER_USERNAME`/`KOPIA_SERVER_PASSWORD` (issus de `ADMIN_PASSWORD`) ne
protègent que la couche HTTP Basic Auth du serveur — l'interface web et l'API de
contrôle distincte. Ils n'autorisent **pas** à eux seuls la session gRPC réelle
d'envoi/récupération de snapshots d'un client CLI `kopia` distant (confirmé en
conditions réelles : se connecter avec exactement ces identifiants sous une identité
client arbitraire renvoie toujours `PermissionDenied: access
denied`). Une véritable session client nécessite en outre :

1. **Un compte utilisateur stocké dans le dépôt** —
   `kopia server users add/set <user>@<host>`, vérifié par rapport à l'identité qui
   se connecte.
2. **Une ACL accordant l'accès à cet utilisateur** — `kopia server acl enable`
   installe la règle par défaut propre à Kopia : tout `user@host` authentifié obtient
   un accès complet en lecture/écriture aux snapshots de son propre nom d'hôte.

Le point d'entrée exécute ces deux commandes directement sur le dépôt (et non via
l'API HTTP) et **avant** `kopia server start`, afin que le serveur prenne en compte
l'état courant dès son chargement initial — sans délai de mise en cache. Les deux
commandes échouent lors d'une seconde exécution (l'idempotence n'est pas intégrée à
la CLI), si bien qu'un repli add-ou-set / enable-ou-ignorer rend l'opération
auto-réparatrice à chaque démarrage :

```
SERVER_USER="${ADMIN_USERNAME}@kopia"
kopia server users add "${SERVER_USER}" --user-password="${REPO_PASSWORD}"   # or `set` if it already exists
kopia server acl enable                                                       # or skip if already enabled
```

**CRITIQUE ET CONTRE-INTUITIF — confirmé dans le code source**
(`cli/command_repository_connect_server.go` + `internal/server/grpc_session.go`) :
`kopia repository connect server` n'a **aucun flag distinct pour le mot de passe de
l'utilisateur serveur**. Son unique entrée de mot de passe (`-p` / `KOPIA_PASSWORD`)
est envoyée telle quelle comme identifiant de session gRPC, vérifié par
`authenticateGRPCSession()` par rapport au mot de passe de l'utilisateur stocké dans
le dépôt. C'est pourquoi l'utilisateur de dépôt ci-dessus est provisionné avec
`REPO_PASSWORD`, et **non** `ADMIN_PASSWORD` — un véritable client s'authentifie avec
`--password=$REPO_PASSWORD` (dont il a de toute façon besoin pour déchiffrer le
contenu), et cette même valeur sert aussi d'identifiant de session :

```bash
kopia repository connect server \
  --url=https://<external-ip>:<service-port> \
  --server-cert-fingerprint=<sha256-fingerprint> \
  --password=<REPO_PASSWORD> \
  --override-username=admin --override-hostname=kopia
```

`--password=<ADMIN_PASSWORD>` paraît plausible ici — c'*est* conceptuellement
l'identifiant avec lequel l'opérateur « se connecte » — mais fait échouer chaque
session avec `PermissionDenied: access denied`, confirmé en conditions réelles.

---

## 5. TLS — généré une fois, réutilisé pour toujours {#5-tls--generated-once-reused-forever}

Le Service `LoadBalancer` L4 simple de GKE transmet le TCP brut directement, sans
périphérie propre qui terminerait le HTTP (contrairement au GFE de Cloud Run), si
bien que Kopia doit terminer lui-même le TLS — ce qui est d'ailleurs le seul moyen
pour lui d'obtenir un véritable HTTP/2 pour sa session gRPC (voir l'introduction
ci-dessus). Le point d'entrée génère un certificat auto-signé **une seule fois**, au
premier démarrage, et le persiste sous `/var/lib/kopia/tls/{cert,key}.pem` (un
chemin monté via GCS FUSE — voir §6) :

- **Premier démarrage :** aucun fichier de certificat persisté n'existe → `kopia server start
  --tls-generate-cert --tls-cert-file=... --tls-key-file=...`. L'empreinte
  SHA256 que chaque client distant doit épingler
  (`kopia repository connect server --server-cert-fingerprint=...`) s'affiche **une
  seule fois**, sur stderr, au moment exact de la génération.
- **Chaque démarrage suivant :** les fichiers de certificat persistés sont trouvés → `kopia server
  start --tls-cert-file=... --tls-key-file=...`, **sans** `--tls-generate-cert` —
  Kopia refuse lui-même de régénérer un certificat lorsqu'un fichier existe déjà
  (confirmé dans `maybeGenerateTLS()` de `cli/command_server_tls.go`), et
  régénérer à chaque redémarrage obligerait chaque client distant à approuver à
  nouveau une nouvelle empreinte.

Récupérez ou recalculez l'empreinte à tout moment (GKE donne un véritable accès
shell, contrairement à Cloud Run) :

```bash
# From the pod's first-boot logs:
kubectl logs <pod> -c kopia | grep -A2 -i fingerprint

# Recompute directly, any time:
kubectl exec <pod> -c kopia -- openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
```

---

## 6. Stockage objet — un bucket, deux rôles indépendants {#6-object-storage--one-bucket-two-independent-roles}

Un seul bucket GCS `storage` est déclaré ici et provisionné par le socle ; il
remplit **simultanément deux rôles totalement distincts et sans chevauchement** :

| Rôle | Chemin d'accès | Préfixe d'objet | Objectif |
|---|---|---|---|
| Données du dépôt | Le client natif de l'API GCS de Kopia (authentifié via ADC), **et non** un montage de système de fichiers | `repository/` | Chaque bloc de snapshot chiffré et dédupliqué que Kopia a jamais écrit |
| Persistance du certificat TLS | Montage GCS FUSE sur `/var/lib/kopia` | `tls/` | La paire auto-signée `cert.pem`/`key.pem`, persistée d'un redémarrage du pod à l'autre |

Les deux rôles n'interfèrent jamais : le dépôt est accessible exclusivement via le
client SDK GCS propre à Kopia sous le préfixe `repository/`, tandis que le petit
montage FUSE à faible trafic ne touche jamais que le préfixe `tls/`. Listez le
bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls -r gs://<storage-bucket>/repository/ | head    # native repository data
gcloud storage ls gs://<storage-bucket>/tls/                     # persisted TLS cert
```

`enable_gcs_storage_volume` (par défaut `true`) contrôle le montage FUSE ; il est
automatiquement défini à `false` par `Kopia_GKE` lorsque
`stateful_pvc_enabled = true`, pour éviter un double montage sur le même chemin —
bien qu'un PVC ne soit **pas recommandé** pour ce module (voir le
[guide Kopia_GKE](Kopia_GKE.md)).

---

## 7. Serveur unique, compatible avec la mise à l'échelle à zéro {#7-single-server-scale-to-zero-safe}

`max_instance_count` doit rester à **1** — la maintenance propre du dépôt de Kopia
(GC/compactage) suppose qu'un seul serveur possède le dépôt à un instant donné ; des
serveurs concurrents se disputeraient leurs exécutions de maintenance.
`min_instance_count` vaut **0** par défaut (mise à l'échelle à zéro) — le dépôt de
Kopia réside nativement dans Cloud Storage, et non sur un volume local à l'instance,
si bien qu'un démarrage à froid se contente de se reconnecter (et, uniquement lors
du tout premier démarrage, de régénérer le certificat TLS).

---

## 8. Comportement des sondes de santé {#8-health-probe-behaviour}

Les sondes par défaut sont des sondes **TCP**, et non HTTP, sur le port `51515` :

- **Sonde de démarrage** — TCP, délai initial de 15 secondes, période de
  10 secondes, fenêtre de 10 tentatives.
- **Sonde de vivacité** — TCP, délai initial de 30 secondes, période de
  30 secondes, fenêtre de 3 tentatives.

Chaque point de terminaison de l'API du serveur Kopia exige une authentification —
confirmé dans le code source, il n'existe aucune route de santé/ping non
authentifiée — si bien qu'une sonde sur un chemin HTTP renvoie toujours 401 et que le
pod ne deviendrait jamais Ready alors même que le serveur a bien démarré. Une sonde
TCP sur le port d'écoute est réellement fiable : au moment où `kopia server start`
se lie au port, l'étape de connexion ou de création du dépôt a déjà réussi.

---

Pour la configuration de Kopia destinée aux utilisateurs (variables par groupe,
outputs, et comment explorer chaque service depuis la console et la CLI), consultez
le guide de la plateforme : **[Kopia_GKE](Kopia_GKE.md)**. Il n'existe pas de
`Kopia_CloudRun` — voir la note en tête de ce guide pour comprendre pourquoi Cloud
Run ne peut pas prendre en charge le protocole de snapshot gRPC de Kopia.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Kopia sur GKE Autopilot](Kopia_GKE.md) — cette configuration déployée sur GKE.
