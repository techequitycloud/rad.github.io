---
title: "Tandoor sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Tandoor sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Tandoor_GKE.md @ e69407af sha256:77652af0ff77 -->

# Tandoor sur GKE Autopilot {#tandoor-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tandoor_GKE.png" alt="Tandoor sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tandoor Recipes est un gestionnaire de recettes et un planificateur de repas
auto-hébergé, open-source, sous licence AGPL-3.0, avec un backend API Python/Django
REST et un frontend Vue 3 intégré. Ce module déploie Tandoor sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Tandoor et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Tandoor sur RAD, et comment cela se compare {#what-tandoor-costs-on-rad-and-how-that-compares}

**Le module Tandoor sur GKE Autopilot de RAD coûte environ 91,31 $ US par mois dans un projet Google Cloud que vous possédez, avec des frais de module uniques de 75 crédits (7,50 $ US, ou 67,5 crédits dans un projet géré par RAD, soit 10 % de moins).** GKE convient à Tandoor qui doit coexister avec d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Tandoor_CloudRun.md) exécute le même Tandoor pour environ 68,61 $ US par mois, avec des frais de module inférieurs en conséquence. Si vous n'avez besoin de Tandoor qu'occasionnellement — pour planifier des repas pour une saison, l'essayer avant de vous engager — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **91,31 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **85 crédits par jour**, soit environ 2 550 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **91,31 $ US** |

### Comment cela se compare {#how-it-compares}

- Tandoor n'a pas de SaaS commercial hébergé propre — il est distribué uniquement en tant que logiciel open-source auto-hébergé, Docker-first, pour les foyers et les petits groupes qui souhaitent le gérer eux-mêmes.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — plus de machine que ce dont le pod Tandoor de 1 vCPU / 0,5 GiB a besoin, plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- La majeure partie du coût d'exécution de RAD dans votre propre projet ici est l'instance PostgreSQL gérée et les frais de cluster GKE partagés, et non le propre pod de Tandoor — la base de données serait également nécessaire sur un VPS nu, mais non gérée là-bas.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Tandoor s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL ou la ressource de calcul un par un : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez des recettes et des plans de repas que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Tandoor purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 80 crédits (environ 8 $ US) dans votre propre projet, ou 72,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Tandoor devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus (environ 3,04 $ US par jour), cela représente environ 3 jours ou plus, ou environ 1 jour ou plus dans un projet géré par RAD (85 crédits par jour). La majeure partie du coût d'exécution ici est la base de données et les frais de cluster partagés ; ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Tandoor alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Aucun SaaS commercial hébergé actuellement vérifié n'existe pour Tandoor, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

Tandoor s'exécute comme une seule charge de travail web tout-en-un — nginx
s'exécute *à l'intérieur* du conteneur et proxy vers gunicorn via un socket
Unix, donc aucun sidecar ou `additional_services` n'est nécessaire. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods à conteneur unique (nginx + gunicorn), 1 vCPU / 512 Mio par défaut, autoscalé horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Tandoor n'a pas de moteur de secours de production pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié provisionné automatiquement et monté à `/opt/recipes/mediafiles` (pour les images de recettes) |
| Cache | Redis (optionnel) | Vraiment optionnel — Django utilise un cache en mémoire locale lorsqu'il n'est pas défini ; pas de worker Celery/arrière-plan |
| Secrets | Secret Manager | `SECRET_KEY` Django auto-généré et mot de passe superutilisateur initial ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Tandoor_Common` corrige `database_type =
  "POSTGRES_15"` et `DB_ENGINE = django.db.backends.postgresql`. Le `boot.sh` de Tandoor interroge `pg_isready` avant de continuer — pas de connexion paresseuse.
- **Variables d'environnement Postgres discrètes, pas un DSN.** Tandoor lit `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` directement. Les valeurs `DB_*` standard de la plateforme sont aliasées sur ces noms via les variables de la fondation `db_*_env_var_name` — sur GKE, cela se résout en `127.0.0.1` du sidecar Cloud SQL Auth Proxy.
- **`SECRET_KEY` et le mot de passe superutilisateur sont générés automatiquement** et stockés dans Secret Manager. `SECRET_KEY` ne doit jamais être renouvelé après le premier démarrage sans fenêtre de maintenance.
- **Pas de credential admin fixe/codé en dur.** Contrairement à l'autre module de gestion de recettes de ce catalogue (Mealie), Tandoor a un job d'initialisation `create-superuser` qui amorce un credential réel et unique à partir de Secret Manager à chaque déploiement.
- **`service_type = LoadBalancer` et une IP statique réservée par défaut.** Tandoor est une interface utilisateur interactive basée sur un navigateur, il obtient donc une véritable IP externe — pas `ClusterIP` (qui ne convient qu'aux services internes).
- **NFS est désactivé par défaut.** Tandoor stocke toutes les données de l'application dans PostgreSQL et les images de recettes dans un bucket GCS auto-monté.
- **Redis est vraiment optionnel et désactivé par défaut.** Il n'y a pas de worker Celery ou de file d'attente à maintenir au chaud — l'activation de Redis n'affecte que le backend de cache de Django.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Tandoor {#a-gke-autopilot--the-tandoor-workload}

Les pods Tandoor sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. L'autoscaling horizontal des pods
dimensionne le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Tandoor pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, du scaling et du
type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tandoor stocke toutes les données de l'application (recettes, plans de repas,
listes de courses, utilisateurs) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth
Proxy** via un socket Unix. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application,
et un second job amorce le compte superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le
secret Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket `data` **Cloud Storage** dédié est provisionné automatiquement pour
les images de recettes. Le compte de service de la charge de travail se voit
accorder l'accès, et le bucket est monté par défaut à `/opt/recipes/mediafiles` (le `MEDIA_ROOT` de
Tandoor) via le pilote CSI GCS Fuse, de sorte que les images téléchargées
persistent après les redémarrages de pod.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache optionnel) {#d-redis-optional-cache}

Redis est **désactivé par défaut**. Tandoor n'a pas de worker Celery ou de
file d'attente en arrière-plan — l'activation de Redis ne fait que basculer
le backend de cache de Django de la mémoire locale vers une instance Redis
partagée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm REDIS_HOST injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets d'application sont générés automatiquement et stockés dans
Secret Manager : le `SECRET_KEY` Django et `DJANGO_SUPERUSER_PASSWORD`. Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=secret-<prefix>-tandoor-superuser-password --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing avec une adresse statique réservée. Un domaine personnalisé avec un
certificat géré par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests
de disponibilité et des stratégies d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Tandoor {#3-tandoor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  d'initialisation `db-init` crée de manière idempotente la base de données et
  l'utilisateur de l'application et accorde les privilèges. Le job peut être
  réexécuté en toute sécurité.
- **Amorçage du superutilisateur.** Le job d'initialisation `create-superuser` dépend de
  `db-init`. Il applique les migrations Django (idempotent — un filet de sécurité,
  car `execute_on_apply` de GKE ne contrôle que si Terraform *attend* le job, et non si le
  pod sous-jacent est planifié avant le premier démarrage du déploiement
  principal) puis exécute `python manage.py createsuperuser --noinput`, lisant `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` de
  l'environnement. Il vérifie d'abord l'existence d'un compte, de sorte que la
  réapplication du module ne génère pas d'erreur.
- **Migrations à chaque démarrage.** Le `boot.sh` de Tandoor applique les
  migrations Django à chaque démarrage de conteneur (idempotent).
- **`SECRET_KEY` est immuable après le premier démarrage.** Le renouveler invalide
  toutes les sessions actives et tous les jetons signés en cours (par exemple,
  les liens de réinitialisation de mot de passe).
- **Chemin de santé.** La sonde de démarrage cible `/accounts/login/` — la vue de connexion
  publique et non authentifiée de Django. La sonde de vivacité utilise à la
  place une simple vérification TCP (écoute de port), de sorte qu'un problème
  transitoire de base de données ne perturbe pas un pod déjà sain.
- **Connectez-vous avec le credential généré.** Récupérez `DJANGO_SUPERUSER_PASSWORD` de Secret
  Manager et connectez-vous à `/accounts/login/` avec le `admin_username` configuré (par défaut
  `admin`).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Tandoor sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tandoor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tandoor publie une véritable balise `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Tandoor utilise directement l'image officielle. |
| `container_image` | `""` | Laissez vide pour la valeur par défaut du module (`vabene1111/recipes`). |
| `min_instance_count` | `0` | Réplicas minimum. |
| `max_instance_count` | `1` | Réplicas maximum. |
| `container_port` | `80` | Le nginx de Tandoor écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Tandoor dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, `DJANGO_SUPERUSER_USERNAME`/`EMAIL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Tandoor est une interface utilisateur web interactive, il est donc exposé en externe par défaut. |
| `workload_type` | `Deployment` | Sans état — pas besoin de PVC. |
| `session_affinity` | `None` | Aucune exigence de session persistante (contrairement aux applications fortement basées sur WebSocket). |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — Sauvegarde et maintenance / StatefulSet {#group-7--backup--maintenance--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `stateful_pvc_enabled` | `null` | Non nécessaire — Tandoor est sans état (toutes les données dans Postgres + GCS optionnel). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota Kubernetes dans l'espace de noms de l'application. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Requêtes/limites CPU totales autorisées sur tous les pods. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Doit utiliser des suffixes d'unité binaire (par exemple `4Gi`, `8192Mi`) — les entiers bruts sont traités comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité et SQL personnalisé {#group-9--reliability-policies--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_custom_sql_scripts` | `false` | Exécuter du SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/accounts/login/` | Passe une fois que la connectivité Postgres et les migrations réussissent. |
| `health_check_config` | TCP | Une simple vérification d'écoute de port. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Stockage et jobs {#group-11--storage--jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire de jobs `db-init` + `create-superuser` intégrée. |
| `cron_jobs` | `[]` | Non utilisé — Tandoor n'a pas de tâches récurrentes planifiées par la plateforme. |
| `additional_services` | `[]` | Non nécessaire — aucun sidecar/routeur nginx requis. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires au-delà du bucket `data` auto-provisionné. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Laissez vide pour utiliser la valeur par défaut du module (le bucket `data` monté à `/opt/recipes/mediafiles` via le pilote CSI) ; une valeur fournie par l'opérateur la remplace. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Tandoor_Common` ; non transmis. |
| `application_database_name` | `tandoor` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `tandoor` | Utilisateur de la base de données de l'application. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` | `POSTGRES_HOST` | Nom de la variable d'environnement de l'hôte Postgres de Tandoor. |
| `db_user_env_var_name` | `POSTGRES_USER` | Nom de la variable d'environnement de l'utilisateur Postgres de Tandoor. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Nom de la variable d'environnement du mot de passe Postgres de Tandoor. |
| `db_name_env_var_name` | `POSTGRES_DB` | Nom de la variable d'environnement de la base de données Postgres de Tandoor. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Nom de la variable d'environnement du port Postgres de Tandoor. |
| `admin_username` | `admin` | Nom d'utilisateur superutilisateur initial. |
| `admin_email` | `admin@techequity.cloud` | E-mail superutilisateur initial. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Importation de sauvegarde {#group-17--backup-import}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements — recommandé pour toute application web. |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Tandoor. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `create-superuser`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment du plan. Une configuration
> invalide échoue au **plan** avec une erreur claire et nommée avant la
> création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler invalide toutes les sessions actives et tous les jetons signés en cours (par exemple, les liens de réinitialisation de mot de passe). |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide échoue au job d'importation. |
| Chemin `startup_probe_config` | `/accounts/login/` | Critique | Tandoor n'a pas d'autre point de terminaison de santé non authentifié ; pointer la sonde ailleurs renvoie 401/403 et le pod ne devient jamais prêt. |
| `service_type` | `LoadBalancer` | Élevé | `ClusterIP` (le bug de copier-coller trouvé sur de nombreux modules antérieurs) rend une application web interactive inaccessible depuis un navigateur. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL. |
| `DJANGO_SUPERUSER_PASSWORD` (auto-généré) | Récupérer de Secret Manager avant la première connexion | Moyen | Sans le récupérer, vous ne pouvez pas vous connecter — il n'y a pas de credential de secours comme le défaut fixe de Mealie. |
| `db_ssl_mode` (`PGSSLMODE`, défini en interne) | `prefer` sur GKE | Faible | La boucle de retour du sidecar Cloud SQL Auth Proxy est déjà en texte clair ; la couche commune de ce module par défaut correctement, donc cela ne devrait pas nécessiter d'attention manuelle. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP de l'équilibreur de charge peut changer lors du redéploiement, rompant les URL mises en signet. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Tandoor
partagée avec la variante Cloud Run est décrite dans
**[Tandoor_Common](Tandoor_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Tandoor sur GKE Autopilot](../labs/Tandoor_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Tandoor sur Google Cloud Run](Tandoor_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Tandoor Common — Configuration d'application partagée](Tandoor_Common.md) — la configuration partagée par les deux cibles de déploiement.
