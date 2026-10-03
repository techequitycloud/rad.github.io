---
title: "OpenSourcePOS Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Open Source POS — paramètres de la couche application consommés par le déploiement Google Cloud Run."
---

<!-- translated-from: docs/modules/OpenSourcePOS_Common.md @ 2829548 sha256:f0e64f800345 -->

# OpenSourcePOS Common — Configuration d'application partagée {#opensourcepos-common--shared-application-configuration}

`OpenSourcePOS_Common` est la **couche d'application partagée** pour Open Source Point of Sale.
Elle n'est pas déployée seule ; elle fournit la configuration spécifique à
OpenSourcePOS sur laquelle [OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)
s'appuie. Les utilisateurs finaux ne configurent jamais cette couche directement
— elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute OpenSourcePOS, consultez le
guide de la plateforme ([OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)) et
les guides de fondation ([App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par OpenSourcePOS_Common | Où cela apparaît |
|---|---|---|
| Secrets | **Aucun** — OpenSourcePOS n'a pas de secret de signature d'application ; sa seule information d'identification est le mot de passe de la base de données généré par la Fondation | Les sorties `secret_ids` / `secret_values` sont vides |
| Image de conteneur | Build personnalisé léger de `jekkos/opensourcepos` avec trois correctifs d'image et un point d'entrée wrapper ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** (`MYSQL_8_0`) | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Chaîne de deux jobs : `db-init` (base de données, utilisateur, autorisations) → `schema-load` (charge le schéma inclus dans l'image) | Sortie `initialization_jobs` |
| Stockage des téléchargements | Déclare un bucket `storage` et, lorsque `enable_gcs_storage_volume = true`, un volume GCS Fuse à `/app/public/uploads` | Sortie `storage_buckets` |
| Paramètres de base | `DB_PORT = 3306` et `memory_limit` (de `php_memory_limit`) | Comportement de l'application dans le guide de la plateforme |
| Sondes de santé | Déclare les variables `startup_probe`/`liveness_probe` — les valeurs propres de la variante sont celles qui prennent effet (voir §7) | §Observabilité dans le guide de la plateforme |

Il active également l'API Secret Manager (`secretmanager.googleapis.com`) sur le projet, avec `disable_on_destroy = false`.

---

## 2. Secrets {#2-secrets}

OpenSourcePOS n'a pas de secret de signature au niveau de l'application, donc
cette couche n'en génère aucun : `secret_ids` est `{}` et `secret_values` est `{}`.
Le mot de passe de la base de données est généré et géré par la fondation ; son
nom de secret est indiqué dans les sorties du déploiement de la plateforme
(`database_password_secret`).

```bash
gcloud secrets list --project "$PROJECT"
```

Voir [App_Common](App_Common.md) pour le modèle de secret partagé.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

OpenSourcePOS fonctionne sur **Cloud SQL pour MySQL 8.0** (`MYSQL_8_0`) ; le moteur
est fixé par cette couche. `enable_cloudsql_volume = false` : OpenSourcePOS lit un hôte TCP simple,
donc l'IP privée brute de Cloud SQL (`DB_IP`) est utilisée et aucun volume de
socket n'est monté. Il n'y a pas de remplacement de port dans OpenSourcePOS — le
port reste à 3306.

Lorsque `initialization_jobs` est vide, deux jobs s'exécutent en séquence :

1.  **`db-init`** (`mysql:8.0-debian`, `execute_on_apply = true`, `max_retries = 3`,
    `timeout_seconds = 600`) — utilise le socket Unix Cloud SQL sous `/cloudsql` lorsqu'il est
    monté, sinon TCP via `DB_IP` ; attend MySQL ; crée (ou réaligne le mot de
    passe de) l'utilisateur de l'application ; crée la base de données ; accorde
    les privilèges ; vérifie que l'utilisateur de l'application peut se
    connecter (ce qui réchauffe également le cache côté serveur `caching_sha2_password`) ;
    puis signale à tout sidecar Cloud SQL Auth Proxy de s'arrêter.
2.  **`schema-load`** (`depends_on_jobs = ["db-init"]`, `execute_on_apply = true`,
    `max_retries = 2`, `timeout_seconds = 900`) — s'exécute sur l'**image de l'application**
    (`image = null`) car le schéma, `/app/app/Database/database.sql`, n'est livré qu'à
    l'intérieur de `jekkos/opensourcepos`. Il installe un client MySQL si l'image n'en a pas,
    attend jusqu'à 60 secondes pour la base de données, et compte les tables
    qu'elle contient : si elles existent, il se termine sans modifications.
    Sinon, il charge le schéma puis compte à nouveau, échouant si la base de
    données n'a toujours pas de tables (un client peut se terminer avec 0 après
    avoir appliqué seulement une partie d'un script).

Le schéma est chargé par un job, et non paresseusement au démarrage du
conteneur, car Cloud Run peut démarrer plusieurs instances à la fois et deux
d'entre elles exécutant le même ensemble `CREATE TABLE` laisseraient un schéma à
moitié chargé sans erreur. Les migrations CodeIgniter de l'image amont
(`php spark migrate`) ne sont pas utilisées : elles nécessitent une application
entièrement amorcée et une base de données accessible, ce qui est circulaire au
moment de l'initialisation.

Fournir n'importe quel `initialization_jobs` remplace les deux jobs par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une build légère : `FROM jekkos/opensourcepos:${OSPOS_VERSION}` (un processus Apache
sur le port 80 ; `/var/www/html` est un lien symbolique vers `/app/public`, donc le
DocumentRoot n'a pas besoin de changement). Le dépôt est **`jekkos/opensourcepos`** —
`opensourcepos/opensourcepos` n'existe pas sur Docker Hub ; l'organisation `opensourcepos` ne publie
que des outils de build.

`OSPOS_VERSION` est un ARG de build spécifique à l'application alimenté par `application_version`.
Le fallback du Dockerfile est `3.4.1`, et la variante
[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md) utilise également par défaut
`3.4.1` — la variante transmet `application_version`, donc sa valeur est celle qui
prend effet. `3.4.1` est le tag le plus récent correspondant à une version
stable amont publiée ; le tag flottant `3.4.2` ne correspond à aucune
version amont.

`scripts/Dockerfile` corrige trois défauts intégrés à l'image amont :

1.  **`timezone.ini` vide.** L'amont a écrit `date.timezone = ""` à partir d'un argument de
    build qui n'a jamais été défini. Le wrapper écrit `date.timezone = "UTC"` (ARG de
    build `PHP_TIMEZONE`, par défaut `UTC`).
2.  **`CI_ENVIRONMENT = development`.** L'environnement de développement de CodeIgniter 4 affiche
    les traces de pile et la barre d'outils de débogage dans le navigateur. Le
    wrapper le réécrit en `production` dans `/app/.env`. (Ceci est un correctif
    de sécurité, pas de base de données : les remplacements `MYSQL_*`
    s'appliquent à chaque groupe de configuration.)
3.  **Une réécriture de suppression de `www` qui dégrade TLS.** `public/.htaccess`
    livre une règle active qui, derrière la terminaison TLS de Cloud Run,
    redirigerait 301 `https://www.<domain>` vers `http://`. Le wrapper ajoute une
    garde `RewriteCond %{HTTP:X-Forwarded-Proto} !=https`.

`scripts/entrypoint.sh` s'exécute à chaque démarrage de conteneur :

-   **Affirme que `DB_IP`, `DB_USER`, `DB_PASSWORD` et `DB_NAME` ne sont pas
    vides** et se termine avec un message `FATAL:` sinon (voir §5).
-   **Les mappe sur les quatre noms lus par OpenSourcePOS :** `MYSQL_HOST_NAME` ←
    `DB_IP`, `MYSQL_USERNAME` ← `DB_USER`, `MYSQL_PASSWORD` ← `DB_PASSWORD`,
    `MYSQL_DB_NAME` ← `DB_NAME`. `DB_HOST` n'est pas utilisé, car sa forme de
    répertoire de socket n'est pas un hôte TCP.
-   Journalise `[startup] OpenSourcePOS pointed at <ip>:3306/<db> as <user>`.
-   Passe la main avec `exec docker-php-entrypoint "$@"` (`CMD ["apache2-foreground"]`).

---

## 5. Le piège de la variable vide (pourquoi le point d'entrée refuse de démarrer) {#5-the-empty-variable-trap-why-the-entrypoint-refuses-to-start}

Le `Config/Database.php` d'OpenSourcePOS applique chaque remplacement comme `!getenv('X') ? $baked : getenv('X')`.
`!getenv()` est vrai pour une **chaîne vide** ainsi que pour une variable non
définie, donc une valeur vide n'échoue pas — elle passe silencieusement aux
informations d'identification intégrées dans le `/app/.env` de l'image
(`localhost` / `admin` / `pointofsale` / `ospos`). Le conteneur
démarrerait, ne parviendrait pas à atteindre une base de données qui n'est pas
là, et afficherait une erreur CodeIgniter générique ne nommant rien d'utile. Le
wrapper vérifie donc les quatre valeurs et refuse de démarrer plutôt que de
s'exécuter contre la mauvaise base de données.

---

## 6. Stockage et paramètres de base {#6-storage-and-core-settings}

-   **Bucket `storage`** — déclaré par cette couche (`STANDARD`, `force_destroy =
  true`,
    versioning désactivé, prévention de l'accès public appliquée). Lorsque
    `enable_gcs_storage_volume = true` (la valeur par défaut), il est monté en lecture-écriture à
    **`/app/public/uploads`**, où OpenSourcePOS stocke les images d'articles et le logo
    de l'entreprise. L'image amont ne déclare aucun volume pour ce chemin, donc
    sans le montage, les téléchargements sont perdus à chaque démarrage à froid.
-   Les **sessions** sont stockées dans MySQL (CodeIgniter `DatabaseHandler`, table
    `ospos_sessions`), ce qui rend l'exécution de plusieurs instances sûre.
-   **Environnement** — `DB_PORT = "3306"` et `memory_limit = var.php_memory_limit` (par défaut
    `512M`), fusionnés avec tout `environment_variables` de l'appelant.
-   **`admin_username` / `admin_email`** — déclarés à des fins d'affichage/documentation
    uniquement. L'administrateur OpenSourcePOS est créé par le schéma inclus,
    pas par ce module.

Les valeurs par défaut `min_instance_count`/`max_instance_count` de cette couche (`1`/`3`)
sont remplacées par les valeurs transmises par la variante (`0`/`1`
dans [OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)).

---

## 7. Comportement de la sonde de santé {#7-health-probe-behaviour}

Cette couche déclare les variables `startup_probe`/`liveness_probe` sondant la racine du
document, où OpenSourcePOS sert son formulaire de connexion. La variante
[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md) transmet toujours ses
propres valeurs, qui sont également HTTP `GET /` :

-   **Sonde de démarrage** — `initial_delay_seconds = 30`, `period_seconds = 15`, `failure_threshold = 20`.
-   **Sonde de vivacité** — `initial_delay_seconds = 60`, `period_seconds = 30`, `failure_threshold = 3`.

---

Pour la configuration spécifique à OpenSourcePOS et destinée à l'utilisateur
(variables par groupe, sorties, et comment explorer chaque service depuis la
Console et la CLI), consultez le guide de la plateforme :
**[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

-   [OpenSourcePOS sur Google Cloud Run](OpenSourcePOS_CloudRun.md) — cette
    configuration déployée sur Cloud Run.
