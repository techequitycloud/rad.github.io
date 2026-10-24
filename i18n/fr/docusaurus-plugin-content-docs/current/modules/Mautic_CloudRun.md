---
title: "Mautic sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Mautic sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mautic_CloudRun.md @ 1665a43e sha256:7ab89fe5fb16 -->

# Mautic sur Google Cloud Run {#mautic-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_CloudRun.png" alt="Mautic sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic est une plateforme open-source d'automatisation du marketing pour les
campagnes e-mail, la gestion des contacts, les pages de destination et la
notation des prospects. Ce module déploie Mautic sur **Cloud Run v2** sur la
base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Mautic et sur la
manière de les explorer et de les exploiter à partir de la Google Cloud Console
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Mautic sur RAD, et comment cela se compare {#what-mautic-costs-on-rad-and-how-that-compares}

**Mautic sur le module Cloud Run de RAD coûte environ 102 $ US par mois dans
votre propre projet, sans licence par contact.** RAD facture 110 crédits une
fois par déploiement dans votre propre projet (99 crédits, soit 10 % de moins,
dans un projet géré par RAD), plus le temps de build. Mautic se déploie
également sur GKE Autopilot pour environ 150 $ US par mois — voir le
[guide GKE](Mautic_GKE.md) si vous avez besoin qu'il y soit exécuté à la
place. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD
peut être supprimé et restauré dans les 30 jours pour quelques crédits, de
sorte que ce chiffre mensuel devient quelques dollars au lieu de 102 $ US —
voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **102 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96,00 $ US au prix de la recharge, moins sur un plan) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins sur un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte
qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | 32 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 102 $ US** |

### Comment cela se compare {#how-it-compares}

- Le **plan Marketing Hub Professional de HubSpot** commence à **800 $ US par
  mois** (y compris 3 sièges principaux ; sièges supplémentaires à partir de
  45 $ US chacun) et nécessite des **frais d'intégration uniques de 3 000 $
  US**. Son plan d'entrée Starter est beaucoup moins cher (à partir de 7 $
  US/siège/mois) mais supprime la plupart des fonctionnalités
  d'automatisation du marketing que Mautic propose par défaut.
- Le module Mautic de RAD coûte environ 102 $ US par mois dans votre propre
  projet — une petite fraction du prix de HubSpot Professional, sans niveau de
  licence par contact à dépasser et sans frais d'intégration, car il déploie le
  propre moteur d'automatisation open-source de Mautic plutôt qu'une plateforme
  mesurée par un fournisseur.
- Comparaison auto-gérée : à 2 vCPU / 4 GiB avec une base de données MySQL, un
  GCP Compute Engine e2-standard-2 (environ 49 $ US/mois) est dans la fourchette,
  mais vous exécutez MySQL, la délivrabilité des e-mails, les sauvegardes et les
  mises à niveau vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Mautic s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela
convient bien mieux à Mautic dont vous n'avez besoin qu'occasionnellement —
évaluation, environnement de démonstration, charge de travail saisonnière ou
intermittente — que de l'exécuter en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime
  pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours.
  Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
  attend. Contrairement à la suppression d'un module, cela ne détruit pas la
  base de données, aucune VM ou la ressource de calcul une par une — l'ensemble
  du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  récupérer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout
  est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à
  nouveau. Pour Mautic derrière Services_GCP (une petite VM NFS/cache, une base
  de données Mysql) et Project_GCP, cela représente environ **une poignée de
  crédits (moins de 1 $ US)** au total, contre environ 115 crédits (11,50 $ US)
  que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas
  102 $ US.** Déployez Mautic, utilisez-le pendant un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec
  Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que
  les frais de module une fois, les builds, et le temps pendant lequel il a été
  réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30
  jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
  qui convient à la plupart des utilisations d'évaluation). Google indique que
  la plupart des services fonctionnent à nouveau pleinement dans les 36 heures
  suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression
  logicielle de Cloud Storage, il est donc très probablement supprimé dès que
  vous supprimez le projet — même si le projet lui-même est récupérable pendant
  30 jours. Si vous avez personnalisé Mautic et que vous souhaitez conserver ce
  travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
  projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 115 crédits (11,50 $ US) au total. La suppression ne permet
  d'économiser de l'argent que si Mautic restait inutilisé assez longtemps pour
  compenser ce coût de redéploiement par rapport à son propre coût
  d'exécution — environ **4 jours ou plus**, à la fois dans votre propre projet
  (environ 3,40 $ US par jour) et dans un projet géré par RAD (32 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  Mautic, il s'agit de la base de données et de la VM de fichier/cache partagée.
  Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
  suppression de cette application pendant que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
  la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [HubSpot](https://www.hubspot.com/pricing/marketing).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Mautic s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes (scale-to-zero) |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Mautic ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias téléchargés partagés entre toutes les instances (montés dans le service) |
| Stockage d'objets | Cloud Storage | Un bucket média dédié |
| Cache et sessions | Redis | Activé par défaut |
| Secrets | Secret Manager | Mot de passe administrateur et mot de passe de base de données auto-générés |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **MySQL 8.0 est obligatoire.** La sélection de PostgreSQL ou `NONE`
  interrompt le démarrage.
- **Les sondes sont ignorées de la page de connexion.** Apache émet une
  redirection 301 HTTP→HTTPS une fois que `HTTPS=on`/`MAUTIC_SITE_URL` sont
  définis, ce qui interrompt une sonde de type HTTP contre `/index.php/s/login`. Le
  module remplace la sonde de démarrage par **TCP** (vérification de port
  ouvert, délai initial de 60 s) et la sonde de vivacité par **HTTP
  `/healthz`** (un fichier statique qu'Apache sert sans redirection, délai
  initial de 120 s).
- **`HTTPS=on` et une URL de service prédite sont injectées** afin que Mautic
  génère des liens absolus corrects et évite les boucles de redirection
  HTTP→HTTPS derrière le front-end Cloud Run (les mêmes redirections que les
  sondes TCP/`/healthz` ci-dessus sont conçues pour contourner).
- **Démarrage à froid par défaut.** `min_instance_count = 0` et `cpu_always_allocated =
  false` (facturation
  basée sur les requêtes) : l'interface utilisateur et le suivi des contacts
  fonctionnent à la demande ; les commandes marketing s'exécutent en tant que
  Jobs Cloud Run planifiés distincts (§3), de sorte que la mise à l'échelle à
  zéro ne les arrête pas.
- **Les migrations de base de données s'exécutent à chaque démarrage
  d'instance** (idempotent), de sorte que les mises à niveau de version
  s'appliquent automatiquement.
- Le **mot de passe administrateur** de Mautic est généré et stocké dans Secret
  Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Mautic {#a-cloud-run--the-mautic-service}

Mautic s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement à la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mautic stocke toutes les données de l'application dans une instance Cloud SQL
pour MySQL 8.0 gérée. Le service se connecte en privé via le **Cloud SQL Auth
Proxy** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un
Job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits dans un partage **Filestore (NFS)** monté
dans le service afin que toutes les instances partagent les mêmes fichiers. Un
bucket **Cloud Storage** `media` est également provisionné, mais rien ne le
monte ou n'y écrit — il est conservé uniquement parce que sa suppression d'un
déploiement existant déclenche un cycle de dépendance Terraform.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache et la cohérence des sessions de Mautic
entre les instances.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Mautic et le mot de passe de la base de
données sont stockés dans Secret Manager et injectés dans le service au moment
de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et le contrôle d'égresse VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications
de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mautic {#3-mautic-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation crée la base de données et l'utilisateur Mautic avant le
  démarrage du service. Il est idempotent.
- **Migrations au démarrage.** Chaque instance exécute les migrations de Mautic
  au démarrage, de sorte que la mise à niveau de la version applique
  automatiquement les modifications de schéma.
- **Commandes planifiées (essentielles).** Les campagnes, la file d'attente
  d'e-mails et les mises à jour de segments de Mautic sont pilotées par des
  commandes planifiées ; sans elles, les campagnes ne se déclenchent jamais et
  aucun e-mail n'est envoyé. Mautic n'a pas de planificateur intégré, elles
  s'exécutent donc en tant que Jobs Cloud Run planifiés :

  | Commande | Objectif | Cadence |
  |---|---|---|
  | `mautic:segments:update` | Actualiser l'appartenance aux segments | toutes les 15 min (`:00`, `:15`, …) |
  | `mautic:campaigns:update` | Reconstruire l'appartenance aux campagnes | toutes les 15 min (`:05`, `:20`, …) |
  | `mautic:campaigns:trigger` | Déclencher les événements de campagne planifiés | toutes les 15 min (`:10`, `:25`, …) |

  Ces trois commandes sont planifiées par le module lui-même, décalées pour
  qu'elles ne se chevauchent jamais, et exécutées via `mautic-cron.sh` (qui mappe les
  paramètres de la base de données comme le fait le conteneur web et attend le
  proxy Cloud SQL). Tout ce que Mautic propose d'autre — par exemple
  `mautic:queue:process` si vous mettez en file d'attente des e-mails, ou
  `mautic:maintenance:cleanup` — est ajouté via `cron_jobs`, qui est ajouté aux trois
  commandes intégrées.

  Inspectez les jobs et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Gestion HTTPS.** `HTTPS=on` et l'URL de service prédite sont définies afin
  que Mautic produise des URL absolues correctes et évite les boucles de
  redirection derrière Cloud Run.
- **Connexion administrateur.** Le nom d'utilisateur et l'e-mail de
  l'administrateur initial sont configurables ; le mot de passe est récupéré
  dans Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Mautic sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mautic` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Mautic` | Nom convivial affiché dans la Console. |
| `application_description` | `Mautic - Open-source marketing automation platform` | Description du service. |
| `application_version` | `5` | Tag de version de l'image Mautic. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | Instances minimales. Mise à l'échelle à zéro par défaut ; définir ≥ 1 (avec `cpu_always_allocated = true`) pour un travail continu en cours. |
| `max_instance_count` | `3` | Instances maximales. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (démarrage à froid). Mautic n'exécute pas de planificateur intégré ; ses commandes sont des Jobs Cloud Run planifiés (§3). |
| `container_port` | `80` | Mautic/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base `MAUTIC_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles à stocker et à injecter en tant que secrets. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Mautic. |
| `nfs_mount_path` | `/var/www/html/docroot/media/files` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket média / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `application_database_name` | `mautic` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mautic` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré. |
| `cron_jobs` | `[]` | Jobs planifiés supplémentaires, ajoutés aux trois commandes Mautic que le module planifie lui-même (§3). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | Remplacé par TCP (vérification de port ouvert), délai initial de 60 s | Sonde de démarrage — TCP évite la redirection 301 HTTP→HTTPS d'Apache qui interrompt une sonde HTTP. |
| `liveness_probe` / `health_check_config` | Remplacé par HTTP `/healthz`, délai initial de 120 s | Sonde de vivacité — `/healthz` est un fichier statique servi sans redirection. |
| `uptime_check_config` | désactivé (`enabled = false`, chemin `/`) | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache/les sessions. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Mautic {#group-23--mautic-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Connexion de l'administrateur initial. |
| `mautic_admin_email` | `admin@example.com` | E-mail de l'administrateur — **définir une adresse réelle**. |
| `mailer_from_name` | `Mautic` | Nom d'affichage sur les e-mails de campagne sortants. |
| `mailer_from_email` | `mautic@example.com` | Adresse d'expéditeur — **utiliser un domaine avec SPF/DKIM valide**. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
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
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Mautic nécessite MySQL ; PostgreSQL/`NONE` interrompt le démarrage. |
| Commandes planifiées intégrées (§3) | laisser en place | Critique | Aucune campagne ne se déclenche sans elles ; ajouter le traitement de la file d'attente d'e-mails via `cron_jobs` si vous mettez en file d'attente des e-mails. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléchargements sont perdus entre les instances/redémarrages. |
| `application_database_name` / `_user` | définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `startup_probe` | TCP, pas HTTP (par défaut du module) | Élevé | Une sonde HTTP contre `/index.php/s/login` échoue : Apache redirige en 301 HTTP→HTTPS les vérifications de santé HTTP simples de Cloud Run une fois `HTTPS=on` défini, de sorte que la sonde ne voit jamais un 200. Le module remplace `startup_probe` par TCP et `liveness_probe` par HTTP `/healthz` pour éviter cela. |
| `enable_redis` | `true` | Élevé | Plusieurs instances avec des caches isolés entraînent une incohérence. |
| `memory_limit` | ≥ `2Gi` | Élevé | Trop peu de mémoire provoque des OOM PHP lors des importations/envois. |
| `mautic_admin_email` / `mailer_from_email` | adresses réelles | Élevé | Les espaces réservés envoient à nulle part et sont rejetés/classés comme spam. |
| `min_instance_count` | `0` (par défaut) ou `1` pour toujours actif | Moyen | `0` ajoute une latence de démarrage à froid à la première requête après l'inactivité ; les commandes planifiées s'exécutent en tant que Jobs Cloud Run distincts et ne sont pas affectées. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interface d'administration | Moyen | L'interface utilisateur d'administration est autrement accessible publiquement. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Mautic partagée avec la variante GKE est décrite
dans **[Mautic_Common](Mautic_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Mautic sur Cloud Run](../labs/Mautic_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mautic sur GKE Autopilot](Mautic_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Mautic Common — Configuration d'application partagée](Mautic_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
