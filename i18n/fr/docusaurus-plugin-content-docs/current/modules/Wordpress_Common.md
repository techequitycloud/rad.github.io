---
title: "WordPress Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module WordPress — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Wordpress_Common.md @ 15fd4c7 sha256:7204beefe334 -->

# WordPress Common — Configuration d'application partagée {#wordpress-common--shared-application-configuration}

`Wordpress_Common` est la **couche d'application partagée** pour WordPress. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à WordPress sur laquelle s'appuient [Wordpress_GKE](Wordpress_GKE.md) et [Wordpress_CloudRun](Wordpress_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement WordPress, consultez les guides de la plateforme ([Wordpress_GKE](Wordpress_GKE.md), [Wordpress_CloudRun](Wordpress_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Wordpress_Common | Où cela apparaît |
|---|---|---|
| Secrets d'authentification | Génère huit clés et sels de sécurité WordPress et les stocke dans **Secret Manager** | Récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une image PHP 8.4 + Apache personnalisée à partir de la source officielle WordPress via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket média **Cloud Storage** `wp-uploads` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement WordPress de base (préfixe de table, mode débogage, connexion Redis, gestion des proxys de confiance) | Comportement de l'application dans les guides de la plateforme |
| Tests de santé | Fournit la configuration par défaut de la sonde de démarrage (TCP) et de vivacité (HTTP `/wp-admin/install.php`) | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets d'authentification WordPress dans Secret Manager {#2-wordpress-authentication-secrets-in-secret-manager}

Huit constantes de sécurité WordPress sont générées automatiquement sous forme de chaînes aléatoires de 64 caractères (y compris les caractères spéciaux) et stockées en tant que secrets Secret Manager — elles ne sont jamais définies en texte clair. Récupérez-les après le déploiement :

```bash
# List all secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"

# Retrieve a specific secret value:
gcloud secrets versions access latest --secret=secret-<resource-prefix>-wordpress-auth-key --project "$PROJECT"
```

Les huit secrets correspondent aux constantes WordPress `AUTH_KEY`, `SECURE_AUTH_KEY`, `LOGGED_IN_KEY`, `NONCE_KEY`, `AUTH_SALT`, `SECURE_AUTH_SALT`, `LOGGED_IN_SALT` et `NONCE_SALT`. Ils sont injectés dans les pods de l'application au moment de l'exécution via le pilote CSI du magasin de secrets Kubernetes (GKE) ou le montage de secrets Cloud Run (Cloud Run).

**Important :** La rotation de ces secrets (en les supprimant et en les recréant) invalide immédiatement toutes les sessions de navigateur WordPress actives. Chaque utilisateur connecté — y compris les administrateurs — sera déconnecté. Ne faites pivoter que si un secret est soupçonné d'avoir été compromis.

Le mot de passe de la base de données est généré et géré séparément par le socle ; son nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`). Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

WordPress nécessite **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas pris en charge. Lors du premier déploiement, un job `db-init` ponctuel se connecte à Cloud SQL via le proxy d'authentification et de manière idempotente :

1. Crée la base de données WordPress (si absente).
2. Crée l'utilisateur de l'application avec le mot de passe généré.
3. Accorde à l'utilisateur tous les privilèges sur cette base de données.

Le job s'exécute à **chaque** `tofu apply` car il est idempotent — il ignore en toute sécurité les étapes déjà terminées. Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

L'image WordPress est construite à partir d'un `Dockerfile` personnalisé basé sur `php:8.4-apache`. La construction est effectuée par Cloud Build au moment du déploiement avec `application_version` passé comme argument de construction `APP_VERSION`, qui contrôle la version de WordPress téléchargée depuis wordpress.org.

L'image comprend :

- **Extensions PHP :** `bcmath`, `exif`, `gd` (AVIF, FreeType, JPEG, WebP), `intl`, `mysqli`, `zip`
- **Extensions PECL :** `imagick` (ImageMagick pour le traitement d'images avancé), `redis` (requis par le plugin de cache d'objets WP Redis)
- **Modules Apache :** `mod_rewrite` (support des permaliens WordPress), `mod_expires`, `mod_remoteip` (fait confiance à `X-Forwarded-For` des équilibreurs de charge Cloud Run et GKE)
- **Surcharges PHP.ini :** `memory_limit`, `upload_max_filesize` et `post_max_size` sont intégrées à partir des arguments de construction définis dans le module de la plateforme

Les modifications de configuration PHP (limite de mémoire, taille de téléchargement) nécessitent une nouvelle exécution et un nouveau déploiement de Cloud Build. Inspectez les valeurs actives dans une instance en cours d'exécution :

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

## 5. Paramètres d'application de base {#5-core-application-settings}

`Wordpress_Common` établit l'environnement WordPress de base afin que l'application démarre correctement au premier démarrage :

- **Préfixe de table** — `WORDPRESS_TABLE_PREFIX` est défini sur `wp_`. Ne le remplacez via `environment_variables` que lors de la migration d'une base de données existante avec un préfixe non standard.
- **Mode débogage** — `WORDPRESS_DEBUG` est défini sur `false`. Activez-le uniquement dans les environnements de développement ; le mode débogage peut exposer des informations sensibles dans les réponses HTTP.
- **Cache d'objets Redis** — lorsque `enable_redis = true`, `WP_REDIS_HOST` et `WP_REDIS_PORT` sont injectés et que `docker-entrypoint.sh` configure le plugin WP Redis. Lorsque `redis_host` est laissé vide, l'espace réservé `$(REDIS_HOST)` est résolu au démarrage du conteneur à l'adresse IP du serveur NFS — permettant Redis sur la VM NFS sans connaître son IP au moment de la planification.

Ajustements spécifiques à la plateforme gérés ici :

- **Les deux plateformes** dérivent `WP_HOME` et `WP_SITEURL` de l'URL de service injectée par la plateforme — `CLOUDRUN_SERVICE_URL` sur Cloud Run, `GKE_SERVICE_URL` sur GKE, en revenant à une variable d'environnement `WP_HOME` — afin que WordPress génère des liens absolus corrects, évite les boucles de redirection HTTP→HTTPS et suive l'adresse que la plateforme sert actuellement plutôt que les lignes `siteurl`/`home` stockées dans sa base de données au moment de l'installation.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes par défaut sont réglées pour les caractéristiques de démarrage de WordPress :

- **Sonde de démarrage (TCP) :** Vérifie que le port d'Apache est ouvert. Utilise TCP plutôt que HTTP car WordPress peut émettre des redirections ou renvoyer des erreurs avant que la connexion à la base de données ne soit établie et que l'application ne soit entièrement initialisée. Le `failure_threshold` élevé (20 tentatives × 15 secondes = 300 secondes de grâce) tient compte du job `db-init` et de la phase d'initialisation au premier démarrage de WordPress.
- **Sonde de vivacité (HTTP) :** Interroge `/wp-admin/install.php` avec un délai initial de 300 secondes. Cette page gérée par WordPress renvoie HTTP 200, que WordPress soit fraîchement installé ou déjà configuré, ce qui en fait un indicateur de vivacité fiable qui ne dépend pas d'une route `/healthz` personnalisée.

Les sondes sont identiques pour les variantes GKE et Cloud Run — les deux utilisent TCP pour le démarrage et HTTP pour la vivacité.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket média **Cloud Storage** dédié avec le suffixe de nom `wp-uploads` est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~wp-uploads"
```

Le bucket est provisionné dans la région de déploiement. Combiné au volume Filestore (NFS) partagé, cela donne à WordPress un stockage média durable et cohérent sur toutes les instances.

---

Pour la configuration spécifique à WordPress et destinée à l'utilisateur (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme :
**[Wordpress_GKE](Wordpress_GKE.md)** et **[Wordpress_CloudRun](Wordpress_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [WordPress sur Google Cloud Run](Wordpress_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [WordPress sur GKE Autopilot](Wordpress_GKE.md) — cette configuration déployée sur GKE.
