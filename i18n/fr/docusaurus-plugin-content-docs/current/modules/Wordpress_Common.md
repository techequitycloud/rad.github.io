---
title: "WordPress Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module WordPress — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Wordpress_Common.md @ 3055034 sha256:2f6973d3b3be -->

# WordPress Common — Configuration applicative partagée {#wordpress-common--shared-application-configuration}

`Wordpress_Common` est la **couche applicative partagée** de WordPress. Elle n'est pas déployée seule ; elle fournit la configuration propre à WordPress sur laquelle s'appuient à la fois [Wordpress_GKE](Wordpress_GKE.md) et [Wordpress_CloudRun](Wordpress_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement WordPress, consultez les guides de plateforme ([Wordpress_GKE](Wordpress_GKE.md), [Wordpress_CloudRun](Wordpress_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Wordpress_Common | Où cela apparaît |
|---|---|---|
| Secrets d'authentification | Génère huit clés et sels de sécurité WordPress et les stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une image PHP 8.4 + Apache personnalisée à partir des sources officielles de WordPress via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Initialisation de la base de données | Définit le job du premier déploiement qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage objet | Déclare le bucket média **Cloud Storage** `wp-uploads` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement WordPress de référence (préfixe des tables, mode debug, connexion Redis, gestion des proxys de confiance) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage (TCP) et de vivacité (HTTP `/wp-admin/install.php`) | §Observabilité dans les guides de plateforme |

---

## 2. Secrets d'authentification WordPress dans Secret Manager {#2-wordpress-authentication-secrets-in-secret-manager}

Huit constantes de sécurité WordPress sont générées automatiquement sous forme de chaînes aléatoires de 64 caractères (caractères spéciaux compris) et stockées en tant que secrets Secret Manager — elles ne sont jamais saisies en clair. Récupérez-les après le déploiement :

```bash
# List all secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"

# Retrieve a specific secret value:
gcloud secrets versions access latest --secret=secret-<resource-prefix>-wordpress-auth-key --project "$PROJECT"
```

Les huit secrets correspondent aux constantes WordPress `AUTH_KEY`, `SECURE_AUTH_KEY`, `LOGGED_IN_KEY`, `NONCE_KEY`, `AUTH_SALT`, `SECURE_AUTH_SALT`, `LOGGED_IN_SALT` et `NONCE_SALT`. Ils sont injectés dans les pods de l'application à l'exécution via le pilote Kubernetes Secrets Store CSI (GKE) ou le montage de secrets de Cloud Run (Cloud Run).

**Important :** la rotation de ces secrets (en les supprimant puis en les recréant) invalide immédiatement toutes les sessions de navigateur WordPress actives. Tous les utilisateurs connectés — administrateurs compris — seront déconnectés. N'effectuez une rotation que si vous pensez qu'un secret a été compromis.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret figure dans les sorties du déploiement de plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

WordPress exige **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas pris en charge. Au premier déploiement, un job ponctuel `db-init` se connecte à Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. Crée la base de données WordPress (si elle n'existe pas).
2. Crée l'utilisateur de l'application avec le mot de passe généré.
3. Accorde à cet utilisateur tous les privilèges sur cette base de données.

Le job s'exécute à **chaque** `tofu apply` car il est idempotent — il ignore sans risque les étapes déjà effectuées. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 4. Image de conteneur {#4-container-image}

L'image WordPress est construite à partir d'un `Dockerfile` personnalisé basé sur `php:8.4-apache`. Le build est réalisé par Cloud Build au moment du déploiement, avec `application_version` transmis comme argument de build `APP_VERSION`, qui détermine quelle version de WordPress est téléchargée depuis wordpress.org.

L'image comprend :

- **Extensions PHP :** `bcmath`, `exif`, `gd` (AVIF, FreeType, JPEG, WebP), `intl`, `mysqli`, `zip`
- **Extensions PECL :** `imagick` (ImageMagick pour le traitement d'images avancé), `redis` (requis par l'extension de cache d'objets WP Redis)
- **Modules Apache :** `mod_rewrite` (prise en charge des permaliens WordPress), `mod_expires`, `mod_remoteip` (fait confiance à `X-Forwarded-For` provenant des équilibreurs de charge Cloud Run et GKE)
- **Surcharges de PHP.ini :** `memory_limit`, `upload_max_filesize` et `post_max_size` sont figés à partir des arguments de build définis dans le module de plateforme

Les modifications de configuration PHP (limite de mémoire, taille de téléversement) nécessitent une nouvelle exécution de Cloud Build et un nouveau déploiement. Inspectez les valeurs actives dans une instance en cours d'exécution :

```bash
# GKE:
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- php -r "
  echo 'memory_limit: ' . ini_get('memory_limit') . PHP_EOL;
  echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . PHP_EOL;
  echo 'post_max_size: ' . ini_get('post_max_size') . PHP_EOL;
"
# Cloud Run:
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`Wordpress_Common` établit l'environnement WordPress de référence afin que l'application démarre correctement dès le premier lancement :

- **Préfixe des tables** — `WORDPRESS_TABLE_PREFIX` est défini à `wp_`. Ne le remplacez via `environment_variables` que lors de la migration d'une base de données existante utilisant un préfixe non standard.
- **Mode debug** — `WORDPRESS_DEBUG` est défini à `false`. Ne l'activez que dans les environnements de développement ; le mode debug peut exposer des informations sensibles dans les réponses HTTP.
- **Cache d'objets Redis** — lorsque `enable_redis = true`, `WP_REDIS_HOST` et `WP_REDIS_PORT` sont injectés et `docker-entrypoint.sh` configure l'extension WP Redis. Lorsque `redis_host` est laissé vide, l'espace réservé `$(REDIS_HOST)` est résolu au démarrage du conteneur en l'adresse IP du serveur NFS — ce qui permet d'activer Redis sur la VM NFS sans connaître son adresse IP au moment du plan.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** dérive en outre `WP_HOME` et `WP_SITEURL` de la variable d'environnement `CLOUDRUN_SERVICE_URL` (toujours injectée par le socle avec l'URL correcte), afin que WordPress génère des liens absolus corrects et évite les boucles de redirection HTTP→HTTPS.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut sont ajustées aux caractéristiques de démarrage de WordPress :

- **Sonde de démarrage (TCP) :** vérifie que le port d'Apache est ouvert. Elle utilise TCP plutôt que HTTP car WordPress peut émettre des redirections ou renvoyer des erreurs avant que la connexion à la base de données soit établie et que l'application soit entièrement initialisée. Le `failure_threshold` élevé (20 tentatives × 15 secondes = 300 secondes de marge) laisse le temps au job `db-init` et à la phase d'initialisation de WordPress au premier démarrage.
- **Sonde de vivacité (HTTP) :** interroge `/wp-admin/install.php` avec un délai initial de 300 secondes. Cette page gérée par WordPress renvoie HTTP 200 que WordPress vienne d'être installé ou soit déjà configuré, ce qui en fait un indicateur de vivacité fiable qui ne dépend pas d'une route `/healthz` personnalisée.

Les sondes sont identiques pour les variantes GKE et Cloud Run — toutes deux utilisent TCP pour le démarrage et HTTP pour la vivacité.

---

## 7. Stockage objet {#7-object-storage}

Un bucket média **Cloud Storage** dédié, dont le nom porte le suffixe `wp-uploads`, est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~wp-uploads"
```

Le bucket est provisionné dans la région du déploiement. Associé au volume Filestore (NFS) partagé, il offre à WordPress un stockage durable des médias, cohérent entre toutes les instances.

---

Pour la configuration propre à WordPress exposée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Wordpress_GKE](Wordpress_GKE.md)** et **[Wordpress_CloudRun](Wordpress_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [WordPress sur Google Cloud Run](Wordpress_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [WordPress sur GKE Autopilot](Wordpress_GKE.md) — cette configuration déployée sur GKE.
