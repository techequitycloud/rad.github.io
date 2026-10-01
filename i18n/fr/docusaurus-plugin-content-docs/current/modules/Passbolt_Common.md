---
title: "Passbolt Common — configuration applicative partagée"
description: "Référence de la configuration partagée du module Passbolt — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Passbolt_Common.md @ 3055034 sha256:1778e732be66 -->

# Passbolt Common — configuration applicative partagée {#passbolt-common--shared-application-configuration}

`Passbolt_Common` est la **couche applicative partagée** de Passbolt. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Passbolt sur laquelle
s'appuient [Passbolt_GKE](Passbolt_GKE.md) et [Passbolt_CloudRun](Passbolt_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là
où c'est important. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous
voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Passbolt, consultez
les guides des plateformes ([Passbolt_GKE](Passbolt_GKE.md),
[Passbolt_CloudRun](Passbolt_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Passbolt_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | L'image officielle `passbolt/passbolt`, déployée telle quelle — réellement préconstruite, sans Dockerfile personnalisé ni étape Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL** (`MYSQL_8_0`) comme seul moteur pris en charge, avec des noms de variables d'environnement distincts `DATASOURCES_DEFAULT_*` | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit une chaîne de jobs d'initialisation en 2 étapes — `db-init` → `admin-bootstrap` | Sortie `initialization_jobs` |
| État cryptographique | Deux volumes GCS spécialisés (`storage` sur `/etc/passbolt/gpg`, `jwt` sur `/etc/passbolt/jwt`) contenant la paire de clés GPG du serveur et la paire de clés JWT générées par l'application | Sortie `storage_buckets` |
| Secrets | **Aucun.** Passbolt n'a aucun secret propre généré par Terraform — `secret_ids`/`secret_values` valent toujours `{}` | §Secrets ci-dessous |
| Génération d'URL HTTPS | Injecte statiquement `HTTPS = "on"` pour que le `bootstrap.php` de Passbolt génère des URL `https://` malgré un TLS terminé en périphérie | `config.environment_variables` |
| Contrôles d'état | Fournit la sonde de démarrage/vivacité par défaut ciblant `GET /healthcheck/status.json` | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur — réellement préconstruite, sans wrapper d'entrypoint {#2-container-image--genuinely-prebuilt-no-entrypoint-wrapper}

Contrairement à de nombreux modules applicatifs de ce catalogue qui enveloppent
leur image amont dans un `entrypoint.sh` personnalisé pour faire le lien avec les
conventions de variables d'environnement de la plateforme, `Passbolt_Common`
déploie l'image officielle `passbolt/passbolt` **telle quelle** :

```hcl
container_image        = "passbolt/passbolt"
image_source            = "prebuilt"
container_build_config = { enabled = false, ... }
```

Il n'y a ni Dockerfile personnalisé ni étape Cloud Build. Les modules applicatifs
font plutôt correspondre la convention standard de la plateforme `DB_HOST`/`DB_USER`/`DB_NAME`/`DB_PASSWORD`
aux noms de variables d'environnement CakePHP/PDO distincts propres à Passbolt,
grâce au mécanisme d'alias du socle :

```hcl
db_host_env_var_name     = "DATASOURCES_DEFAULT_HOST"
db_user_env_var_name     = "DATASOURCES_DEFAULT_USERNAME"
db_name_env_var_name     = "DATASOURCES_DEFAULT_DATABASE"
db_password_env_var_name = "DATASOURCES_DEFAULT_PASSWORD"
```

ce qui a été vérifié dans le fichier `/passbolt/env.sh` de l'éditeur, qui lit
exactement ces noms.

---

## 3. Moteur de base de données {#3-database-engine}

Passbolt nécessite **MySQL** ; le moteur est fixé à `MYSQL_8_0` et les autres
moteurs ne sont pas pris en charge (le schéma CakePHP de Passbolt est
exclusivement MySQL). Les deux modules applicatifs exécutent le script
`db-init.sh` partagé par tout le catalogue (`mysql:8.0-debian`), compatible
`caching_sha2_password` — il détecte si un socket Unix du Cloud SQL Auth Proxy
est disponible et, sinon, se rabat sur TCP via l'IP privée ; il crée le rôle et
la base de données, accorde les privilèges et vérifie que l'utilisateur
applicatif peut réellement se connecter avant de se terminer.

---

## 4. La paire de clés GPG du serveur et la paire de clés JWT — un état natif de l'éditeur, autoréparateur {#4-the-gpg-server-keypair-and-jwt-keypair--self-healing-vendor-native-state}

C'est l'exigence d'infrastructure la plus singulière de Passbolt dans ce
catalogue, et la raison pour laquelle son processus d'amorçage ne ressemble en
rien à celui d'une application classique de type WordPress/Laravel. Vérifié en
lisant le code source `/passbolt/entrypoint.sh` de l'image `passbolt/passbolt`
réelle :

1. **La paire de clés GPG du serveur.** L'entrypoint de l'éditeur génère
   `/etc/passbolt/gpg/serverkey.asc` et
   `/etc/passbolt/gpg/serverkey_private.asc` au premier démarrage **uniquement si
   ces fichiers n'existent pas déjà**, puis les réutilise à chaque démarrage
   suivant. `Passbolt_Common` ne génère pas cette clé — il se contente de doter
   ce chemin d'un volume persistant.
2. **La paire de clés JWT.** Même schéma autoréparateur, dans `/etc/passbolt/jwt`.

Les deux sont montées comme des volumes **distincts et à portée restreinte** —
`storage` sur `/etc/passbolt/gpg`, `jwt` sur `/etc/passbolt/jwt` — et
délibérément pas sur l'ensemble du répertoire `/etc/passbolt`, ce qui masquerait
les fichiers de configuration/PHP intégrés (`app.php`, `bootstrap.php`, `routes.php`)
qui se trouvent directement sous `/etc/passbolt` dans l'image. C'est le même
piège de masquage par un volume que celui déjà documenté dans ce catalogue pour
Cloudreve, où le montage d'un volume bloc vierge sur un répertoire contenant à la
fois le binaire de l'application et ses données masque le binaire.

```hcl
gcs_volumes = tolist(concat(
  [for v in var.gcs_volumes : { ... }],   # operator-supplied extras
  [
    { name = "storage", mount_path = "/etc/passbolt/gpg", mount_options = [...uid=33...] },
    { name = "jwt",      mount_path = "/etc/passbolt/jwt", mount_options = [...uid=33...] },
  ]
))
```

### Spécificité GKE : l'UID de GCS Fuse doit correspondre à l'utilisateur d'exécution réel {#gke-specific-the-gcs-fuse-uid-must-match-the-actual-runtime-user}

Même si le processus principal du conteneur de l'image `passbolt/passbolt`
s'exécute en tant que root (aucune directive `USER` dans l'image), la fonction
`gpg_gen_key()` de l'entrypoint de l'éditeur effectue l'étape d'export de la clé
en tant que `su ... www-data` (uid=33/gid=33) — vérifié en lisant
`/passbolt/entrypoint.sh`. Le pilote GCS Fuse CSI de GKE, contrairement à
l'intégration gcsfuse propre à Cloud Run, ne fournit pas par défaut un montage
accessible en écriture à un UID non root. Sans surcharge explicite, `www-data`
obtient `EACCES: permission denied` en écrivant les fichiers de clés GPG/JWT au
premier démarrage. Les deux volumes définissent donc :

```hcl
mount_options = [
  "implicit-dirs",
  "stat-cache-ttl=60s",
  "type-cache-ttl=60s",
  "uid=33",
  "gid=33",
  "file-mode=0664",
  "dir-mode=0775",
]
```

C'est le deuxième cas confirmé de cette *catégorie* exacte de bug trouvé dans ce
catalogue le même jour — une fois pour une application Node en uid 1000, une
fois pour ce cas PHP/`www-data` en uid 33. La leçon générale : vérifiez l'UID
d'exécution réel du processus qui écrit dans un chemin monté via GCS Fuse, et pas
seulement le `USER` déclaré de l'image.

---

## 5. La chaîne de jobs d'initialisation en 2 étapes {#5-the-2-stage-initialization-job-chain}

1. **`db-init`** (`mysql:8.0-debian`, `depends_on_jobs = []`) — le script
   d'initialisation MySQL partagé par tout le catalogue (voir §3).

2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`,
   `depends_on_jobs = ["db-init"]`, monte les volumes `storage` et `jwt`) —
   enregistre le compte administrateur initial. Ce job existe précisément parce
   que les Cloud Run Jobs et les Jobs Kubernetes invoquent **directement** la
   `command`/les `args` d'un conteneur, en contournant entièrement la chaîne
   `/docker-entrypoint.sh` de l'éditeur. Un `cake passbolt register_user` naïf
   sur un conteneur fraîchement provisionné échoue avec une erreur interne 500,
   car la paire de clés GPG du serveur (normalement générée pendant la séquence
   de démarrage de l'entrypoint de l'éditeur) n'existe pas encore, et le schéma
   n'a pas non plus été installé.

   Le job reproduit donc la partie pertinente de la séquence de démarrage réelle
   de l'éditeur :
   ```bash
   source /passbolt/entrypoint.sh
   source /passbolt/env.sh
   source /passbolt/deprecated_paths.sh

   manage_docker_env
   check_deprecated_paths

   mkdir -p "$passbolt_config/gpg"
   if [ ! -f "$gpg_private_key" ] || [ ! -f "$gpg_public_key" ]; then
     gpg_gen_key
     gpg_import_key
   else
     gpg_import_key
   fi

   if [ ! -f "$ssl_key" ] && [ ! -L "$ssl_key" ] && [ ! -f "$ssl_cert" ] && [ ! -L "$ssl_cert" ]; then
     gen_ssl_cert
   fi

   install    # also handles JWT key generation and schema install/migrate

   su -c '/usr/share/php/passbolt/bin/cake passbolt register_user \
     -u "<admin_email>" -f "<admin_first_name>" -l "<admin_last_name>" -r admin' \
     -s /bin/bash www-data
   ```

   Chaque étape a été vérifiée dans le code source réel `/passbolt/entrypoint.sh`
   de l'éditeur, et non devinée. Le job est idempotent — `gpg_gen_key`/`install()`
   ne font rien une fois que les clés et le schéma existent déjà depuis une
   exécution précédente. Point essentiel, `register_user` est exécuté **sans**
   l'option `-q`/silencieuse, afin que l'URL de configuration à usage unique
   (`https://<host>/setup/start/<user-id>/<token>`) soit affichée sur stdout et
   arrive dans Cloud Logging.

---

## 6. Secrets — la seule sortie de secrets réellement vide de ce catalogue {#6-secrets--the-one-genuinely-empty-secrets-output-in-this-catalog}

```hcl
output "secret_ids"    { value = {} }
output "secret_values" { value = {} }
```

Le modèle de sécurité de Passbolt exige que le **client** — une extension de
navigateur — génère localement sa propre paire de clés GPG et son mot de passe
maître lors de la configuration. Il n'y a aucun mot de passe côté serveur que
Terraform pourrait initialiser, ni aucune clé de chiffrement applicative
comparable à une `APP_KEY` Laravel ou aux sels WordPress. Les deux éléments
d'état cryptographique côté serveur qui existent *bel et bien* (la paire de clés
GPG du serveur et la paire de clés JWT) sont générés par l'entrypoint de
l'éditeur au premier démarrage, et non par Terraform — voir §4.

Le processus d'amorçage vu par l'opérateur est donc réellement différent de
celui de presque tous les autres modules applicatifs de ce catalogue : il n'y a
aucun identifiant à récupérer dans Secret Manager après le déploiement. Le seul
produit du job `admin-bootstrap` est l'URL de configuration à usage unique
affichée dans les journaux.

---

## 7. Variables d'environnement {#7-environment-variables}

Configuration statique définie dans `config.environment_variables` :

| Nom | Valeur |
|---|---|
| `HTTPS` | `"on"` — toujours défini. Voir §Vue d'ensemble dans les guides des plateformes pour en connaître la raison. |
| `APP_FULL_BASE_URL` | `var.service_url`, uniquement s'il n'est pas vide. |

---

## 8. Buckets de stockage {#8-storage-buckets}

| Bucket (`name_suffix`) | Chemin de montage | Rôle |
|---|---|---|
| `storage` | `/etc/passbolt/gpg` | Paire de clés GPG du serveur générée par l'application |
| `jwt` | `/etc/passbolt/jwt` | Paire de clés JWT générée par l'application |

Les deux utilisent la classe de stockage `STANDARD`, `force_destroy = true`,
`public_access_prevention = "enforced"`.

---

## 9. Sorties {#9-outputs}

| Sortie | Description |
|---|---|
| `config` | Objet complet de configuration applicative destiné au module socle |
| `secret_ids` | `{}` — toujours vide. |
| `secret_values` | `{}` — toujours vide (sensible). |
| `storage_buckets` | `[{ name_suffix = "storage", ... }, { name_suffix = "jwt", ... }]` |
| `path` | Chemin du module (utilisé pour résoudre `scripts_dir`) |

---

Pour les détails de déploiement, les valeurs par défaut et les regroupements de
variables propres à chaque plateforme, voir [Passbolt_CloudRun](Passbolt_CloudRun.md)
et [Passbolt_GKE](Passbolt_GKE.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Passbolt sur GKE Autopilot](Passbolt_GKE.md) — cette configuration déployée sur GKE.
