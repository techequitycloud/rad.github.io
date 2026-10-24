---
title: "Docmost sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Docmost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Docmost_CloudRun.md @ e69407af sha256:913689cadec5 -->

# Docmost sur Google Cloud Run {#docmost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docmost_CloudRun.png" alt="Docmost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Docmost est une plateforme collaborative de wiki et de documentation en temps réel
(une alternative à Confluence/Notion) open source, basée sur NestJS. Ce module déploie Docmost sur
**Cloud Run v2** sur la base [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Docmost et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toute application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la base App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Docmost sur RAD, et comment cela se compare {#what-docmost-costs-on-rad-and-how-that-compares}

**Docmost sur le module Cloud Run de RAD coûte environ 82,03 $ US par mois sans licence par utilisateur.** Cela se compare à au moins 60 $ US par mois pour le plan Business hébergé de Docmost (6 $ US par utilisateur, minimum 10 utilisateurs). Un serveur autogéré est moins cher en espèces, mais vous gérez alors vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. GKE Autopilot convient aux Docmost qui doivent rester opérationnels en continu ou s'adapter à travers les pods ; pour le coût le plus bas, ce module Cloud Run vous offre déjà l'option la moins chère — consultez le [guide GKE](Docmost_GKE.md) si vous avez besoin de l'autre. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 82,03 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **82,03 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 82,03 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Docmost, plan Business (10 utilisateurs) | 60 $ US par mois (annuel), minimum 10 utilisateurs | Docmost |
| **RAD, Cloud Run, votre propre projet** | **Environ 82,03 $ US** | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 96 $ US** | RAD |

- Le plan Business de Docmost ajoute le SSO et des autorisations avancées que l'édition open source **Community** — ce que RAD déploie — n'inclut pas ; comparez avec Business uniquement si vous en avez réellement besoin. Le niveau Community gratuit de Docmost est le logiciel auto-hébergé que RAD automatise pour vous.
- Le coût de la licence sur le propre plan de Docmost augmente avec chaque utilisateur ajouté au-delà de dix ; le coût de RAD est l'infrastructure, qui ne bouge pas lorsque vous ajoutez un autre éditeur.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Docmost s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Docmost dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité
saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période. Contrairement
  à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou Cloud Run un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Docmost, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 82,03 $ US.** Déployez Docmost, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Docmost a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
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
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Docmost. La suppression permet d'économiser de l'argent une fois que Docmost resterait inutilisé
  pendant environ **4 jours ou plus** dans votre propre projet (environ 2,73 $ US par jour), ou environ
  **3 jours ou plus** dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Docmost utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Docmost.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou sur un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les
  paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  de Docmost dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Docmost pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
Frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration. [Tarification Docmost](https://docmost.com/pricing) pour les chiffres du plan Business ;

## 1. Vue d'ensemble {#1-overview}

Docmost s'exécute comme un conteneur Node.js (NestJS) sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service NestJS sur le port 3000, 1 vCPU / 1 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Docmost ne prend pas en charge MySQL ou d'autres moteurs |
| Cache et collaboration | Redis | **Requis** pour l'édition en temps réel et les files d'attente en arrière-plan ; activé par défaut |
| Stockage de fichiers | Filestore / NFS | Pièces jointes écrites sur le volume NFS à `/app/data/storage` |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement (non utilisé par le pilote `local` par défaut) |
| Secrets | Secret Manager | `APP_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur interrompt le démarrage.
- **Redis est requis et activé par défaut.** Docmost utilise Redis pour l'édition
  collaborative en temps réel et les files d'attente de tâches en arrière-plan. `enable_redis = true` est la
  valeur par défaut ; laisser `redis_host` vide co-localise Redis sur la VM du serveur NFS.
- **NFS est activé par défaut** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Le pilote de stockage `local` de Docmost y écrit les pièces jointes téléchargées afin qu'elles survivent
  aux redémarrages et soient partagées entre les instances.
- **`APP_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il signe
  et chiffre les sessions et les données sensibles et ne doit jamais être renouvelé après le premier démarrage
  sans fenêtre de maintenance — le renouveler déconnecte tout le monde et rend les données
  chiffrées avec l'ancienne valeur irrécupérables.
- **La base de données est accessible via l'IP privée, pas le socket.** Le pilote
  `postgres.js` de Docmost ne peut pas utiliser le chemin du socket Unix de Cloud SQL (ses deux-points interrompent l'analyse des URL),
  donc le point d'entrée se connecte à l'**IP privée de Cloud SQL via TCP avec
  `sslmode=require`**. `enable_cloudsql_volume = true` monte toujours le socket pour la
  tâche `db-init`.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max_instance_count = 1`).
  Les démarrages à froid ajoutent quelques secondes de latence après l'inactivité ; définissez `min_instance_count = 1` pour
  maintenir le point de terminaison de collaboration actif.
- **`APP_URL` est injecté comme URL de service prédite** (via `service_url_env_var_name = "APP_URL"`)
  et utilisé pour construire des liens absolus et le point de terminaison WebSocket de collaboration de l'éditeur.
- **La configuration initiale se fait via l'interface utilisateur.** Docmost n'a pas d'identifiants par défaut — le premier
  visiteur crée l'espace de travail initial et le compte administrateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Docmost {#a-cloud-run--the-docmost-service}

Docmost s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution,
et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Docmost stocke toutes les données d'application (espaces, pages, commentaires, utilisateurs, autorisations) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Sur Cloud Run, le service en cours d'exécution se connecte
à l'**IP privée de Cloud SQL via TCP avec SSL** (le pilote `postgres.js` ne peut pas utiliser
le chemin du socket Auth Proxy) ; le job `db-init` se connecte via le socket monté. Lors du
premier déploiement, ce job crée la base de données et l'utilisateur de l'application ; Docmost applique ensuite
ses propres migrations de schéma automatiquement au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs).
Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis (collaboration en temps réel et files d'attente) {#c-redis-real-time-collaboration--queues}

Redis est **activé par défaut** et est requis pour l'éditeur collaboratif en temps réel de Docmost
et le traitement des tâches en arrière-plan. Lorsque `redis_host` est laissé vide et `enable_nfs`
est vrai, l'adresse IP de la VM du serveur NFS est utilisée comme point de terminaison Redis ; définissez `redis_host`
(et éventuellement `redis_auth`) pour pointer vers un Redis géré/externe à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the assembled REDIS_URL is present in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Cloud Storage et stockage de fichiers NFS {#d-cloud-storage--nfs-file-storage}

Docmost écrit les pièces jointes téléchargées dans son pilote de stockage `local` à
`/app/data/storage`, qui est soutenu par le volume **NFS** afin que les fichiers persistent et soient
partagés entre les instances. Un bucket de données **Cloud Storage** dédié est également provisionné
automatiquement (disponible si vous basculez Docmost vers un pilote de stockage d'objets).

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options NFS, GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`APP_SECRET` (utilisé pour signer et chiffrer les sessions et les données sensibles). Le mot de passe de la base de données
est géré séparément par la base.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`),
ce qui permet l'accès public nécessaire pour partager les pages wiki et atteindre le point de terminaison de collaboration.
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud
Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Docmost {#3-docmost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le socket Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données et l'utilisateur de l'application et accorde les privilèges. Le
  job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent automatiquement au démarrage.** Docmost exécute ses propres migrations de schéma à
  chaque démarrage via sa commande `pnpm start` par défaut, de sorte que la mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte.
- **`APP_SECRET` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager. Le renouveler invalide toutes les sessions existantes et rend les données
  chiffrées avec l'ancienne valeur irrécupérables — ne le renouvelez que pendant une fenêtre de maintenance planifiée.
- **`APP_URL` doit correspondre à l'URL réelle du service.** Il est injecté comme URL
  `run.app` prédite et utilisé pour les liens absolus et le WebSocket de collaboration. Si vous placez
  Docmost derrière un domaine personnalisé, définissez `APP_URL` (via `environment_variables`) sur cette
  URL externe. Inspectez la révision en cours :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health` — le point de terminaison public
  200 de Docmost. Prévoyez environ 2 minutes au premier démarrage (délai initial de 60 secondes plus la fenêtre de nouvelle tentative)
  pendant l'exécution des migrations.
- **Création de compte au premier démarrage.** Docmost est livré sans identifiants par défaut. Accédez à
  l'URL du service et remplissez le formulaire de configuration pour créer le premier espace de travail et l'utilisateur
  administrateur. Faites-le rapidement après le déploiement afin que personne d'autre ne puisse revendiquer l'espace de travail.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Docmost sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docmost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Docmost` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Docmost (mappé à l'ARG de build `DOCMOST_VERSION`) ; épingler à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes ; CPU facturé uniquement pendant le service. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour maintenir le point de terminaison de collaboration actif. |
| `max_instance_count` | `1` | Augmenter uniquement avec Redis activé (il l'est par défaut). |
| `container_port` | `3000` | Docmost écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Monte le socket Cloud SQL Auth Proxy (utilisé par `db-init`). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet l'accès public aux pages partagées et au point de terminaison de collaboration. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Docmost. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) sont définies automatiquement — ne définissez pas `APP_SECRET`, `DATABASE_URL` ou `REDIS_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. |
| `service_url_env_var_name` | `APP_URL` | Injecte l'URL de service prédite comme `APP_URL`. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `enable_nfs` | `true` | NFS est **activé** par défaut — soutient le chemin de pièce jointe `/app/data/storage`. |
| `nfs_mount_path` | `/app/data/storage` | Chemin de montage correspondant au pilote de stockage local de Docmost. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Docmost nécessite PostgreSQL 15. |
| `db_name` | `docmost` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `docmost` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Rotation du mot de passe de la base de données. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` délai de 60s | Sonde de démarrage. Prévoir ~2 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` délai de 60s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut (lorsque le point de terminaison est public). |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis** — Docmost utilise Redis pour l'édition en temps réel et les files d'attente. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, une `database_type` qui ne correspond pas à une extension activée, une `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `APP_SECRET` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler invalide toutes les sessions et rend les données chiffrées avec l'ancienne valeur irrécupérables. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Docmost nécessite PostgreSQL 15 ; tout autre moteur interrompt le démarrage. |
| `enable_redis` | `true` | Critique | L'éditeur en temps réel et les files d'attente de tâches de Docmost nécessitent Redis ; le désactiver empêche l'application de fonctionner correctement. |
| `enable_nfs` | `true` | Élevé | Avec NFS désactivé, les pièces jointes téléchargées atterrissent sur un disque éphémère et sont perdues au redémarrage / non partagées entre les instances. |
| `APP_URL` | URL réelle du service / du domaine personnalisé | Élevé | Une URL incorrecte rompt les liens absolus et le point de terminaison WebSocket de collaboration. |
| `max_instance_count` | Augmenter uniquement avec Redis | Élevé | Plusieurs instances sans coordination Redis partagée dégradent l'édition collaborative. |
| `ingress_settings` | `all` | Élevé | `internal` bloque le partage externe et le point de terminaison de collaboration public. |
| `enable_iap` | uniquement pour les wikis privés | Moyen | IAP bloque tout accès non authentifié, y compris les vues de page anonymes si vous les utilisez. |
| `memory_limit` | `1Gi`+ | Moyen | Des limites très faibles risquent un OOM sous une charge d'édition/téléchargement concurrente. |
| `min_instance_count` | `1` pour une utilisation sensible à la latence | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Docmost partagée
avec la variante GKE est décrite dans **[Docmost_Common](Docmost_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Docmost sur Cloud Run](../labs/Docmost_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docmost sur GKE Autopilot](Docmost_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Docmost Common — Configuration d'application partagée](Docmost_Common.md) — la configuration partagée par les deux cibles de déploiement.
