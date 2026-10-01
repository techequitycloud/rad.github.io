---
title: "Monica Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Monica — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Monica_Common.md @ 3055034 sha256:25d9dfc3cc9f -->

# Monica Common — Configuration applicative partagée {#monica-common--shared-application-configuration}

`Monica_Common` est la **couche applicative partagée** de Monica. Elle n'est pas déployée seule ; elle fournit la configuration propre à Monica sur laquelle s'appuient à la fois [Monica_GKE](Monica_GKE.md) et [Monica_CloudRun](Monica_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Monica, consultez les guides des plateformes ([Monica_GKE](Monica_GKE.md), [Monica_CloudRun](Monica_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Monica_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère l'`APP_KEY` Laravel (`base64:` + 32 octets aléatoires) et le stocke dans **Secret Manager** | Injecté automatiquement sous la forme `APP_KEY` ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Récupère directement depuis Docker Hub l'**image Apache officielle `monica:<version>`** — précompilée, sans étape Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme moteur par défaut | Section Base de données des guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** des téléversements (`monica-uploads`) | Sortie `storage_buckets` |
| Paramètres de base | Définit le socle de variables d'environnement natives de Laravel : `DB_CONNECTION`, `DB_PORT`, `APP_URL`, ainsi que la correspondance des noms de variables `DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Déclare sa propre sonde de démarrage TCP par défaut (ciblant `/`) et sa sonde de vivacité HTTP (ciblant `/status`), mais les deux variantes de plateforme remplacent cette valeur par défaut — voir la section 6 | Section Observabilité des guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_KEY`** — Monica est une application Laravel et nécessite un `APP_KEY` de la forme `base64:<base64 of 32 random bytes>`. `Monica_Common` génère 32 octets aléatoires, les encode en base64 et stocke la valeur préfixée par `base64:` dans le secret `secret-<resource-prefix>-monica-app-key`. Laravel utilise cette clé pour le chiffrement AES-256-CBC de toutes les colonnes chiffrées de la base de données et pour la signature des cookies/sessions. **Sa rotation après le premier démarrage corrompt définitivement tous les champs chiffrés** (et invalide toutes les sessions) — le texte chiffré ne peut pas être déchiffré avec une nouvelle clé.

Récupérez le secret après le déploiement :

```bash
# List the APP_KEY secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret figure dans les sorties du déploiement de la plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Monica nécessite **MySQL** ; `Monica_Common` fixe le moteur à `database_type = "MYSQL_8_0"`. Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec `mysql:8.0-debian` et, de manière idempotente :

1. Localise la connexion Cloud SQL — le socket Unix de l'Auth Proxy sous `/cloudsql` lorsqu'un volume de socket est monté, sinon TCP via l'adresse IP privée de l'instance (`DB_IP`),
2. Attend que le port MySQL `3306` soit joignable (chemin TCP),
3. Crée l'utilisateur applicatif (ou réaligne son mot de passe) (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Crée la base de données applicative (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur la base de données à l'utilisateur applicatif,
6. Vérifie que l'utilisateur applicatif peut réellement se connecter (ce qui détecte tôt les incohérences de mot de passe ou de droits et préchauffe le cache d'authentification `caching_sha2_password` de MySQL 8),
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (via le point de terminaison d'administration `quitquitquit`) afin que le job se termine correctement.

Le job peut être réexécuté sans risque (`execute_on_apply = true`, `max_retries = 3`). **Il n'existe pas de job de migration distinct** — le point d'entrée de l'image officielle Monica exécute automatiquement `php artisan migrate --force` au démarrage du conteneur, de sorte que le schéma est créé et mis à niveau au premier démarrage une fois que `db-init` a provisionné la base de données et l'utilisateur.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

Monica est déployée à partir de l'**image officielle en amont** — `monica:<application_version>` (la variante Apache) récupérée directement depuis la bibliothèque Docker Hub. La source de l'image est `prebuilt` (`image_source = "prebuilt"`) : il n'y a donc **ni étape Cloud Build, ni point d'entrée personnalisé** ; la plateforme exécute l'image du fournisseur telle quelle. La variante Apache sert l'application sur le **port 80** et exécute `php artisan migrate --force` au démarrage du conteneur.

Comme l'image est précompilée, la variante de plateforme doit transmettre `container_image_source = "prebuilt"` au socle (qui vaut sinon `custom` par défaut et ferait pointer le service vers un chemin Artifact Registry jamais construit). `Monica_CloudRun` et `Monica_GKE` le font tous deux.

---

## 5. Paramètres applicatifs de base {#5-core-application-settings}

Monica est une application Laravel et lit les variables d'environnement **natives de Laravel**. `Monica_Common` définit la configuration statique non dérivée et s'appuie sur la correspondance `db_*_env_var_name` de la variante de plateforme pour les valeurs propres au déploiement :

- **`DB_CONNECTION = "mysql"`** et **`DB_PORT = "3306"`** — sélectionnent le pilote et le port MySQL.
- **`DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE`** — le socle les injecte à partir du rôle, de la base de données et du mot de passe généré propres au locataire, car le `main.tf` de la variante définit `db_user_env_var_name = "DB_USERNAME"`, `db_password_env_var_name = "DB_PASSWORD"` et `db_name_env_var_name = "DB_DATABASE"`. Ne codez jamais en dur les noms courts — le rôle et la base de données réels sont préfixés par le locataire.
- **`DB_HOST`** — le socle injecte l'adresse IP privée de Cloud SQL sur Cloud Run, et `Monica_GKE` la remplace par `127.0.0.1` (le sidecar Cloud SQL Auth Proxy). MySQL via le chemin TCP sur l'adresse IP privée ne nécessite pas de SSL (le modèle SnipeIT/Matomo).
- **`APP_URL`** — défini sur l'URL publique prévue du service afin que Laravel construise des liens absolus corrects et que la redirection `/` → configuration/inscription aboutisse sur le bon hôte.
- **`REDIS_HOST` / `REDIS_PORT`** — ajoutés uniquement lorsque `enable_redis = true` ; lorsque l'hôte est laissé vide, le socle injecte l'adresse IP de la VM du serveur NFS (qui héberge aussi Redis).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

La variable `liveness_probe` propre à `Monica_Common` cible par défaut le point de terminaison de santé JSON non authentifié de Monica, `/status`. Cependant, **cette valeur par défaut est du code mort en pratique** : `Monica_CloudRun` et `Monica_GKE` déclarent tous deux leurs propres variables `startup_probe`/`liveness_probe` (chacune avec `path = "/"` par défaut) et les transmettent à `Monica_Common` à chaque appel, de sorte que la valeur par défaut `/status` définie ici n'est jamais réellement appliquée par l'une ou l'autre des variantes déployées. Ce qui est réellement livré :

- **Sonde de démarrage** — **TCP** sur `/` (écoute du port) avec un `failure_threshold` généreux afin que le démarrage d'Apache au premier lancement et `php artisan migrate --force` aient le temps de se terminer avant que le trafic ne soit acheminé.
- **Sonde de vivacité** — **HTTP** `GET /` (la page d'accueil de Monica, qui renvoie HTTP 200 sans authentification), avec un long délai initial afin qu'une première migration lente ne déclenche pas de boucle de redémarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe `monica-uploads`) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Il contient les fichiers téléversés de Monica (photos des contacts, documents, avatars). Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Monica destinée aux utilisateurs (variables par groupe, sorties, et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes : **[Monica_GKE](Monica_GKE.md)** et **[Monica_CloudRun](Monica_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Monica sur Google Cloud Run](Monica_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Monica sur GKE Autopilot](Monica_GKE.md) — cette configuration déployée sur GKE.
