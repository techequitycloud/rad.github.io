---
title: "Django sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Django sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Django_GKE.md @ e69407af sha256:9aa42a39b7e2 -->

# Django sur GKE Autopilot {#django-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Django_GKE.png" alt="Django sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Django est un framework web Python éprouvé qui encourage le développement rapide et
une conception propre et pragmatique, alimentant certaines des applications web les plus exigeantes au monde.
Ce module déploie Django sur **GKE Autopilot** sur la base de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Django et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte Django sur RAD, et comment cela se compare {#what-django-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Django sur RAD coûte environ 106,53 $ US par mois.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Pour le coût le plus bas, le [guide Cloud Run](Django_CloudRun.md) exécute le même Django pour environ 81,23 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 106,53 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **106,53 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **97 crédits par jour**, soit environ 2 910 par mois (environ 291 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 106,53 $ US** |

### Comment cela se compare {#how-it-compares}

- Django est un framework, pas un produit packagé, il n'y a donc pas de plan commercial "hébergement Django" à comparer — la comparaison honnête est un serveur nu : un Hetzner CPX22 ou un droplet DigitalOcean 2 vCPU/4 Go coûte environ 24 $ US par mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $ US — plus votre propre temps pour la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation, que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- Ce que vous évaluez réellement, c'est la part de la couche applicative qui est personnalisée. Pour une API mince ou un outil d'administration, un petit VPS peut suffire ; pour tout ce qui a de réelles exigences d'intégrité des données, une base de données gérée vaut plus que la différence de prix ne le suggère.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Django s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Django dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité
saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou le pod GKE un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Django, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 106,53 $ US.** Déployez Django, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Django était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc
  très probablement supprimé dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Django. La suppression permet d'économiser de l'argent une fois que Django resterait inutilisé
  pendant environ **3 jours ou plus** dans votre propre projet (environ 3,55 $ US par jour), ou environ
  **1 jour ou plus** dans un projet géré par RAD (97 crédits par jour).
- **Supprimez tout ce que Django utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet ne sauve que la partie calcul de Django.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez les
  paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  Django dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur.
  Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Django pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Django s'exécute comme une charge de travail web Python/Gunicorn. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Gunicorn, 1 vCPU / 512 Mio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — `DB_ENGINE` de Django est fixé à `django.db.backends.postgresql` |
| Fichiers partagés | Filestore (NFS) | Médias et téléchargements partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket de médias dédié provisionné par Django_Common |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe de base de données auto-générés |
| Cache (optionnel) | Redis / Cloud Memorystore | Désactivé par défaut ; activer pour le stockage de sessions et la mise en cache |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est fixe.** `Django_Common` lie `DB_ENGINE` à PostgreSQL ;
  MySQL et `NONE` ne sont pas pris en charge par ce module.
- **Le `SECRET_KEY` de Django est auto-généré** et stocké dans Secret Manager ;
  il est injecté à l'exécution et jamais défini en texte clair.
- **Quatre extensions PostgreSQL sont installées automatiquement** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) par le job `db-init`, vous n'avez donc pas besoin de les configurer.
- **Deux jobs d'initialisation s'exécutent par défaut** — `db-init` (crée la base de données et
  l'utilisateur) et `db-migrate` (exécute `manage.py migrate` et `collectstatic`).
- **NFS est activé par défaut.** Tous les réplicas de pods partagent le même volume Filestore
  pour les fichiers multimédias téléchargés. L'affinité de session est par défaut `ClientIP`.
- **Redis est désactivé par défaut.** Activez-le avec `enable_redis = true` et pointez vers une
  instance Cloud Memorystore pour le stockage de sessions et la mise en cache en production.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count` est par défaut `0` ; définissez-le sur `1`
  pour la production afin d'éliminer les démarrages à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Django {#a-gke-autopilot--the-django-workload}

Les pods Django sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Django pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Django stocke toutes les données de l'application dans une instance Cloud SQL pour PostgreSQL 15 gérée.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix,
donc aucune IP publique n'est exposée. Un job `db-init` s'exécute à chaque apply (idempotent)
et crée la base de données et l'utilisateur de l'application, installe les extensions requises et
accorde les privilèges. Le job `db-migrate` exécute ensuite `manage.py migrate` et
`manage.py collectstatic`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm DB env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^(DB_|SECRET_KEY)"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits sur un partage **Filestore (NFS)** monté dans chaque pod afin que
tous les réplicas voient les mêmes fichiers. Un bucket de médias **Cloud Storage** dédié est également
provisionné automatiquement par `Django_Common` ; le compte de service de la charge de travail se voit accorder
l'accès.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de médias.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, Django reçoit
`REDIS_HOST` et `REDIS_PORT` comme variables d'environnement. Configurez `settings.py` pour
les utiliser pour `CACHES` et `SESSION_ENGINE`. Le module ne provisionne pas d'instance Redis —
utilisez une instance Cloud Memorystore et définissez `redis_host` sur son IP privée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_HOST and REDIS_PORT are injected:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Le `SECRET_KEY` de Django et le mot de passe de la base de données sont stockés en tant que secrets Secret Manager
et injectés dans les pods à l'exécution ; le texte en clair n'apparaît jamais dans la configuration.
Le mot de passe du superutilisateur (si vous en créez un via `DJANGO_SUPERUSER_PASSWORD`) doit
également être stocké ici.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé via
`enable_custom_domain`, et une IP statique peut être réservée afin que l'adresse survive
aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des tests de disponibilité et des stratégies d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Django {#3-django-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` crée la base de données
  et l'utilisateur PostgreSQL, accorde les privilèges et installe les quatre extensions requises (`pg_trgm`,
  `unaccent`, `hstore`, `citext`) en utilisant le secret superutilisateur `ROOT_PASSWORD`. Le job
  est idempotent et peut être réexécuté en toute sécurité.
- **Migrations au premier déploiement.** Un job `db-migrate` exécute `manage.py migrate` et
  `manage.py collectstatic --noinput --clear` après que `db-init` soit terminé. Ces jobs
  s'exécutent avec `execute_on_apply = true` par défaut. Remplacez `initialization_jobs` par
  une liste non vide pour les remplacer par des jobs personnalisés.
- **Gestion de `SECRET_KEY`.** Une clé aléatoire de 50 caractères est générée par
  `Django_Common` et stockée dans Secret Manager. Elle est injectée en tant que `SECRET_KEY`.
  Ne définissez pas `SECRET_KEY` dans `environment_variables`.
- **Création du superutilisateur.** Si `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`,
  et `DJANGO_SUPERUSER_PASSWORD` sont présents en tant que variables d'environnement lorsque le
  conteneur démarre, `entrypoint.sh` crée un superutilisateur Django au premier démarrage. Utilisez
  `secret_environment_variables` pour le mot de passe :
  ```bash
  # Retrieve the SECRET_KEY or superuser password from Secret Manager
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```
- **Tâches planifiées.** Les commandes de gestion Django (par exemple, `clearsessions`) peuvent être
  planifiées en tant que CronJobs Kubernetes via la variable `cron_jobs` :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Sondes de santé.** La sonde de démarrage par défaut cible `GET /healthz` avec un
  délai initial de 90 secondes (pour permettre les migrations au premier démarrage) et la sonde de vivacité
  cible `GET /healthz` avec un délai initial de 60 secondes. `/healthz` est défini dans le
  fichier `urls.py` au niveau du projet, de sorte qu'il continue de renvoyer HTTP 200 après avoir remplacé l'application exemple à `/` — ce qui est important car la sonde est mise en miroir dans la vérification de santé de la passerelle, et une vue racine qui redirige vers une connexion laisserait autrement la passerelle servir 503 derrière un pod prêt. Conservez cette route si vous restructurez `urls.py`.
- **Affinité de session.** Par défaut à `ClientIP` afin que les requêtes d'un utilisateur donné soient
  acheminées vers le même pod. Définissez `session_affinity = "None"` lorsque tout l'état de session est
  externalisé vers la base de données ou Redis.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Django sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `django` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `Django Application` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image ; incrémenter pour déployer une nouvelle build. Épingler à un tag spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | Remplacer l'URI de l'image du conteneur. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire par pod. |
| `min_instance_count` | `0` | Réplicas minimum. Définir ≥ 1 pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8080` | Django/Gunicorn écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas inclure `SECRET_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager (par exemple, `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour le stockage de session en cours de processus. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled` est défini. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC dans un StatefulSet. Normalement pas nécessaire pour Django. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les nombres de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité pendant les mises à niveau de nœuds. Désactivé par défaut car la valeur par défaut `max_instance_count` est 1. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /healthz`, délai initial de 90s | Sonde de démarrage passée à `Django_Common`. Augmenter le délai pour les grands ensembles de migration. |
| `liveness_probe` | HTTP `GET /healthz`, délai initial de 60s | Sonde de vivacité passée à `Django_Common`. |
| `startup_probe_config` | TCP, délai d'expiration de 240s | Sonde de démarrage de l'infrastructure au niveau App_GKE. |
| `health_check_config` | HTTP `GET /`, délai d'expiration de 1s | Sonde de vivacité de l'infrastructure au niveau App_GKE. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring optionnel ; désactivé par défaut. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` (utilise `db-init` + `db-migrate` intégrés) | Laisser vide pour utiliser les jobs de configuration de base de données et de migration par défaut. Fournir une liste non vide pour les remplacer par des jobs personnalisés. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, `clearsessions`, `cleartokens`). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Django. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Django (garder activé pour les réplicas multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. Doit correspondre à `MEDIA_ROOT` dans `settings.py`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. Le bucket de médias est toujours provisionné par `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket de médias auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneurs récentes conservées dans Artifact Registry par déploiement. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées/orphelines du dépôt créé en ligne. |
| `image_retention_days` | `30` | Jours après lesquels les images deviennent éligibles à la suppression ; `0` désactive la suppression basée sur l'âge. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage de sessions et la mise en cache. |
| `redis_host` | `""` | IP ou nom d'hôte de l'hôte Redis. Laisser vide pour revenir à l'IP du serveur NFS lorsqu'il est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | **PostgreSQL requis.** Django ne prend pas en charge MySQL via ce module. |
| `application_database_name` | `gkeapp` | Nom de la base de données. **Recommandé : définir sur `django_db`.** Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de l'application. **Recommandé : définir sur `django_user`.** Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` | `false` | Définir `true` uniquement pour installer des extensions **supplémentaires** au-delà de `pg_trgm`, `unaccent`, `hstore` et `citext` (qui sont toujours installées). |
| `postgres_extensions` | `[]` | Extensions PostgreSQL supplémentaires (par exemple, `postgis`, `uuid-ossp`). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définir `enable_backup_import = false` après une importation réussie. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services de l'étape Cloud Deploy. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Django. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critique | Django nécessite PostgreSQL ; MySQL ou `NONE` fera échouer le job `db-init`. |
| `application_name` / `tenant_id` | défini une fois | Critique | Intégré dans les noms de ressources ; la modification recrée toutes les ressources nommées et détruit les données. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod. |
| `startup_probe` `failure_threshold` | ≥ 30 avec migrations | Critique | Trop faible : Kubernetes tue le pod avant la fin des migrations, provoquant une boucle de redémarrage. |
| `cloudsql_volume_mount_path` | `/cloudsql` (par défaut) | Critique | Mauvais chemin : `db-init.sh` ne peut pas trouver le socket du proxy d'authentification ; toutes les opérations de base de données échouent. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` réexécute l'importation à chaque apply, écrasant les données en direct avec une sauvegarde obsolète. |
| `enable_nfs` | `true` (par défaut) | Élevé | La désactivation avec `max_instance_count > 1` signifie que chaque pod a un stockage éphémère isolé ; les téléchargements sont perdus au redémarrage. |
| `nfs_mount_path` | `/mnt/nfs` — doit correspondre à `MEDIA_ROOT` | Élevé | Une non-concordance entraîne l'écriture des médias par Django dans un stockage local éphémère ; les fichiers sont perdus au redémarrage du pod. |
| `container_resources` mémoire | ≥ `512Mi` ; augmenter pour les charges de travail intensives en ORM | Élevé | Trop peu de mémoire : le pod est OOMKilled (code de sortie 137) sur de grands querysets ou le traitement de fichiers. |
| `min_instance_count` | `1` pour la production | Moyen | `0` provoque des démarrages à froid (>60 s) à la première requête après l'inactivité ; les tâches planifiées peuvent ne trouver aucun pod. |
| `application_version` | tag épinglé, pas `latest` | Moyen | `latest` rend le retour arrière ambigu ; Kubernetes ne peut pas distinguer deux pulls `latest`. |
| `enable_redis` | `true` lors de l'utilisation de sessions basées sur Redis | Moyen | Laissé `false` avec `settings.py` configuré pour Redis : `ConnectionRefusedError` à chaque accès au cache/session. |
| `session_affinity` | `ClientIP` pour les sessions basées sur une base de données | Moyen | `None` avec mise en cache en cours de processus : les requêtes du même utilisateur peuvent atteindre différents pods, perdant le cache. |
| `enable_pod_disruption_budget` | `false` lorsque `max_instance_count = 1` | Élevé | `true` avec un seul réplica bloque les drains de nœuds et bloque la maintenance du cluster. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur d'administration de Django est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Django
partagée avec la variante Cloud Run est décrite dans
**[Django_Common](Django_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Django sur GKE Autopilot](../labs/Django_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Django sur Cloud Run](Django_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Django Common — Configuration d'application partagée](Django_Common.md) — la configuration partagée par les deux cibles de déploiement.
