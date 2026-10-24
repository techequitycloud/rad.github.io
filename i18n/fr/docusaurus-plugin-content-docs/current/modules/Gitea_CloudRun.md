---
title: "Gitea sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Gitea sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gitea_CloudRun.md @ e69407af sha256:960ad8362c2c -->

# Gitea sur Google Cloud Run {#gitea-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gitea_CloudRun.png" alt="Gitea sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gitea est un service Git léger et auto-hébergé, ainsi qu'une forge logicielle (un fork communautaire de Gogs, plus de 45 000 étoiles GitHub) qui offre l'hébergement de dépôts, le suivi des problèmes, les demandes de tirage (pull requests), la révision de code, un registre de paquets et un système CI/CD Actions intégré à partir d'un seul binaire Go. Ce module déploie Gitea sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud que Gitea utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Gitea sur RAD, et comment cela se compare {#what-gitea-costs-on-rad-and-how-that-compares}

**L'exécution de Gitea dans votre propre projet Google Cloud coûte environ 83,61 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD). Gitea est un service Git léger et auto-hébergé, ainsi qu'une plateforme d'hébergement de code source (un fork communautaire de Gogs) avec plus de 45 000 étoiles GitHub. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Gitea est également disponible sur GKE — consultez le [guide GKE](Gitea_GKE.md) si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre l'option Cloud Run moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~83,61 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~32 crédits/jour (~3,20 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1 vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **83,61 $ US** |

### Comment cela se compare {#how-it-compares}

- Le niveau Enterprise de **Gitea Cloud** commence à 9,50 $ US/utilisateur/mois (engagement d'un an requis en ligne ; SAML SSO, journaux d'audit, support prioritaire) — vérifié sur [https://about.gitea.com/pricing](https://about.gitea.com/pricing). Pour une équipe de cinq personnes, cela représente environ 47,50 $ US/mois et augmente avec les effectifs ; le coût d'exécution de RAD dans votre propre projet est un forfait d'environ 83,61 $ US/mois (Cloud Run) quel que soit le nombre d'utilisateurs, sur une instance open source que vous contrôlez entièrement.
- Le véritable compromis ici est le plafond par rapport au contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Gitea est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module Gitea seul, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de module de 99 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Gitea et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Gitea se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou **99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Gitea reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution : environ **5 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 83,61 $ US/mois), ou **environ 4 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~32 crédits/jour).

La majeure partie du coût d'exécution de Gitea est la base de données et la VM de fichier/cache partagée. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application du total ci-dessus.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tarification de Gitea Cloud](https://about.gitea.com/pricing) pour les chiffres de Gitea Cloud.

## 1. Vue d'ensemble {#1-overview}

Gitea s'exécute comme un conteneur binaire Go unique sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 2 Gio par défaut, facturation basée sur les requêtes, mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Métadonnées de dépôt, utilisateurs, problèmes, PR — `GITEA__database__DB_TYPE = "postgres"` |
| Fichiers partagés | Filestore / NFS | Dépôts, objets LFS et pièces jointes sur le volume partagé `/mnt/nfs` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par la fondation, plus le bucket de sauvegarde automatisée |
| Secrets | Secret Manager | `SECRET_KEY`, `INTERNAL_TOKEN` et le mot de passe de la base de données gérés automatiquement |
| Image de conteneur | Artifact Registry + Cloud Build | Build personnalisé léger sur l'image officielle `gitea/gitea` |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur câblé.** `Gitea_Common` définit `GITEA__database__DB_TYPE = "postgres"` ; ne pas basculer `database_type` vers MySQL.
- **L'image est une build personnalisée quasi-standard.** Cloud Build produit `FROM gitea/gitea:<version>` plus un petit point d'entrée de plateforme. Le point d'entrée existe car Cloud Run **n'interpole pas** les références d'environnement `$(VAR)` — il compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}` à partir des valeurs `DB_*` injectées par la fondation au démarrage du conteneur et choisit le bon mode SSL Postgres par saut de connexion.
- **L'utilisateur et le nom de la base de données sont préfixés par le locataire.** La fondation crée le rôle et la base de données comme `gitea<tenant><hex>` et les injecte comme `DB_USER` / `DB_NAME` ; le point d'entrée les mappe dans Gitea. Ne jamais coder en dur `gitea` dans les paramètres de la base de données.
- **TCP par défaut.** `enable_cloudsql_volume = false` — Gitea se connecte à l'IP privée de Cloud SQL via TCP avec `SSL_MODE = require` (le point d'entrée bascule automatiquement vers `disable` sur les chemins de socket Unix ou de bouclage proxy).
- **Toutes les données du dépôt résident sur NFS.** `GITEA__server__APP_DATA_PATH` est défini sur le montage NFS (`/mnt/nfs`), de sorte que les dépôts, LFS et les pièces jointes survivent aux redémarrages et sont partagés entre les instances.
- **L'installateur web de première exécution est ignoré.** `GITEA__security__INSTALL_LOCK = "true"` — la configuration est entièrement fournie via des variables d'environnement. Le **premier utilisateur à s'inscrire devient l'administrateur**.
- **L'auto-inscription est activée par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`). Enregistrez votre compte administrateur immédiatement après le déploiement, puis désactivez l'inscription pour les forges privées.
- Un job **`db-init` s'exécute à chaque apply** pour créer de manière idempotente le rôle et la base de données PostgreSQL de Gitea.
- Les **sondes de santé ciblent `/api/healthz`** — le point de terminaison de santé non authentifié de Gitea.
- **Mise à l'échelle à zéro, facturation basée sur les requêtes.** `min_instance_count = 0`, `max_instance_count = 1`, `cpu_always_allocated = false`. Définissez `cpu_always_allocated = true` uniquement si vous comptez sur la synchronisation miroir planifiée, le cron de santé du dépôt ou la livraison de webhook temporisée.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Gitea {#a-cloud-run--the-gitea-service}

Gitea s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gitea stocke toutes les données relationnelles (utilisateurs, métadonnées de dépôts, problèmes, demandes de tirage, état des Actions) dans une instance Cloud SQL pour PostgreSQL 15 gérée, accessible via l'**IP privée du VPC** (pas de point de terminaison public). Lors du premier déploiement, un job `db-init` crée le rôle d'application et la base de données préfixés par le locataire.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=postgres --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les données du dépôt — dépôts Git nus, objets LFS et pièces jointes aux problèmes — sont écrites sous `GITEA__server__APP_DATA_PATH` sur un partage **NFS** monté dans le service, de sorte qu'elles persistent après les redémarrages et les révisions. Un bucket **Cloud Storage** `data` est également provisionné, et les sauvegardes planifiées atterrissent dans le bucket de sauvegarde de la fondation. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances (ou Compute Engine → Instances de VM pour le serveur NFS autogéré) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Trois secrets sont gérés automatiquement : le mot de passe de la base de données (injecté sous `GITEA__database__PASSWD`), le `SECRET_KEY` de Gitea (chiffre les données sensibles stockées telles que les jetons 2FA et OAuth2), et son `INTERNAL_TOKEN` (authentifie les appels d'API internes de Gitea). Tous sont générés une seule fois et injectés au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Artifact Registry et Cloud Build {#e-artifact-registry--cloud-build}

Le déploiement construit une image personnalisée légère (`FROM gitea/gitea:<application_version>` + le point d'entrée de la plateforme) via Cloud Build et la stocke dans Artifact Registry. L'incrémentation de `application_version` déclenche une reconstruction par rapport à la balise amont correspondante.

- **Console :** Artifact Registry → Dépôts ; Cloud Build → Historique.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --limit 5
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des stratégies d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gitea {#3-gitea-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job `db-init` (`postgres:15-alpine`) attend l'instance Cloud SQL, puis crée de manière idempotente le rôle d'application préfixé par le locataire (avec `CREATEDB`), crée la base de données Gitea appartenant à ce rôle et accorde les privilèges. Le job s'exécute à chaque apply (`execute_on_apply = true`, jusqu'à 3 tentatives) et peut être réexécuté en toute sécurité.
- **Câblage de la base de données au moment de l'exécution.** Le point d'entrée de la plateforme enregistre une ligne comme `Gitea DB wired: host=… sslmode=… name=… user=…` à chaque démarrage, puis passe la main au point d'entrée standard de Gitea (qui écrit toutes les variables d'environnement `GITEA__*` dans `app.ini` et lance le serveur sous s6). Lorsque `DB_HOST` démarre avec `/`, il est traité comme le répertoire de socket du proxy d'authentification Cloud SQL (`SSL_MODE=disable`) ; un hôte de bouclage signifie un sidecar proxy (`disable`) ; tout le reste est l'IP privée via TCP (`SSL_MODE=require`).
- **Installateur ignoré ; le premier inscrit est administrateur.** `INSTALL_LOCK=true` supprime l'installateur web. Enregistrez le premier compte immédiatement après le déploiement — il reçoit les privilèges d'administrateur. Pour les forges privées, définissez ensuite `GITEA__service__DISABLE_REGISTRATION = "true"` via `environment_variables`.
- **Les URL de clonage proviennent de `public_domain` / `public_url`.** Celles-ci pilotent `GITEA__server__DOMAIN` et `GITEA__server__ROOT_URL`. Les valeurs par défaut (`localhost` / dérivées) produisent des URL de clonage et des redirections incorrectes — définissez-les sur l'hôte `run.app` du service ou votre domaine personnalisé.
- **Clonage HTTPS uniquement.** Cloud Run ne route que le HTTP `container_port` (3000). Le démon SSH intégré à l'image n'est pas accessible, utilisez donc des remotes HTTPS (avec un jeton d'accès Gitea ou un mot de passe) ; `git clone` basé sur SSH n'est pas disponible sur cette plateforme.
- **Actions Gitea.** Le serveur CI/CD Actions intégré est livré avec Gitea, mais l'exécution des jobs nécessite un calcul `act_runner` séparé que ce module ne provisionne pas.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/healthz`, qui renvoie HTTP 200 sans authentification une fois que Gitea est en service.
- **CLI de vérification :**
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/healthz"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Gitea sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gitea` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Gitea` | Nom convivial affiché dans la console. |
| `application_version` | `1` | Balise d'image `gitea/gitea` amont sur laquelle la build personnalisée est basée ; incrémenter (par exemple `1.24`) pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper légère (requise) ; `prebuilt` déploie l'image standard, qui **ne fonctionne pas sur Cloud Run** (pas d'interpolation d'environnement `$(VAR)` pour le câblage de la base de données). |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `container_port` | `3000` | Port HTTP de Gitea (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut ; définissez `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. Définissez `true` si vous comptez sur la synchronisation miroir planifiée, le cron de santé du dépôt ou la livraison de webhook temporisée. |
| `enable_cloudsql_volume` | `false` | TCP vers l'IP privée de Cloud SQL (SSL requis par le point d'entrée). Définissez `true` pour le chemin du proxy d'authentification de socket Unix. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy — notez que l'IAP devant Gitea filtre également les clients HTTP `git`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement, secrets et URL publique {#group-6--environment-variables-secrets--public-url}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | carte `EMAIL_SMTP_*` de remplacement | Variables d'environnement supplémentaires fusionnées sur les valeurs par défaut du module. Gitea lui-même est configuré via des noms `GITEA__<section>__<KEY>` (par exemple `GITEA__mailer__SMTP_ADDR`, `GITEA__service__DISABLE_REGISTRATION`) ; les clés `EMAIL_SMTP_*` de remplacement ne sont pas lues par Gitea. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` — pilote les URL de clonage. Définissez sur votre hôte réel. |
| `public_url` | `""` | Définit `GITEA__server__ROOT_URL` ; vide dérive `http://<public_domain>/`. Définissez sur `https://<host>/` en production. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom de secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée de la base de données/NFS (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupes 8-11 — CI/CD, SQL personnalisé, Domaine/CDN/WAF, Stockage {#groups-811--cicd-custom-sql-domaincdnwaf-storage}

Comportement standard d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées notables pour Gitea :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Maintenir activé** — les dépôts, LFS et les pièces jointes résident sur le partage NFS. |
| `nfs_mount_path` | `/data` | Chemin de montage ; devient également `GITEA__server__APP_DATA_PATH`. |
| `storage_buckets` | un bucket `data` | Bucket GCS provisionné par la fondation. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe — à synchroniser avec `public_domain`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Gitea est câblé pour PostgreSQL — ne pas modifier. |
| `db_name` | `gitea` | Nom de base de données ; la fondation le préfixe par le locataire et l'injecte comme `DB_NAME`. |
| `db_user` | `gitea` | Utilisateur de base de l'application ; préfixé par le locataire et injecté comme `DB_USER`. Le mot de passe est injecté comme `GITEA__database__PASSWD`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, délai de 30 s, 10 échecs | Sonde de démarrage vers le point de terminaison de santé de Gitea. |
| `liveness_probe` | HTTP `/api/healthz`, délai de 15 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring — activer pour la production. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

Les entrées Redis (`enable_redis`, `redis_host`, `redis_port`, `redis_auth`) sont déclarées pour la convention de la plateforme mais ne sont **pas transmises** par ce module — Gitea n'utilise pas Redis ici ; les définir n'a aucun effet.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données d'application / utilisateur préfixé par le locataire. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Le module câblé `GITEA__database__DB_TYPE=postgres` ; un autre moteur interrompt le démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données de la forge. |
| `enable_nfs` | `true` | Critique | Sans le partage NFS, les dépôts/LFS/pièces jointes résident sur un disque éphémère et disparaissent lors du redémarrage ou de la mise à l'échelle à zéro. |
| `container_image_source` | `custom` | Critique | L'image standard n'a pas de point d'entrée de plateforme ; Gitea essaie de composer un hôte littéralement nommé `$(DB_HOST)` et ne démarre jamais. |
| `container_port` | `3000` | Critique | Un port HTTP de Gitea non concordant échoue à toutes les sondes. |
| Paramètres de la base de données via env | ne jamais coder en dur `gitea` | Critique | Les vrais `DB_USER`/`DB_NAME` sont préfixés par le locataire ; le codage en dur échoue avec `password authentication failed`. |
| `GITEA__service__DISABLE_REGISTRATION` | `true` après le premier administrateur | Élevé | Laissé ouvert, toute personne qui trouve l'URL peut s'inscrire sur votre forge (le tout premier inscrit est administrateur — réclamez-le immédiatement). |
| `public_domain` / `public_url` | hôte réel | Élevé | Les valeurs par défaut (`localhost`) produisent des URL de clonage et des redirections incorrectes dans l'interface utilisateur. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent la génération 2. |
| `enable_cloudsql_volume` | `false` (TCP) | Élevé | Si basculé en mode socket, le point d'entrée s'adapte — mais des remplacements manuels `GITEA__database__HOST` non concordants interrompent la sélection du mode SSL. |
| `cpu_always_allocated` | `false`, ou `true` pour les miroirs/cron | Moyen | La facturation basée sur les requêtes limite le travail en arrière-plan ; la synchronisation miroir planifiée et les webhooks temporisés s'arrêtent au ralenti. |
| `min_instance_count` | `0` (ou `1` pour les équipes) | Moyen | La mise à l'échelle à zéro ajoute un démarrage à froid à la première opération `git` après l'inactivité. |
| `uptime_check_config` | activer pour la production | Moyen | Désactivé par défaut ; pas de signal de disponibilité externe. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Gitea partagée avec la variante GKE est décrite dans **[Gitea_Common](Gitea_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Gitea sur Cloud Run](../labs/Gitea_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gitea sur GKE Autopilot](Gitea_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gitea Common — Configuration d'application partagée](Gitea_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Contrôle de source et CI/CD**.
