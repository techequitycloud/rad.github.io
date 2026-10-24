---
title: "Django sur Cloud Run"
description: "Référence de configuration pour le déploiement de Django sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Django_CloudRun.md @ e69407af sha256:646c443d68d3 -->

# Django sur Cloud Run {#django-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Django_CloudRun.png" alt="Django sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Django est un framework web Python éprouvé qui encourage le développement rapide et
une conception propre et pragmatique, alimentant certaines des applications web les plus exigeantes au monde.
Ce module déploie Django sur **Cloud Run v2** en s'appuyant sur la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Django et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toute application Cloud Run — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte Django sur RAD, et comment cela se compare {#what-django-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Django sur RAD coûte environ 81,23 $ US par mois.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. GKE Autopilot convient aux applications Django qui doivent rester actives en permanence ou s'adapter à plusieurs pods ; pour le coût le plus bas, ce module Cloud Run vous offre déjà l'option la moins chère — voir le [guide GKE](Django_GKE.md) si vous avez besoin de l'autre option. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 81,23 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **81,23 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 81,23 $ US** |

### Comment cela se compare {#how-it-compares}

- Django est un framework, pas un produit packagé, il n'y a donc pas de plan d'« hébergement Django » commercial à comparer — la comparaison honnête est un serveur nu : un Hetzner CPX22 ou un droplet DigitalOcean 2 vCPU/4 Go coûte environ 24 $ US par mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $ US — plus votre propre temps pour la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- Ce que vous évaluez réellement, c'est la part de la couche applicative qui est personnalisée. Pour une API légère ou un outil d'administration, un petit VPS peut suffire ; pour tout ce qui a de réelles exigences d'intégrité des données, une base de données gérée vaut plus que la différence de prix ne le suggère.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Django s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Django dont vous n'avez besoin qu'occasionnellement — pour étudier, une démo, une activité
saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à
  la suppression d'un seul module, cela ne supprime pas Cloud SQL, la VM NFS ou Cloud Run un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Django, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 81,23 $ US.** Déployez Django, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Django était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc
  très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé les données et souhaitez les conserver, copiez une sauvegarde
  (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou
une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer
à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Django. La suppression permet d'économiser de l'argent une fois que Django resterait inutilisé
  pendant environ **4 jours ou plus** dans votre propre projet (environ 2,71 $ US par jour), ou environ
  **3 jours ou plus** dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Django utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Django.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les
  paramètres lors du déploiement.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  de Django dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Django pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Django s'exécute en tant que conteneur Python/Gunicorn sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Python/Gunicorn, 1 vCPU / 512 Mio par défaut ; autoscalé à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — `DB_ENGINE` de Django est fixé à `django.db.backends.postgresql` |
| Fichiers partagés | Filestore (NFS) | Média partagé entre toutes les instances de conteneur (nécessite un environnement d'exécution gen2) |
| Stockage d'objets | Cloud Storage | Un bucket média dédié provisionné par Django_Common |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe de base de données auto-générés |
| Cache (facultatif) | Redis / Cloud Memorystore | Désactivé par défaut ; activer pour le stockage de session et la mise en cache |
| Ingress | Cloud Load Balancing | Équilibreur de charge HTTPS externe avec domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est fixe.** `Django_Common` fixe `DB_ENGINE` à PostgreSQL ;
  MySQL et `NONE` ne sont pas pris en charge par ce module.
- **La `SECRET_KEY` de Django est auto-générée** et stockée dans Secret Manager ;
  elle est injectée au moment de l'exécution et n'est jamais définie en texte clair.
- **Quatre extensions PostgreSQL sont installées automatiquement** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) par le job `db-init`, vous n'avez donc pas besoin de les configurer.
- **Deux jobs d'initialisation s'exécutent par défaut** — `db-init` (crée la base de données et
  l'utilisateur) et `db-migrate` (exécute `manage.py migrate` et `collectstatic`). Sur Cloud Run,
  ceux-ci s'exécutent en tant que jobs Cloud Run déclenchés lors de l'apply.
- **NFS est activé par défaut.** Toutes les instances de conteneur partagent le même volume Filestore
  pour les fichiers multimédias téléchargés. Les montages NFS nécessitent
  `execution_environment = "gen2"` (défini automatiquement).
- **Redis est désactivé par défaut.** Activez-le avec `enable_redis = true` et pointez vers une
  instance Cloud Memorystore pour le stockage de session de production et la mise en cache.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count` par défaut à `0` ; définissez sur `1`
  pour la production afin d'éliminer les démarrages à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `SERVICE` sont définis. Le nom du service et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run v2 — le service Django {#a-cloud-run-v2--the-django-service}

Django s'exécute en tant que service Cloud Run mis à l'échelle automatiquement entre `min_instance_count`
et `max_instance_count`. Chaque instance exécute un sidecar Cloud SQL Auth Proxy et,
lorsque NFS est activé, monte le partage Filestore.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, les répartitions de trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT"
  gcloud run services list --region "$REGION" --project "$PROJECT"
  # Stream live logs:
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"' \
    --project "$PROJECT" --limit 50
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les répartitions de trafic de révision, les instances min/max, la concurrence et la configuration de l'environnement d'exécution.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Django stocke toutes les données d'application dans une instance Cloud SQL pour PostgreSQL 15 gérée.
Les instances de conteneur y accèdent via le **Cloud SQL Auth Proxy** via un socket Unix local,
de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, le job Cloud Run `db-init`
crée la base de données et l'utilisateur de l'application, installe les extensions requises et
accorde les privilèges. Le job `db-migrate` exécute ensuite `manage.py migrate` et
`manage.py collectstatic`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # List the initialization jobs:
  gcloud run jobs list --region "$REGION" --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits dans un partage **Filestore (NFS)** monté dans chaque instance de conteneur
afin que toutes les répliques voient les mêmes fichiers. Un bucket média **Cloud Storage** dédié
est également provisionné automatiquement par `Django_Common` ; le compte de service de la charge de travail
se voit accorder l'accès. Les montages NFS sur Cloud Run nécessitent l'environnement d'exécution
`gen2`, que ce module définit par défaut.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket média.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, les volumes GCS Fuse et
les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, Django reçoit
`REDIS_HOST` et `REDIS_PORT` comme variables d'environnement. Configurez `settings.py` pour
les utiliser pour `CACHES` et `SESSION_ENGINE`. Le module ne provisionne pas d'instance Redis —
utilisez une instance Cloud Memorystore et définissez `redis_host` sur son IP privée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  # Confirm REDIS_HOST and REDIS_PORT are in the service environment:
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format="json" | jq '.spec.template.spec.containers[0].env[]|select(.name|startswith("REDIS"))'
  ```

### E. Secret Manager {#e-secret-manager}

La `SECRET_KEY` de Django et le mot de passe de la base de données sont stockés en tant que secrets Secret Manager
et injectés dans les instances de conteneur au moment de l'exécution ; le texte clair n'apparaît jamais dans
la configuration. Le mot de passe du superutilisateur (si vous en créez un via `DJANGO_SUPERUSER_PASSWORD`)
doit également être stocké ici.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # The database password secret name is in the Outputs:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de montage de secrets, les montages de volumes
par rapport aux références de variables d'environnement, et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, le service est exposé directement à son URL HTTPS `run.app`
(`ingress_settings = "all"`). L'ingress peut être restreint à `internal` ou
`internal-and-cloud-load-balancing` via `ingress_settings`, et l'egress VPC peut être
contrôlé via `vpc_egress_setting`. Les noms d'hôte pour le chemin équilibré en charge sont
configurés via `application_domains`.

- **Console :** Services réseau → Équilibrage de charge ; Cloud Run → service → onglet Réseau.
- **CLI :**
  ```bash
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format="value(status.url)"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés, Cloud CDN,
l'IP statique et les détails de l'egress VPC.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des conteneurs sont acheminées vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers
Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Django {#3-django-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job Cloud Run `db-init` crée la base de données et l'utilisateur PostgreSQL, accorde les privilèges et installe les quatre extensions requises (`pg_trgm`, `unaccent`, `hstore`, `citext`) en utilisant le secret superutilisateur `ROOT_PASSWORD`. Le job est idempotent et peut être réexécuté en toute sécurité.
- **Migrations au premier déploiement.** Un job Cloud Run `db-migrate` exécute
  `manage.py migrate` et `manage.py collectstatic --noinput --clear` après que `db-init`
  soit terminé. Les deux jobs sont déclenchés automatiquement lors de l'apply
  (`execute_on_apply = true`). Remplacez `initialization_jobs` par une liste non vide
  pour les remplacer par des jobs personnalisés.
- **Gestion de `SECRET_KEY`.** Une clé aléatoire de 50 caractères est générée par
  `Django_Common` et stockée dans Secret Manager. Elle est injectée en tant que `SECRET_KEY`.
  Ne définissez pas `SECRET_KEY` dans `environment_variables`.
- **Création de superutilisateur.** Si `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`,
  et `DJANGO_SUPERUSER_PASSWORD` sont présents en tant que variables d'environnement lorsque le
  conteneur démarre, `entrypoint.sh` crée un superutilisateur Django au premier démarrage. Utilisez
  `secret_environment_variables` pour le mot de passe :
  ```bash
  # Retrieve the superuser password from Secret Manager:
  gcloud secrets versions access latest --secret=<superuser-secret> --project "$PROJECT"
  ```
- **Sondes de santé.** La sonde de démarrage cible `GET /healthz` sur le port 8080 avec un
  délai initial de 60 secondes. La sonde de vivacité cible également `GET /healthz` avec un
  délai initial de 30 secondes. Implémentez une vue `/healthz/` légère qui renvoie HTTP
  200 sans redirections. Notez que le trafic des sondes de santé Cloud Run arrive via HTTP ;
  évitez de définir `SECURE_SSL_REDIRECT = True` dans `settings.py` ou la sonde recevra
  une redirection 301 et le service ne deviendra jamais sain.
- **Tâches planifiées.** Les commandes de gestion Django (par exemple, `clearsessions`) peuvent être
  planifiées en tant que jobs Cloud Run via la variable `cron_jobs` :
  ```bash
  gcloud run jobs list --region "$REGION" --project "$PROJECT"
  gcloud run jobs execute <job-name> --region "$REGION" --project "$PROJECT"
  ```
- **Environnement d'exécution gen2.** Les montages NFS nécessitent des conteneurs Cloud Run gen2.
  Ceci est défini automatiquement lorsque `enable_nfs = true`. Si vous désactivez NFS, vous pouvez
  remplacer `execution_environment` par `"gen1"`, mais gen2 est fortement recommandé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Django sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service Cloud Run et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `django` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `Django Application` | Nom convivial affiché dans la console. |
| `application_description` | `Django Application - High-level Python Web framework` | Annotation de description du service. |
| `application_version` | `latest` | Tag de version d'image ; incrémenter pour déployer une nouvelle révision. Épingler à un tag spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | Remplacer l'URI de l'image du conteneur. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire par instance. |
| `min_instance_count` | `0` | Nombre minimum d'instances chaudes. Définir ≥ 1 pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Nombre maximum d'instances actives simultanément. |
| `container_port` | `8080` | Django/Gunicorn écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. Ne pas modifier sauf si NFS est désactivé. |

### Groupe 5 — Gestion du trafic et IAP {#group-5--traffic-management--iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress Cloud Run : `all`, `internal`, ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Egress via le connecteur VPC sans serveur. |
| `enable_iap` | `false` | Exiger la connexion Google devant Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas inclure `SECRET_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager (par exemple, `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définir `enable_backup_import = false` après une importation réussie. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor et CDN {#group-10--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur l'équilibreur de charge. |
| `application_domains` | `[]` | Noms d'hôte à servir (également utilisés pour le domaine personnalisé). |

### Groupe 11 — Système de fichiers (NFS) et Cloud Storage {#group-11--filesystem-nfs--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Django (garder activé pour les instances multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. Doit correspondre à `MEDIA_ROOT` dans `settings.py`. |
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. Le bucket média est toujours provisionné par `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket média auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **PostgreSQL 15 requis.** Django ne prend pas en charge MySQL via ce module. |
| `application_database_name` | `django_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `django_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_user_env_var_name` / `db_name_env_var_name` | `""` | Remplace le nom de la variable d'environnement utilisée pour injecter l'utilisateur/nom de la base de données. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

Les quatre extensions requises (`pg_trgm`, `unaccent`, `hstore`, `citext`) sont installées
automatiquement par le job `db-init` intégré — aucune variable n'est nécessaire pour elles.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | _(intégré `db-init`)_ | Par défaut, un job Cloud Run `db-init` est défini. Le job `db-migrate` est toujours ajouté par `Django_Common`. Fournir une liste non vide pour remplacer le `db-init` par défaut par des jobs personnalisés. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés (par exemple, `clearsessions`, `cleartokens`). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /healthz`, délai initial de 60 s | Sonde de démarrage passée à `Django_Common`. Augmenter le délai pour les grands ensembles de migration. **Ne pas utiliser de chemin de redirection.** |
| `liveness_probe` | HTTP `GET /healthz`, délai initial de 30 s | Sonde de vivacité. Utiliser un point de terminaison léger qui renvoie 200 sans corps. |
| `startup_probe_config` | activé, HTTP `/healthz` | Sonde de démarrage de l'infrastructure au niveau App_CloudRun. |
| `health_check_config` | activé, HTTP `/healthz` | Vérification de santé de l'infrastructure au niveau App_CloudRun. |
| `uptime_check_config` | désactivé (`enabled = false`, chemin `/`) | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage de session et la mise en cache. |
| `redis_host` | `""` | IP ou nom d'hôte de l'hôte Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL HTTPS pour atteindre Django. |
| `service_location` | Région dans laquelle le service est déployé. |
| `stage_services` | Mappage des noms de services et des URL des étapes de Cloud Deploy. |
| `load_balancer_ip` / `load_balancer_url` | IP externe et URL HTTPS (lorsqu'une IP statique est réservée). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs Cloud Run configurés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `uptime_check_names` | Noms des vérifications de disponibilité Cloud Monitoring provisionnées. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Django nécessite PostgreSQL ; MySQL ou `NONE` feront échouer le job `db-init`. |
| `application_name` / `tenant_id` | défini une fois | Critique | Intégré aux noms de ressources ; la modification recrée toutes les ressources nommées et détruit les données. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| Chemin `startup_probe` | `/healthz` (pas de redirection) | Critique | Le trafic de la sonde Cloud Run est en HTTP simple ; une redirection renvoie 301, Cloud Run ne voit jamais 200, le service ne démarre jamais. |
| `SECURE_SSL_REDIRECT` dans `settings.py` | `False` ou exempter `/healthz` | Critique | `True` redirige chaque requête HTTP, y compris la sonde de démarrage ; le service reste bloqué dans `STARTING`. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` réexécute l'importation à chaque apply, écrasant les données en direct avec une sauvegarde obsolète. |
| `enable_nfs` | `true` (par défaut) | Élevé | La désactivation avec `max_instance_count > 1` signifie que chaque instance a un stockage éphémère isolé ; les téléchargements sont perdus lors de la suppression de l'instance. |
| `execution_environment` | `gen2` (par défaut lorsque NFS est activé) | Élevé | `gen1` ne prend pas en charge les montages de volume NFS ; le service ne démarre pas. |
| `nfs_mount_path` | `/mnt/nfs` — doit correspondre à `MEDIA_ROOT` | Élevé | Une non-concordance entraîne l'écriture des médias par Django dans un stockage éphémère ; les fichiers sont perdus lors de la suppression de l'instance. |
| Mémoire `container_resources` | ≥ `512Mi` ; augmenter pour les charges de travail intensives en ORM | Élevé | Trop peu de mémoire : l'instance se termine avec OOM (exit 137) sur de grands ensembles de requêtes ou le traitement de fichiers. |
| `min_instance_count` | `1` pour la production | Moyen | `0` provoque des démarrages à froid (>60 s) à la première requête après l'inactivité ; les jobs cron peuvent ne pas trouver d'instance chaude. |
| `application_version` | tag épinglé, pas `latest` | Moyen | `latest` rend le retour arrière ambigu ; Cloud Run ne peut pas distinguer deux pulls `latest`. |
| `enable_redis` | `true` lors de l'utilisation de sessions basées sur Redis | Moyen | Laissé `false` avec `settings.py` configuré pour Redis : `ConnectionRefusedError` à chaque accès au cache/session. |
| `ingress_settings` | `internal-and-cloud-load-balancing` pour les services privés équilibrés en charge | Moyen | `all` permet l'invocation directe de l'URL du point de terminaison Cloud Run en contournant Cloud Armor/IAP. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur d'administration de Django est autrement accessible publiquement à l'URL du service. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Django partagée
avec la variante GKE est décrite dans **[Django_Common](Django_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Django sur Cloud Run](../labs/Django_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Django sur GKE Autopilot](Django_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Django Common — Configuration d'application partagée](Django_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Custom Application Starter**.
