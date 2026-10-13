---
title: "Tandoor sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Tandoor sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Tandoor_CloudRun.md @ e69407af sha256:538b5143fe0f -->

# Tandoor sur Google Cloud Run {#tandoor-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tandoor_CloudRun.png" alt="Tandoor sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tandoor Recipes est un gestionnaire de recettes et un planificateur de repas
auto-hébergé, open-source, sous licence AGPL-3.0, avec un backend d'API REST
Python/Django et un frontend Vue 3 intégré. Ce module déploie Tandoor sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Tandoor et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Tandoor sur RAD, et comparaison {#what-tandoor-costs-on-rad-and-how-that-compares}

**Tandoor sur le module Cloud Run de RAD coûte environ 68,61 $ US par mois
dans un projet Google Cloud que vous possédez, les frais de module étant
facturés une seule fois en crédits RAD.** Pour un coût d'exécution minimal,
cela reste sur Cloud Run ; GKE Autopilot ne vaut la peine que s'il doit
coexister avec d'autres charges de travail Kubernetes — voir le [guide GKE](Tandoor_GKE.md)
pour cette option, à environ 91,31 $ US par mois. Si vous n'avez besoin de
Tandoor qu'occasionnellement — pour planifier des repas pour une saison,
l'essayer avant de vous engager — un projet géré par RAD peut être supprimé
et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US)
au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause
gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ;
les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **68,61 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données et le réseau sont
partagés par chaque application du projet, de sorte qu'une deuxième
application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **68,61 $ US** |

### Comparaison {#how-it-compares}

- Tandoor n'a pas de SaaS commercial hébergé propre — il est distribué
  uniquement en tant que logiciel open-source auto-hébergé, Docker-first,
  pour les foyers et les petits groupes qui le gèrent eux-mêmes.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24
  $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois,
  et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois
  — toutes ces machines sont plus puissantes que les 1 vCPU / 1 GiB dont
  Tandoor a besoin ; une instance plus petite à vCPU partagé le ferait
  fonctionner confortablement, plus le temps de l'administrateur pour les
  sauvegardes, les correctifs de sécurité et les mises à niveau que Cloud SQL
  géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- La majeure partie du coût d'exécution de RAD dans votre propre projet est
  l'instance PostgreSQL gérée, et non le calcul propre de Tandoor — la même
  base de données dont Tandoor aurait besoin sur un VPS nu, mais non gérée.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Tandoor s'exécute dans un projet géré par RAD pour vous, la suppression du
projet entier délie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet — la suppression logicielle récupérable de 30 jours
de Google. Contrairement à la suppression d'un module, cela ne détruit pas
Cloud SQL ou la ressource de calcul un par un : le projet entier s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du
projet, demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes — c'est une vérification, pas une reconstruction, et une mise à jour
ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée
de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD gère
uniquement pour la facturation), vous devez le restaurer vous-même dans les
30 jours — après cela, Google le supprime définitivement — et la restauration
est admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez des recettes et des plans de repas que vous
souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30
jours est passée, l'alternative est de supprimer Tandoor purement et
simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau
les frais de module, plus les builds — environ 45 crédits (environ 4,50 $ US)
dans votre propre projet, ou 41 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Tandoor devait
rester inutilisé assez longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution quotidien — par rapport au total du
projet ci-dessus (environ 2,29 $ US par jour), cela représente environ 2 jours
ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (26 crédits
par jour). La majeure partie du coût d'exécution ici est la base de données ;
elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la
suppression de Tandoor pendant que quelque chose d'autre partage le projet
n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket
à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session
  pour une classe. Chaque participant obtient l'application dans son propre
  projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la
  propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF,
  XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration. Il n'existe pas de SaaS commercial
hébergé actuellement vérifié pour Tandoor, donc aucun prix concurrent n'est
mentionné.

## 1. Vue d'ensemble {#1-overview}

Tandoor s'exécute comme un conteneur tout-en-un unique sur Cloud Run v2 —
nginx s'exécute *à l'intérieur* du conteneur et se connecte à gunicorn via un
socket Unix, de sorte qu'aucun sidecar ou entrée `additional_services` n'est nécessaire. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur tout-en-un unique (nginx + gunicorn), 1 vCPU / 1 Gi par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Tandoor n'a pas de moteur de secours de production pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié provisionné automatiquement et monté à `/opt/recipes/mediafiles` (images de recettes) |
| Cache | Redis (facultatif) | Vraiment facultatif — Django revient au cache en mémoire locale lorsqu'il n'est pas défini ; pas de Celery/worker en arrière-plan |
| Secrets | Secret Manager | `SECRET_KEY` Django auto-généré et mot de passe superutilisateur initial ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Tandoor_Common` corrige `database_type =
  "POSTGRES_15"` et `DB_ENGINE = django.db.backends.postgresql`.
  Le `boot.sh` de Tandoor interroge `pg_isready` avant de continuer — pas de
  connexion paresseuse — donc la base de données doit être accessible au
  démarrage du conteneur.
- **Variables d'environnement Postgres discrètes, pas un DSN.** Tandoor lit
  `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB`
  directement. Les valeurs `DB_*` standard de la plateforme sont
  aliassées sur ces noms via les variables de la fondation `db_*_env_var_name`. Aucun
  encodage d'URL ou point d'entrée personnalisé n'est nécessaire.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés
  automatiquement** et stockés dans Secret Manager. `SECRET_KEY` ne doit
  jamais être renouvelé après le premier démarrage sans fenêtre de
  maintenance — le renouveler invalide toutes les sessions actives et tous les
  jetons signés (par exemple, les liens de réinitialisation de mot de passe)
  en cours.
- **Aucun identifiant d'administrateur fixe/codé en dur.** Contrairement à
  l'autre module de gestion de recettes de ce catalogue (Mealie, qui fournit
  un `changeme@example.com`/`MyPassword` non documenté et non configurable), Tandoor
  dispose d'un job d'initialisation `create-superuser` qui amorce un identifiant réel
  et unique à partir de Secret Manager à chaque déploiement.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Tandoor n'a pas de worker en arrière-plan ou de
  planificateur de tâches — son scraping d'importation d'URL de recettes
  s'exécute de manière synchrone dans la requête déclenchante — donc la
  facturation basée sur les requêtes n'a pas besoin d'être annulée.
- **Redis est vraiment facultatif et désactivé par défaut.** `CACHES['default']` ne
  passe à Redis que si `REDIS_HOST` est défini ; sinon, le cache en mémoire
  locale intégré de Django est utilisé. Il n'y a pas de worker ou de file
  d'attente Celery à maintenir au chaud.
- **Le stockage des images de recettes est monté GCS par défaut.** `Tandoor_Common`
  déclare une entrée `gcs_volumes` montant le bucket `data`
  (`gcs-<application_name><tenant_prefix>-data`) à `/opt/recipes/mediafiles`, de sorte que les images de recettes
  téléchargées persistent entre les révisions au lieu de vivre sur un disque
  de conteneur éphémère. Un `gcs_volumes` fourni par l'opérateur remplace cette
  valeur par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms des services et des ressources sont signalés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Tandoor {#a-cloud-run--the-tandoor-service}

Tandoor s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tandoor stocke toutes les données d'application (recettes, plans de repas,
listes de courses, utilisateurs) dans une instance Cloud SQL pour PostgreSQL
15 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur
un socket Unix (bien que l'alias `db_host_env_var_name` utilisé par le `POSTGRES_HOST` de
Tandoor se résolve en l'adresse IP privée brute sur Cloud Run — voir le
tableau des pièges). Lors du premier déploiement, un job d'initialisation
crée la base de données et l'utilisateur de l'application, et un second job
amorce le compte superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot
de passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket `data` **Cloud Storage** dédié est provisionné
automatiquement pour les images de recettes et monté dans le conteneur à
`/opt/recipes/mediafiles` (le `MEDIA_ROOT` de Tandoor) via GCS FUSE. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets` ; la fourniture de
votre propre `gcs_volumes` remplace le montage par défaut.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut**. Tandoor n'a pas de worker Celery ou de
file d'attente en arrière-plan — l'activation de Redis ne fait que basculer
le backend de cache de Django de la mémoire locale vers une instance Redis
partagée, utile pour les déploiements multi-instances qui ont besoin d'un
cache partagé.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets d'application sont générés automatiquement et stockés dans
Secret Manager : le `SECRET_KEY` Django (signature cryptographique pour les
sessions, les jetons CSRF, les liens de réinitialisation de mot de passe) et
`DJANGO_SUPERUSER_PASSWORD` (la connexion initiale du superutilisateur). Le mot de passe de
la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=secret-<prefix>-tandoor-superuser-password --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'ingress et le contrôle d'égresse
VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Tandoor {#3-tandoor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  d'initialisation `db-init` s'exécute à l'aide de `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base
  de données et l'utilisateur de l'application et accorde les privilèges. Le
  job peut être réexécuté en toute sécurité.
- **Amorçage du superutilisateur.** Le job d'initialisation `create-superuser`
  dépend de `db-init`. Il applique les migrations Django (idempotent — un
  filet de sécurité, car `boot.sh` migre également à chaque démarrage du
  conteneur du service principal, mais le job d'initialisation peut
  s'exécuter avant que ce premier démarrage ne soit terminé) puis exécute
  `python manage.py createsuperuser --noinput`, lisant `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD`
  à partir de l'environnement. Il vérifie d'abord l'existence d'un compte, de
  sorte que la réapplication du module ne génère pas d'erreur sur une
  instance déjà amorcée.
- **Migrations à chaque démarrage.** Le `boot.sh` de Tandoor applique les
  migrations Django à chaque démarrage du conteneur (idempotent), de sorte que
  la mise à niveau de `application_version` applique automatiquement les modifications
  de schéma.
- **`SECRET_KEY` est immuable après le premier démarrage.** Généré une fois
  et écrit dans Secret Manager. Le renouveler invalide toutes les sessions
  actives et tous les jetons signés en cours (par exemple, les liens de
  réinitialisation de mot de passe). Ne le renouvelez que pendant une fenêtre
  de maintenance planifiée.
- **Chemin de santé.** La sonde de démarrage cible `/accounts/login/` — la vue de
  connexion publique et non authentifiée de Django — car Tandoor n'a pas de
  point de terminaison de santé/info dédié. Elle ne renvoie 200 qu'une fois
  que l'application s'est connectée à Postgres et a appliqué les migrations,
  ce qui en fait un véritable signal de disponibilité. La sonde de vivacité
  cible le même chemin via HTTP : Cloud Run rejette purement et simplement les
  sondes de vivacité de type TCP ("Cloud Run ne prend actuellement pas en
  charge les sockets TCP dans la sonde de vivacité" — TCP n'est là que pour
  les sondes de démarrage), donc `Tandoor_CloudRun` remplace la valeur par défaut de
  vivacité TCP de `Tandoor_Common` par une sonde HTTP.
- **Connectez-vous avec l'identifiant généré.** Récupérez `DJANGO_SUPERUSER_PASSWORD` de
  Secret Manager et connectez-vous à `/accounts/login/` avec le `admin_username`
  configuré (par défaut `admin`).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Tandoor sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tandoor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Tandoor` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Tandoor recipe manager on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tandoor publie une véritable balise `latest` — passe directement comme balise d'image. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Tandoor utilise directement l'image officielle — aucune build personnalisée n'est nécessaire. |
| `container_image` | `""` | Laissez vide pour la valeur par défaut du module (`vabene1111/recipes`). |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. Gunicorn de Tandoor (3 workers) + nginx + django-vite OOM-crash-loop à 512 Mi — 1 Gi est le minimum. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | `1` | Augmenter pour le trafic concurrent. |
| `container_port` | `80` | Nginx de Tandoor écoute sur le port 80 (`TANDOOR_PORT`). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — pas de worker en arrière-plan à maintenir au chaud. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Tandoor dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, `DJANGO_SUPERUSER_USERNAME`/`EMAIL` sont définis automatiquement — ne les remplacez pas ici à moins de savoir ce que vous modifiez. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` —
exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `data` auto-provisionné. |
| `gcs_volumes` | `[]` | Vide signifie que la valeur par défaut du module s'applique (le bucket `data` à `/opt/recipes/mediafiles`) ; toute entrée ici remplace entièrement cette valeur par défaut. |
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Tandoor_Common` ; non transféré. |
| `application_database_name` | `tandoor` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `tandoor` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` | `POSTGRES_HOST` | Nom de la variable d'environnement de l'hôte Postgres de Tandoor. |
| `db_user_env_var_name` | `POSTGRES_USER` | Nom de la variable d'environnement de l'utilisateur Postgres de Tandoor. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Nom de la variable d'environnement du mot de passe Postgres de Tandoor. |
| `db_name_env_var_name` | `POSTGRES_DB` | Nom de la variable d'environnement de la base de données Postgres de Tandoor. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Nom de la variable d'environnement du port Postgres de Tandoor. |
| `admin_username` | `admin` | Nom d'utilisateur initial du superutilisateur (`DJANGO_SUPERUSER_USERNAME`). |
| `admin_email` | `admin@techequity.cloud` | E-mail initial du superutilisateur (`DJANGO_SUPERUSER_EMAIL`). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire de jobs intégrée `db-init` + `create-superuser`. |
| `cron_jobs` | `[]` | Non utilisé — Tandoor n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/accounts/login/` délai de 30s | Sonde de démarrage — passe une fois que la connectivité Postgres et les migrations réussissent. |
| `liveness_probe` | HTTP `/accounts/login/` délai de 30s | Sonde de vivacité — HTTP, car Cloud Run ne prend pas en charge les sondes de vivacité TCP. |
| `startup_probe_config` | HTTP `/accounts/login/` | Sonde structurée alternative transmise directement à la Fondation. |
| `health_check_config` | TCP | Sonde de vivacité structurée alternative transmise directement à la Fondation. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de la disponibilité de Cloud Monitoring ; activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Tandoor ne nécessite pas Redis ; laissez `false` à moins d'intégrer une instance externe. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `create-superuser`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide échoue à la **planification** avec une erreur claire
> et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler invalide toutes les sessions actives et tous les jetons signés en cours (par exemple, les liens de réinitialisation de mot de passe). |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide échoue au job d'importation. |
| Chemin `startup_probe` | `/accounts/login/` | Critique | Pointer la sonde vers un point de terminaison authentifié/administrateur renvoie 401/403 et la révision ne devient jamais prête — Tandoor n'a pas d'autre point de terminaison de santé non authentifié. |
| Formule `gcs_volumes` bucket_name | `gcs-tandoor<tenant_prefix>-data` | Élevé | Un mauvais préfixe monte un bucket inexistant, laissant le pod bloqué à Init. |
| `DJANGO_SUPERUSER_PASSWORD` (auto-généré) | Récupérer de Secret Manager avant la première connexion | Moyen | Sans le récupérer, vous ne pouvez pas vous connecter — il n'y a pas d'identifiant de secours comme le défaut fixe de Mealie. |
| `db_ssl_mode` (`PGSSLMODE`, défini en interne) | `require` sur Cloud Run | Élevé | L'alias `db_host_env_var_name` se résout en l'adresse IP privée brute de Cloud SQL sur Cloud Run (pas un socket), qui rejette le TCP non chiffré — ce module code en dur `require` dans son câblage, donc cela ne devrait pas nécessiter d'attention manuelle, mais ne le remplacez pas par `disable`. |
| `enable_redis` | `false` sauf si nécessaire | Faible | Tandoor n'a pas de worker en arrière-plan ; Redis n'affecte que le backend de cache de Django. |
| `ingress_settings` | `all` pour une application publique | Moyen | La définition à `internal` bloque l'accès au navigateur à moins d'être associée à IAP ou à un chemin réseau privé. |
| `memory_limit` | `1Gi` | Élevé | Confirmé en direct : Tandoor OOM-crash-loops à 512 Mi (workers gunicorn SIGKILLed). Gen2 applique également son propre plancher de 512 Mi quel que soit le mode de facturation. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à Tandoor partagée avec la variante GKE
est décrite dans **[Tandoor_Common](Tandoor_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Tandoor sur Cloud Run](../labs/Tandoor_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Tandoor sur GKE Autopilot](Tandoor_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Tandoor Common — Configuration d'application partagée](Tandoor_Common.md) — la configuration partagée par les deux cibles de déploiement.
