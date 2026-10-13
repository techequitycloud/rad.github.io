---
title: "WordPress sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de WordPress sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wordpress_CloudRun.md @ e69407af sha256:425b10e96bde -->

# WordPress sur Google Cloud Run {#wordpress-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wordpress_CloudRun.png" alt="WordPress sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WordPress est le système de gestion de contenu le plus populaire au monde, alimentant plus de 43 % de tous les sites web à l'échelle mondiale. Ce module déploie WordPress sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par WordPress et sur la manière de les explorer et de les exploiter depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte WordPress sur RAD, et comment cela se compare {#what-wordpress-costs-on-rad-and-how-that-compares}

**L'exécution de WordPress sur Cloud Run dans votre propre projet Google Cloud coûte environ 83,61 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 110 crédits facturé une seule fois au moment du déploiement. WordPress a besoin d'une base de données MySQL et d'un serveur de fichiers NFS/cache partagé pour les téléchargements et les sessions, qui représentent ensemble la majeure partie des 83,61 $ ci-dessus. Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour l'avantage unique d'un projet géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Wordpress_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 83,61 $/mois, facturé par Google au prix catalogue | ~32 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 GB, zonal, 10 GB SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **83,61 $** |

### Comment cela se compare {#how-it-compares}

- WordPress.com, géré par Automattic, est la version hébergée officielle du même logiciel : sa [page de tarification](https://wordpress.com/pricing/) (vérifiée le 8 octobre 2026) liste Personal à 4 $/mois, Premium à 8 $/mois, Business à 25 $/mois et Commerce à 45 $/mois en facturation mensuelle (moins cher en termes annuels) — tous inférieurs au coût d'exécution de 83,61 $/mois de RAD, mais sur une plateforme multi-locataire partagée avec des restrictions de plugins/thèmes en dessous du niveau Business.
- Le module de RAD vous offre plutôt un service Cloud Run dédié, votre propre base de données Cloud SQL et une liberté totale de plugins/thèmes dès le départ, ce que le coût supplémentaire par rapport à WordPress.com achète.
- Une alternative VPS nue fonctionne également : une machine DigitalOcean ou Hetzner 2 vCPU/4GB à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 à environ 49 $/mois, peut auto-héberger WordPress et MySQL ensemble — moins cher que RAD ou WordPress.com en termes d'argent, sans aucune des sauvegardes gérées, des correctifs ou de la surveillance que l'un ou l'autre fournit.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé WordPress et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener WordPress signifie redéployer à partir de
zéro. Cela coûte environ 113-116 crédits (les frais de module de 110 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si WordPress devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour WordPress, c'est environ 5 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée — celles-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'
application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est mise en pause et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration. Prix des plans WordPress.com depuis [wordpress.com/pricing](https://wordpress.com/pricing/), vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

WordPress s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — WordPress ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Répertoire `wp-content` (téléchargements, plugins, thèmes) partagé entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket média `wp-uploads` dédié |
| Cache | Redis | Cache d'objets optionnel ; activé par défaut pour réduire la charge de la base de données |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et huit clés et sels d'authentification WordPress |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sélection de PostgreSQL ou `NONE` interrompt le démarrage.
- **NFS est requis pour un site fonctionnel.** WordPress stocke les médias téléchargés, les plugins installés et les thèmes actifs sous `wp-content/`. Sans un volume NFS partagé, chaque révision Cloud Run efface tous les plugins, thèmes et téléchargements — rendant WordPress sur Cloud Run non fonctionnel pour tout site réel.
- **La sonde de démarrage est TCP, pas HTTP.** WordPress peut ne pas encore répondre aux requêtes HTTP pendant l'initialisation de la base de données au premier démarrage ; une sonde TCP vérifie uniquement que le port d'Apache est ouvert.
- **`WP_HOME` et `WP_SITEURL` sont définis automatiquement** à partir de l'URL de service Cloud Run prévue (`CLOUDRUN_SERVICE_URL`), de sorte que WordPress génère des liens absolus corrects et évite les boucles de redirection.
- **Les migrations de base de données s'exécutent à chaque démarrage d'instance** via le job `db-init` ; les mises à niveau de version appliquent automatiquement les modifications de schéma.
- Les **clés et sels d'authentification** de WordPress sont auto-générés et stockés dans Secret Manager ; vous ne les définissez jamais en texte clair.
- **Cloud Run gen2 est requis** pour les montages de volume NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service WordPress {#a-cloud-run--the-wordpress-service}

WordPress s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WordPress stocke toutes les données du site (articles, utilisateurs, paramètres, commentaires) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `wp-content` de WordPress est mappé sur un partage **Filestore (NFS)** monté dans le service afin que toutes les instances partagent les mêmes plugins, thèmes et médias téléchargés. Un bucket **Cloud Storage** dédié (`wp-uploads`) est également provisionné pour les actifs multimédias.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache d'objets Redis {#d-redis-object-cache}

Redis prend en charge le cache d'objets de WordPress via le plugin **WP Redis**, stockant les résultats des requêtes de base de données coûteuses en mémoire. Lorsque `redis_host` est laissé vide et que NFS est activé, l'IP du serveur NFS est utilisée comme point de terminaison Redis (le modèle de déploiement partagé par défaut).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données WordPress et les huit clés et sels d'authentification WordPress sont stockés dans Secret Manager et injectés dans le service au moment de l'exécution ; les valeurs en texte clair n'apparaissent jamais dans l'état Terraform.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application WordPress {#3-wordpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation utilisant l'image `mysql:8.0-debian` crée la base de données et l'utilisateur WordPress avant le démarrage du service. Il s'exécute à chaque `tofu apply` car il est idempotent — il ignore en toute sécurité les étapes déjà terminées.
- **Clés et sels d'authentification.** Huit secrets de sécurité WordPress de 64 caractères (clé d'authentification, clé d'authentification sécurisée, clé de connexion, clé de nonce et leurs sels correspondants) sont générés automatiquement lors du premier déploiement et stockés dans Secret Manager. La rotation de ces secrets invalide immédiatement toutes les sessions de navigateur actives — chaque utilisateur connecté sera déconnecté.
- **Résolution automatique de l'URL du site.** `CLOUDRUN_SERVICE_URL` est toujours injecté par la fondation avec l'URL Cloud Run correcte. `wp-config-docker.php` lit ceci pour définir `WP_HOME` et `WP_SITEURL` afin que WordPress génère des liens absolus corrects et évite les boucles de redirection derrière Cloud Run.
- **Configuration PHP intégrée au moment du build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont appliqués à l'image du conteneur au moment du build Cloud Build. Leur modification déclenche un nouveau build d'image et une nouvelle révision.
- **Conception de la sonde de santé.** La sonde de démarrage TCP confirme qu'Apache écoute avant que les vérifications HTTP ne commencent ; le `failure_threshold` élevé (20 × 15 s = 300 s) prend en charge le job `db-init` et la phase d'initialisation de WordPress. La sonde de vivacité interroge `/wp-admin/install.php` — qui renvoie HTTP 200, que WordPress soit fraîchement installé ou déjà configuré — avec un délai initial de 300 secondes.
- **Tâches planifiées WordPress.** Cloud Run est invoqué à la demande, donc le pseudo-cron `wp-cron` peut ne pas se déclencher à l'heure si il n'y a pas de trafic. Pour une exécution planifiée fiable, désactivez `wp-cron` via `environment_variables` et configurez une entrée `cron_jobs` :

  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour WordPress sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Emails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wordpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Wordpress` | Nom convivial affiché dans la Console. Remarque : ce module utilise `display_name` (pas `application_display_name`). |
| `description` | `Wordpress CMS on Cloud Run` | Description du service. |
| `application_version` | `latest` | Version de l'image WordPress. Utilisez une version épinglée (par exemple `6.7.1`) en production. |
| `php_memory_limit` | `512M` | `memory_limit` PHP intégré au moment du build. Augmenter pour les charges de travail de plugins lourdes. |
| `upload_max_filesize` | `64M` | Taille maximale d'un seul téléchargement de fichier. Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale de toutes les données POST. Doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 GiB recommandés pour WordPress avec des plugins. |
| `min_instance_count` | `0` | Instances minimales (mise à l'échelle à zéro par défaut). Définissez sur `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Instances maximales. Augmenter uniquement après avoir vérifié que tous les plugins gèrent correctement l'accès concurrent et que NFS est activé. |
| `container_port` | `80` | WordPress/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. Requis. |
| `execution_environment` | `gen2` | Cloud Run gen2 est requis pour les montages NFS. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Considérez `internal-and-cloud-load-balancing` lors de l'utilisation de Cloud Armor. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG` et les variables Redis sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage env var → nom du secret Secret Manager. Huit secrets d'authentification WordPress sont injectés automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_uri` (URI GCS complet ou ID de fichier Drive). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. Fortement recommandé pour les sites WordPress publics. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour WordPress `wp-content` (garder activé). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage à l'intérieur du conteneur. Le script de démarrage crée un lien symbolique `wp-content` ici. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket média / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. WordPress nécessite MySQL. |
| `db_name` | `wp` | Nom de la base de données. **Immuable après le premier déploiement.** Remarque : ce module utilise `db_name` (pas `application_database_name`). |
| `db_user` | `wp` | Utilisateur de l'application. **Immuable après le premier déploiement.** Remarque : ce module utilise `db_user` (pas `application_database_user`). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires pour les détails de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents. Utiliser pour remplacer `wp-cron` pour une exécution fiable des tâches planifiées. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, seuil 20 | Sonde de démarrage TCP — évite les échecs HTTP pendant l'initialisation de la base de données. Ne pas réduire `failure_threshold` en dessous de 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, délai de 300s | Le délai initial de 300 secondes prend en charge la configuration de la base de données au premier démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le cache d'objets WordPress. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS ; définir explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données (sensible). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | WordPress nécessite MySQL ; PostgreSQL/`NONE` interrompt le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, chaque nouvelle révision Cloud Run efface tous les plugins, thèmes et téléchargements de médias — WordPress est non fonctionnel pour tout site réel. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données WordPress. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent Cloud Run gen2 ; le passage à gen1 provoque une erreur de montage de volume et un échec de démarrage du service. |
| `container_image_source` | `custom` | Élevé | L'image WordPress personnalisée relie le lien symbolique NFS et le socket Cloud SQL. L'utilisation de `prebuilt` avec l'image WordPress standard interrompt la connectivité du socket Cloud SQL. |
| `nfs_mount_path` | `/mnt/nfs` (ne pas modifier après le déploiement) | Élevé | Le script de démarrage crée un lien symbolique `wp-content` vers ce chemin ; le modifier après le déploiement rompt le lien symbolique. |
| `startup_probe` | TCP (par défaut) | Élevé | Une sonde HTTP peut échouer lors de l'initialisation de la base de données au premier démarrage. Ne pas réduire `failure_threshold` en dessous de 10. |
| `memory_limit` | `2Gi` | Élevé | WordPress avec des plugins populaires (WooCommerce, Elementor) nécessite au moins 2 GiB ; une mémoire insuffisante provoque des erreurs fatales PHP. |
| `enable_redis` | `true` | Moyen | Plusieurs instances avec des caches en mémoire isolés provoquent des requêtes de base de données redondantes. |
| `redis_host` | `""` (IP NFS) ou explicite | Élevé | Pas de point de terminaison Redis valide si Redis est activé, NFS est désactivé et aucun hôte n'est défini. |
| `enable_cloud_armor` | activer pour les sites publics | Élevé | Les pages de connexion WordPress (`/wp-login.php`, `xmlrpc.php`) sont des cibles privilégiées pour les attaques par force brute. |
| `php_memory_limit` | `512M` | Moyen | Doit être dans `memory_limit` ; le définir plus haut que la limite du conteneur provoque une terminaison OOM au lieu d'une erreur PHP. |
| `min_instance_count` | `1` | Moyen | `0` provoque des retards de démarrage à froid et peut entraîner des erreurs visibles pour le premier visiteur après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour les sites de commerce électronique ou à fort contenu. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'accès administrateur | Moyen | Le panneau d'administration WordPress est autrement accessible publiquement. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à WordPress partagée
avec la variante GKE est décrite dans **[Wordpress_Common](Wordpress_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WordPress sur Cloud Run](../labs/Wordpress_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WordPress sur GKE Autopilot](Wordpress_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [WordPress Common — Configuration d'application partagée](Wordpress_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Site web d'entreprise et blog**.
