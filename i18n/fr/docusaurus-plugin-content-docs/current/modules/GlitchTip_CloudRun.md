---
title: "GlitchTip sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de GlitchTip sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GlitchTip_CloudRun.md @ 1665a43e sha256:914431885cd8 -->

# GlitchTip sur Google Cloud Run {#glitchtip-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GlitchTip_CloudRun.png" alt="GlitchTip sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GlitchTip est une plateforme open source de suivi d'erreurs et de surveillance des
performances (Django/Python), compatible Sentry. Vos applications envoient les
exceptions et les traces au point d'ingestion du protocole Sentry de GlitchTip,
et GlitchTip les stocke, les déduplique et les signale. Ce module déploie
GlitchTip sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par GlitchTip et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte GlitchTip sur RAD, et comment cela se compare {#what-glitchtip-costs-on-rad-and-how-that-compares}

**L'exécution de GlitchTip dans votre propre projet Google Cloud coûte environ 180,87 $ US/mois en frais Google Cloud, en plus d'un coût de module RAD unique de 300 crédits** (270 crédits — 10 % de moins — dans un projet géré par RAD). GlitchTip est une plateforme open source de suivi d'erreurs et de surveillance des performances d'applications, compatible Sentry. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettez-le en pause gratuitement" ci-dessous.

*GlitchTip est également disponible sur GKE — consultez le [guide GKE](GlitchTip_GKE.md) si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **300 crédits** (une fois) | **270 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~180,87 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~83 crédits/jour (~8,30 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **180,87 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan payant le moins cher de **GlitchTip hébergé**, Small, coûte 15 $ US/mois (jusqu'à 100 000 événements/mois) — vérifié sur [https://glitchtip.com/pricing](https://glitchtip.com/pricing). Cela est inférieur à la facture Google Cloud de RAD d'environ 180,87 $ US/mois pour la variante Cloud Run, rien qu'en prix affiché, mais cela plafonne l'utilisation ; l'instance de RAD est illimitée, auto-hébergée, et les données ne quittent jamais votre propre projet.
- Le véritable compromis ici est entre le plafond et le contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si GlitchTip s'exécute dans un **projet géré par RAD**, vous pouvez arrêter de le payer
entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation,
puis demande à Google de supprimer purement et simplement le projet — la suppression
logique récupérable de 30 jours de Google. Contrairement à la suppression du module
GlitchTip seul, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une
par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de récupérer le projet et de rattacher son compte de facturation, puis vous
demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est
revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise
à jour ne facture plus jamais les frais de module. Cela ne coûte qu'une poignée de
crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une
chaîne de déploiement typique de 2 à 3. Les frais de module de 270 crédits ne sont pas
facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD gère
uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours —
après cela, Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, donc votre solde de crédits achetés doit toujours
dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des
utilisations d'étude/démo conviennent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé GlitchTip et que vous souhaitez conserver ce travail, copiez une
sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer.
Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si GlitchTip se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés
sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement
et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ
**300 + ~3–6 crédits** (~30,45 $ US) dans votre propre projet, ou
**270 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si GlitchTip reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût
d'exécution : environ **6 jours ou plus** d'inactivité dans votre propre projet (par
rapport à sa facture Google Cloud d'environ 180,87 $ US/mois), ou **environ 4 jours ou
plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~83 crédits/jour).

La majeure partie du coût d'exécution de GlitchTip est la base de données et la VM de
fichiers/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les
utilise, donc la suppression de cette application alors que quelque chose d'autre
partage le projet n'économise que la part de calcul de cette application sur le total
ci-dessus.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière
sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google Cloud
  pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie
  la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés
  retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  mise en pause et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin, le partenaire remet le projet et les déploiements
  deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
  GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits
quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration ; [tarification de GlitchTip hébergé](https://glitchtip.com/pricing)
pour les chiffres de GlitchTip hébergé.

## 1. Vue d'ensemble {#1-overview}

GlitchTip s'exécute en tant que conteneur Python sur Cloud Run v2, servi par **Granian**
sur le port 8080. Le rôle de serveur `all_in_one` exécute le serveur web, le worker Celery et
Celery beat à l'intérieur du même conteneur. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Django/Granian, 2 vCPU / 4 GiB par défaut ; `min_instance_count = 1` maintient le worker/beat en vie |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — GlitchTip ne prend pas en charge MySQL ou d'autres moteurs |
| File d'attente de tâches et cache | Cloud SQL (PostgreSQL) | `VALKEY_URL = ""` achemine la file d'attente Celery, le cache et les sessions via Postgres ; Redis est facultatif |
| Stockage d'objets / de fichiers | Cloud Storage + NFS | Un bucket de données `storage` ; NFS monté à `/opt/glitchtip/storage` pour les pièces jointes téléchargées |
| Secrets | Secret Manager | `SECRET_KEY` Django auto-généré et le mot de passe initial du superutilisateur ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **L'image est une construction personnalisée légère.** GlitchTip est construit
  `FROM glitchtip/glitchtip:6.2.0` avec un point d'entrée cloud qui compose `DATABASE_URL` à partir des variables
  `DB_*` injectées (le mot de passe de la base de données est un secret d'exécution,
  non interpolable au moment de la planification) et désactive Valkey/Redis avant de
  passer au propre `./bin/start.sh` de l'image.
- **Pas de Redis par défaut.** `VALKEY_URL = ""` signifie que la file d'attente Celery, le
  cache et les sessions utilisent tous PostgreSQL. C'est correct pour une seule
  instance toujours active ; n'activez Redis que lorsque vous avez besoin de mettre à
  l'échelle la flotte de workers.
- **`min_instance_count = 1` et `cpu_always_allocated = true`.** Parce que le worker et le beat Celery
  s'exécutent en interne (`SERVER_ROLE = all_in_one`), la mise à l'échelle à zéro ou la limitation du
  CPU entre les requêtes arrêterait le traitement des événements en arrière-plan et le
  nettoyage planifié.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés automatiquement** et
  stockés dans Secret Manager. `SECRET_KEY` est injecté dans le conteneur ; le mot de
  passe du superutilisateur n'est consommé que par le job `glitchtip-migrate`.
- **Le propriétaire initial est amorcé, pas auto-enregistré.** `glitchtip-migrate` crée le
  superutilisateur `admin@techequity.cloud` ; `ENABLE_OPEN_USER_REGISTRATION` par défaut à `false`.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin que les SDK
  d'application et les navigateurs puissent atteindre le point d'ingestion et le
  tableau de bord. L'activation d'IAP bloque l'ingestion d'événements non
  authentifiés.
- **La rétention des événements est de 90 jours** (`GLITCHTIP_MAX_EVENT_LIFE_DAYS = 90`) ; les événements
  stockés plus anciens sont purgés par le worker en arrière-plan.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service GlitchTip {#a-cloud-run--the-glitchtip-service}

GlitchTip s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs. Étant donné que le worker/beat est intégré, le service est maintenu
chaud (`min_instance_count = 1`, `cpu_always_allocated = true`).

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GlitchTip stocke toutes les données d'application (projets, problèmes, événements,
utilisateurs et file d'attente Celery) dans une instance Cloud SQL gérée pour
PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un
socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, les jobs
`db-init` et `glitchtip-migrate` créent la base de données et l'utilisateur, exécutent les
migrations et créent le superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
sont dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de données **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement. Les pièces jointes et les cartes sources téléchargées de GlitchTip
sont stockées sur **NFS** monté à `/opt/glitchtip/storage` par défaut (`enable_nfs = true`).

- **Console :** Cloud Storage → Buckets ; Filestore/Compute Engine pour le serveur NFS.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Redis / Valkey (facultatif) {#d-redis--valkey-optional}

Redis est **désactivé par défaut** (`VALKEY_URL = ""` → file d'attente et cache basés sur
PostgreSQL). La définition de `enable_redis = true` et la fourniture de `redis_host` dirigent le
broker Celery et le cache de GlitchTip vers Redis/Valkey — utile uniquement lorsque
vous séparez la flotte de workers du niveau web à des volumes plus élevés.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the queue backend in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets sont générés automatiquement : le `SECRET_KEY` Django (signature de session)
et le mot de passe initial du superutilisateur (consommé par le job de migration). Le
mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible via son URL `run.app` par défaut, ce qui permet l'accès
public requis pour l'ingestion d'événements SDK. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés
; les paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GlitchTip {#3-glitchtip-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  (`postgres:15-alpine`) se connecte via le Cloud SQL Auth Proxy et crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde les
  privilèges et réattribue le schéma `public`. Il peut être réexécuté en toute
  sécurité.
- **Migrations + amorçage du superutilisateur.** Le job `glitchtip-migrate` s'exécute sur
  l'image GlitchTip construite (`depends_on = ["db-init"]`). Il compose `DATABASE_URL`, exécute
  `./manage.py migrate --noinput`, puis `createsuperuser --noinput` en utilisant `SUPERUSER_EMAIL` (`admin@techequity.cloud`) et le mot de
  passe du superutilisateur de Secret Manager. Un compte en double est ignoré, donc les
  réexécutions sont sûres. Le mot de passe initial de l'administrateur se trouve dans
  Secret Manager (`secret-<prefix>-<app>-superuser-password`).
- **Rôle de serveur `all_in_one`.** `SERVER_ROLE = all_in_one` exécute le serveur web, le worker
  Celery et le beat dans un seul conteneur. Gardez `min_instance_count >= 1` et `cpu_always_allocated = true` — la
  mise à l'échelle à zéro arrête l'ingestion en arrière-plan et la purge quotidienne
  de rétention des événements.
- **`SECRET_KEY` ne doit pas être modifié à la légère.** Il signe les sessions/cookies
  ; le modifier déconnecte tout le monde.
- **L'ingestion d'événements nécessite une entrée publique.** Les SDK d'application
  POSTent les événements vers le point d'ingestion (`/api/<project>/store/` et le point
  d'enveloppe). Gardez `ingress_settings = "all"` ; l'activation d'IAP bloque l'ingestion SDK (ne
  placez IAP que devant le tableau de bord si vous séparez les préoccupations).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par
  défaut. Prévoyez plusieurs minutes au premier démarrage (la sonde de démarrage
  fournit un délai initial de 60 secondes plus une large fenêtre d'échec de 30
  tentatives avec une période de 15 s) pendant l'exécution des migrations.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour GlitchTip sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement (utilisez `cr` pour exécuter en parallèle de la variante GKE). |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `glitchtip` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `GlitchTip Error Tracking` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `description` | `GlitchTip - Open-source Sentry-compatible error tracking platform` | Brève description de l'objectif de l'application. |
| `application_version` | `6.2.0` | Tag d'image GlitchTip ; pilote le build `FROM glitchtip/glitchtip:<tag>`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | GlitchTip est une construction personnalisée légère ; conservez `custom`. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | Requis — le worker/beat Celery intégré doit s'exécuter entre les requêtes. |
| `min_instance_count` | `1` | Gardez ≥ 1 pour que le worker/beat reste actif. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `8080` | GlitchTip est servi par Granian sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Socket Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour l'ingestion d'événements SDK publics. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque l'ingestion d'événements non authentifiés.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `SECRET_KEY`, `DATABASE_URL` ou `VALKEY_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret. |
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

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un
bucket GCS après le provisionnement.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | (bucket de données) | Un bucket de données `storage` est déclaré par `GlitchTip_Common`. |
| `enable_nfs` | `true` | Stockage de pièces jointes NFS monté à `nfs_mount_path`. |
| `nfs_mount_path` | `/opt/glitchtip/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — GlitchTip nécessite PostgreSQL 15. |
| `db_name` | `glitchtip` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `glitchtip` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs `db-init` + `glitchtip-migrate` intégrés. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai, 30 × 15s de fenêtre d'échec | Sonde de démarrage. Prévoir plusieurs minutes au premier démarrage. |
| `liveness_probe` | HTTP `/` 60s de délai | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, mêmes délais | Sondes structurées alternatives. |
| `uptime_check_config` | désactivé (`enabled=false`, chemin `/`) | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utiliser Redis/Valkey pour la file d'attente et le cache au lieu de PostgreSQL. |
| `redis_host` | `""` | Point de terminaison Redis. Doit être défini explicitement sur Cloud Run. |
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

Retourné en cas de déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

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
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `glitchtip-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec
> des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée,
> un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue à la
> **planification** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les événements et projets stockés. |
| `SECRET_KEY` (auto-généré) | Ne jamais faire pivoter à la légère | Élevé | Le faire pivoter invalide toutes les sessions, déconnectant tous les utilisateurs. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro arrête le worker/beat Celery intégré — les files d'attente d'ingestion d'événements s'arrêtent et la purge de rétention ne s'exécute jamais. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes limite le CPU à ~0 entre les requêtes, affamant le worker/beat. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide échoue au job d'importation. |
| `ingress_settings` | `all` | Élevé | La définition à `internal` bloque l'ingestion d'événements SDK externes. |
| `enable_iap` | uniquement pour un déploiement tableau de bord uniquement | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les POST d'événements SDK. |
| `ENABLE_OPEN_USER_REGISTRATION` (fixe `false`) | n/a | Élevé | Non exposé comme variable sur cette variante — `GlitchTip_Common` le définit toujours `false`, donc l'inscription reste uniquement sur invitation d'administrateur. |
| `database_type` | `POSTGRES_15` | Élevé | GlitchTip nécessite PostgreSQL ; tout autre moteur interrompt le démarrage (corrigé par `GlitchTip_Common`). |
| `memory_limit` | `4Gi` | Moyen | En dessous de ~1 GiB, les processus Django + worker + beat risquent un OOM lors de pics d'événements. |
| `container_port` | valeur par défaut du module | Moyen | GlitchTip sert sur `8080` ; la surcharge du port sans correspondre à la liaison de Granian interrompt les sondes de santé. |
| `GLITCHTIP_MAX_EVENT_LIFE_DAYS` (fixe `90`) | n/a | Faible | Non exposé comme variable sur cette variante ; trop élevé ferait croître la base de données de manière illimitée, trop faible rejetterait des événements dont vous pourriez encore avoir besoin. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise
à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
GlitchTip partagée avec la variante GKE est décrite dans
**[GlitchTip_Common](GlitchTip_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : GlitchTip sur Cloud Run](../labs/GlitchTip_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GlitchTip sur GKE Autopilot](GlitchTip_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [GlitchTip Common — Configuration d'application partagée](GlitchTip_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Contrôle de code source et CI/CD**.
