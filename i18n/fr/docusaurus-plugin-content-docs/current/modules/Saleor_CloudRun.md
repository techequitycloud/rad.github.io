---
title: "Saleor sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Saleor sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Saleor_CloudRun.md @ e69407af sha256:368495c1514b -->

# Saleor sur Google Cloud Run {#saleor-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_CloudRun.png" alt="Saleor sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor est une plateforme e-commerce headless open source, GraphQL-first, basée
sur Python/Django (catalogue de produits, paiement, commandes et plugins de
paiement, tous exposés via une API GraphQL plutôt que par une vitrine intégrée).
Ce module déploie Saleor sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Saleor et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Saleor sur RAD, et comment cela se compare {#what-saleor-costs-on-rad-and-how-that-compares}

**L'exécution de Saleor dans votre propre projet GCP coûte environ 100,40 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits uniques (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~100,40 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, facturé à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 3 GiB (scaleToZero) | 29,95 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **100,40 $** |

### Comment cela se compare {#how-it-compares}

- L'offre gérée officielle de Saleor, Saleor Cloud, commence à **1 599 $/mois** (niveau Select, jusqu'à 200 000 $ de GMV ; source : https://saleor.io/pricing) — destinée aux vitrines de production avec un volume de transactions réel, ce n'est donc pas une comparaison directe avec un déploiement en libre-service unique, mais c'est le seul prix commercial vérifié pour cette plateforme exacte.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Saleor est une API de commerce dont dépendent les vitrines en direct, donc la disponibilité a tendance à être plus importante ici que de réduire les coûts d'exécution — mais le même mécanisme de pause ci-dessous s'applique toujours à une vitrine de staging ou de démonstration qui ne prend pas de commandes en direct.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la propre suppression logicielle récupérable de 30 jours
de Google. Contrairement à la suppression d'un module, cela ne supprime pas
Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
affirme que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de la supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Saleor purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 175 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Saleor reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 5 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul propre à cette application.

**Conserver les données d'abord :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://saleor.io/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Saleor s'exécute en tant que conteneur personnalisé (`ghcr.io/saleor/saleor:3.23` enveloppé d'un
point d'entrée cloud) sur Cloud Run v2. Le déploiement connecte un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Deux services Cloud Run : l'API Saleor principale (uvicorn, 2 workers + worker/beat Celery colocalisé) et un service Dashboard pré-construit séparé ; 2 vCPU / 3 GiB par défaut sur le service principal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — fixé par `Saleor_Common` quelle que soit la valeur de `database_type` |
| Stockage d'objets | Cloud Storage | Un bucket `media` dédié provisionné automatiquement |
| Cache et broker | Redis (facultatif) | Prend en charge `CACHE_URL`/`CELERY_BROKER_URL` pour le worker Celery colocalisé |
| Secrets | Secret Manager | `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, entièrement publique ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Saleor_Common` fixe le moteur de base de données ;
  la sélection de toute autre valeur dans `database_type` n'a aucun effet.
- **Le worker Celery (traitement des commandes, webhooks, e-mails, tâches planifiées)
  s'exécute colocalisé à l'intérieur du conteneur principal**, démarré en tant que
  processus d'arrière-plan par le point d'entrée cloud — pas un sidecar `additional_services`
  séparé. Il a besoin de la même image personnalisée dont la Fondation ne connaît
  le chemin Artifact Registry qu'*après* cet appel de module, donc la colocation
  évite un cycle au moment de la planification.
- **`cpu_always_allocated = true` par défaut.** Le worker Celery colocalisé a besoin d'un CPU
  continu entre les requêtes, pas seulement pendant le traitement d'une requête —
  confirmé en direct que la facturation basée sur les requêtes sous-alloue les
  ressources à la charge de travail combinée.
- **Le dimensionnement des ressources est pré-réglé : `2000m` CPU / `3Gi`
  mémoire.** Confirmé en direct que des tailles plus petites provoquent des
  OOMKill sous la charge combinée de 2 workers uvicorn + Django + worker/beat
  Celery, le tout dans un seul conteneur.
- **Trois secrets sont générés automatiquement** : `SECRET_KEY`, `RSA_PRIVATE_KEY`
  (paire de clés de signature JWT de Saleor — ne doit jamais être renouvelée
  à la légère), et `DJANGO_SUPERUSER_PASSWORD`.
- **Un service Dashboard séparé, véritablement pré-construit** (`ghcr.io/saleor/saleor-dashboard:3.23`)
  est déployé à côté de l'API en tant qu'entrée `additional_services`. Son `API_URL` est
  intégré à l'interface utilisateur servie au démarrage du conteneur, calculé à
  partir de l'URL de service prédite de l'API principale + `/graphql/`.
- **Redis est facultatif et désactivé par défaut** (`enable_redis = false`). Lorsqu'il est
  activé, `redis_host` doit être défini explicitement — Cloud Run n'a pas de
  repli automatique d'IP NFS.
- **Les sondes de santé ciblent `/health/`**, non authentifiées, confirmées 200
  localement et en direct.
- **`min_instance_count = 0`** par défaut — l'API principale se met à l'échelle à zéro
  lorsqu'elle est inactive ; définie sur `1` en production pour éviter
  les démarrages à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — les services API et Dashboard de Saleor {#a-cloud-run--the-saleor-api-and-dashboard-services}

L'API de Saleor s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement à la charge des requêtes. Le Dashboard s'exécute en tant que
deuxième service Cloud Run indépendant (une entrée `additional_services`) servant le
bundle d'interface utilisateur d'administration statique.

- **Console :** Cloud Run → sélectionnez l'un des services pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Saleor stocke toutes les données de l'application (produits, commandes, paniers,
utilisateurs, enregistrements de paiement) dans une instance Cloud SQL gérée
pour PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth
Proxy** (socket Unix ou IP privée TCP selon `enable_cloudsql_volume`) ; aucune IP
publique n'est exposée. Lors du premier déploiement, `db-init` crée la
base de données et le rôle de l'application, puis `db-migrate` (qui dépend de
`db-init`) applique les migrations de schéma de Django.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `media` dédié est provisionné automatiquement
pour les actifs de produits/médias téléchargés de Saleor. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache et broker Celery) {#d-redis-cache--celery-broker}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini,
`redis_host` et `redis_port` sont injectés en tant que
`REDIS_HOST`/`REDIS_PORT`, et le point d'entrée cloud compose
`CACHE_URL` (base de données Redis `/0`) et
`CELERY_BROKER_URL` (base de données Redis `/1`) à partir de ceux-ci.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs in the running revision's logs (entrypoint echoes on start):
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (clé de signature cryptographique de Django), `RSA_PRIVATE_KEY`
(paire de clés de signature JWT pour tous les jetons d'accès/actualisation
émis) et `DJANGO_SUPERUSER_PASSWORD` (mot de passe du compte administrateur de démarrage). Le
mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service API principal est accessible par son URL `run.app` par défaut
(entièrement publique — `ingress_settings = "all"`). Le service Dashboard est déployé avec
`ingress = INGRESS_TRAFFIC_ALL` afin que l'interface utilisateur d'administration soit également
directement accessible. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs des deux services sont acheminés vers Cloud Logging ;
les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec
des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Saleor {#3-saleor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init`
  (`postgres:15-alpine`) crée de manière idempotente la base de données et le rôle de
  l'application. `db-migrate` (l'image de l'application, `depends_on_jobs = ["db-init"]`) exécute
  ensuite `python3 manage.py migrate --noinput`. Les deux jobs peuvent être réexécutés en toute sécurité.
- **Extensions toujours installées.** `pg_trgm`, `unaccent`, `hstore` et
  `citext` sont installées inconditionnellement par la configuration assemblée
  de `Saleor_Common` — les variables `enable_postgres_extensions`/`postgres_extensions` du module appelant
  n'ont aucun effet supplémentaire sur cet ensemble de base.
- **Le worker Celery + beat s'exécute de manière colocalisée, et non en tant que
  service séparé.** Le traitement des commandes, les webhooks, les e-mails et les
  tâches planifiées s'exécutent tous dans le processus de worker en arrière-plan
  du conteneur principal. C'est pourquoi `cpu_always_allocated` est par défaut
  `true` — sans allocation continue de CPU, le worker meurt de faim entre
  les requêtes API.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY` et `DJANGO_SUPERUSER_PASSWORD` sont immuables
  après le premier démarrage.** `RSA_PRIVATE_KEY` en particulier signe chaque JWT
  émis par Saleor — le faire pivoter invalide toutes les sessions actives. Ne le
  faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Démarrage du superutilisateur.** Le point d'entrée cloud exécute
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` à chaque démarrage lorsque `DJANGO_SUPERUSER_PASSWORD` est défini
  (idempotent — une opération nulle une fois que l'utilisateur existe).
  `SALEOR_SUPERUSER_EMAIL` est par défaut `admin@example.com` et n'est pas exposé en tant que
  variable sur ce module — c'est la valeur par défaut fixe de `Saleor_Common`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health/` — le point de terminaison de santé non authentifié de Saleor,
  confirmé pour renvoyer `200` dès que le serveur ASGI accepte les
  connexions.
- **L'`API_URL` du tableau de bord est intégré au démarrage du conteneur**,
  non lu dynamiquement — confirmé via le propre `/docker-entrypoint.d/50-replace-env-vars.sh` de l'image
  officielle du tableau de bord, qui remplace `API_URL` par sed dans le
  fichier `index.html` construit. Sur Cloud Run, il s'agit d'une chaîne calculée
  (l'URL de service prédite de l'API principale + `/graphql/`), sûre pour la
  planification `for_each` car elle n'est pas connue après l'application.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Saleor sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour les services et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `saleor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Saleor Application` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Correspond à l'ARG de build `SALEOR_VERSION` (`3.23` lorsque `latest`) et au propre tag de l'image du tableau de bord. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Dimensionné pour la charge de travail combinée uvicorn + Celery — voir Vue d'ensemble. |
| `cpu_always_allocated` | `true` | Requis pour que le worker Celery colocalisé continue de traiter entre les requêtes. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût. |
| `container_port` | `8000` | Port de liaison d'uvicorn — doit correspondre à `CMD` de l'image de base. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS Fuse, si utilisés. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entièrement public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, fusionnés en plus des valeurs par défaut de `Saleor_Common` (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Ne pas définir `SECRET_KEY`, `RSA_PRIVATE_KEY` ou `DJANGO_SUPERUSER_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Standard `backup_schedule`, `backup_retention_days`, `enable_backup_import`,
`backup_source`, `backup_file`, `backup_format` — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

Options standard d'équilibreur de charge/CDN/nettoyage d'Artifact Registry
d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires, en plus du bucket `media` déclaré par `Saleor_Common`. |
| `enable_nfs` | `true` | Déclaré mais non utilisé par le propre chemin de stockage de Saleor — les médias sont servis à partir du bucket GCS `media`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Déclaré pour la parité de convention ; `Saleor_Common` fixe toujours PostgreSQL 15 quelle que soit cette valeur. |
| `application_database_name` | `saleor_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `saleor_user` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 12 — Jobs et tâches planifiées {#group-12--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour la paire intégrée `db-init` → `db-migrate`. |
| `cron_jobs` | `[]` | Jobs récurrents (par exemple, commandes de gestion Saleor) via Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, délai de 20s | Sonde de démarrage transmise à `Saleor_Common`. |
| `liveness_probe` | HTTP `/health/`, délai de 30s | Sonde de vivacité transmise à `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active le cache/broker de Saleor sur Redis. |
| `redis_host` | `""` | Doit être défini explicitement lorsqu'il est activé — pas de repli automatique sur Cloud Run. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options standard App_CloudRun VPC-SC et journalisation d'audit — voir
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run (API principale). |
| `service_url` | URL `run.app` par défaut du service API principal. |
| `service_location` | Région dans laquelle les services s'exécutent. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image API déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs `db-init`/`db-migrate`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

L'URL propre au service Dashboard est renvoyée dans l'environnement de l'API
principale en tant que `SALEOR_DASHBOARD_URL` plutôt que comme une sortie Terraform de
premier niveau.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide chaque JWT émis — toutes les sessions actives doivent se réauthentifier. |
| `SECRET_KEY` (auto-généré) | Ne jamais faire pivoter à la légère | Critique | La rotation de la clé de signature de Django invalide les cookies/sessions signés. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `cpu_always_allocated` | `true` | Élevé | Définir `false` affame le worker Celery colocalisé entre les requêtes — le traitement des commandes/webhooks/e-mails se dégrade ou s'arrête. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | Élevé | Des tailles plus petites provoquent des OOMKill sous la charge de travail combinée uvicorn + Celery — confirmé en direct. |
| `enable_redis` | `true` avant de compter sur le débit des tâches asynchrones à grande échelle | Moyen | Sans Redis, le cache et le broker Celery retombent sur un comportement no-op/en mémoire lié à une seule instance. |
| `redis_host` | Définir explicitement lorsque `enable_redis = true` | Élevé | Cloud Run n'a pas de repli automatique de l'hôte Redis ; un hôte vide rompt la composition `CACHE_URL`/`CELERY_BROKER_URL`. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité, plus une brève fenêtre avant la reprise du worker Celery. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Récupérer de Secret Manager rapidement | Élevé | Le compte administrateur de démarrage est le seul moyen d'accéder au premier déploiement ; perdre la trace du mot de passe généré nécessite une réinitialisation manuelle du shell Django. |
| `enable_iap` | uniquement lorsque le tableau de bord/l'API n'ont pas besoin d'un accès public | Élevé | IAP bloque les requêtes non authentifiées vers les services API et tableau de bord. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Saleor partagée avec la variante GKE est décrite
dans **[Saleor_Common](Saleor_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Saleor sur Cloud Run](../labs/Saleor_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Saleor sur GKE Autopilot](Saleor_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Saleor Common — Configuration d'application partagée](Saleor_Common.md) — la configuration partagée par les deux cibles de déploiement.
