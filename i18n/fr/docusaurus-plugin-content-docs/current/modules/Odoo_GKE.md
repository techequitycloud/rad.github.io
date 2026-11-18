---
title: "Odoo sur GKE Autopilot"
description: "Référence de configuration pour déployer Odoo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Odoo_GKE.md @ 2be24ed1 sha256:546a9b59e788 -->

# Odoo sur GKE Autopilot {#odoo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.png" alt="Odoo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo est une suite ERP open source complète comptant plus de 12 millions d'utilisateurs et proposant des modules couvrant le CRM,
la comptabilité, les stocks, la fabrication, les RH et l'e-commerce. Ce module déploie Odoo Community
Edition sur **GKE Autopilot** par-dessus le socle [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide met l'accent sur les services cloud utilisés par Odoo et sur la façon de les explorer et de les exploiter depuis
la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute
application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —, consultez le
[guide du module socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Odoo sur RAD, et comment cela se compare {#what-odoo-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, Odoo sur le module GKE Autopilot de RAD coûte environ 130–300 $ US par mois,
sans aucune licence par utilisateur.** La même équipe paie environ 220–410 £ par mois sur Odoo Online et environ
470 £ sur Odoo.sh. GKE convient à un environnement Odoo qui doit rester actif, monter en charge sur plusieurs pods ou fonctionner aux côtés d'autres
charges de travail Kubernetes ; pour un coût minimal, le [module Cloud Run](Odoo_CloudRun.md) exécute
le même Odoo pour environ 84 $ US par mois. Un serveur auto-hébergé revient moins cher à l'achat, mais vous devez alors gérer
vous-même la base de données, les sauvegardes, les correctifs de sécurité et les montées de version. Les chiffres sont arrêtés au 8 octobre 2026 ; les sources
sont indiquées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — préparation d'une certification, démonstration, activité
saisonnière —, un projet géré par RAD peut être supprimé et restauré sous 30 jours sans frais supplémentaires, transformant ces 130–150 $ US en quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Odoo Community Edition**, qui est open source (LGPL), il n'y a donc aucun coût de licence
par utilisateur. Vous payez pour trois choses :

| | Dans votre propre projet Google Cloud | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, uniques par déploiement | 175 crédits (17,50 $ US au tarif de recharge) | 157.5 crédits (10 % de moins) |
| Builds | Inclus dans le prix : aucuns frais de build pour la création, 5 mises à jour par mois (mois civil UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué, jusqu'à 10 builds échoués par jour (UTC). Les sessions de lab et les projets clients font exception : le temps de build y est facturé à la minute | Identique |
| Coût de fonctionnement Google Cloud | Facturé par Google sur votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Décompté à l'heure en crédits ; RAD annonce **129 crédits par jour**, soit environ 3 870 par mois (environ 387 $ US au tarif de recharge ; estimation basée sur les tarifs publics de Google, incluant les frais de cluster) |
| Responsabilités | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum de crédits achetés est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge ponctuelle, et moins dans le cadre d'un abonnement mensuel. Dans un projet géré par RAD,
la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet ; une
seconde application n'ajoute donc pas de seconde base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, tarifs publics de Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud SQL for PostgreSQL 17, 1 vCPU, 3.75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS : une VM e2-small avec 20 Go de disque | 14 $ US |
| GKE Autopilot, un pod Odoo avec 1 vCPU et 2 Gio, fonctionnant en permanence | 40 $ US |
| Équilibrage de charge : équilibreur de charge du Service, plus la passerelle pour le domaine personnalisé activé par défaut | 18–37 $ US |
| Passerelle Cloud NAT et adresse IP | 5 $ US |
| Cloud Storage pour les add-ons et les sauvegardes quotidiennes | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US dans le cadre de l'offre gratuite de GKE, sinon 73 $ US |
| **Total** | **environ 130–150 $ US**, ou environ 220 $ US sans l'offre gratuite |

L'offre gratuite de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte
de facturation ; elle ne s'applique donc que s'il s'agit de votre unique cluster de ce type. Dans africa-south1
(Johannesburg), Cloud SQL coûte le même prix, et le pod ainsi que la VM environ 10 % de plus. Deux éléments influencent
ce chiffre :

- **GKE ne passe pas à l'échelle jusqu'à zéro.** Au moins un pod Odoo s'exécute en permanence, afin que les actions planifiées
  (relève des e-mails, factures récurrentes, rappels) continuent de fonctionner, et le coût reste identique,
  qu'Odoo soit utilisé ou non. Des pods supplémentaires, jusqu'à trois par défaut, ne sont ajoutés
  qu'en cas de charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS.
  La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comparatif pour dix utilisateurs internes {#how-it-compares-for-ten-internal-users}

| Option | Édition | Par mois | Gestionnaire |
|---|---|---|---|
| Odoo Online, formule Standard | Enterprise | 220 £ (10 × 22 £, facturé annuellement ; 180 £ la première année) | Odoo. Les modules personnalisés ne sont pas autorisés |
| Odoo Online, formule Custom | Enterprise | 410 £ (10 × 41 £, facturé annuellement) | Odoo. Ajoute Studio, l'API externe et le multi-société |
| Odoo.sh, 1 worker, 20 Go, 1 branche de staging | Enterprise | Environ 468 £ (58 £ d'hébergement + 410 £ de licence Custom) | Odoo héberge ; vous gérez votre code |
| Enterprise sur vos propres serveurs | Enterprise | 410 £ de licence, plus les serveurs | Vous |
| Hébergement Community infogéré (Cloudpepper Pro, serveur medium) | Community | 73 € | Le fournisseur, sur hébergement partagé |
| Votre propre serveur (Hetzner CPX22 ou DigitalOcean 2 vCPU, 4 Go) | Community | 20 €, ou 24 $ US plus 7 $ US pour les sauvegardes quotidiennes | Vous : système d'exploitation, PostgreSQL, sauvegardes, correctifs, mises à niveau |
| **RAD, GKE Autopilot, votre propre projet** | Community | **Environ 130–150 $ US**, plus 17,50 $ US uniques par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, projet géré par RAD** | Community | **Environ 2 970 crédits (238–297 $ US)** | RAD |
| RAD, Cloud Run | Community | Environ 84 $ US, ou 960 crédits ; voir le [guide Cloud Run](Odoo_CloudRun.md) | RAD |

Les tarifs d'Odoo ont été consultés sur odoo.com depuis le Royaume-Uni. Odoo fixe ses prix par pays,
et ses tarifs dans de nombreux pays africains sont plus bas ; vérifiez odoo.com/pricing depuis votre propre
pays. Ce que montre ce tableau :

- **Les licences augmentent avec chaque utilisateur ; le coût de RAD augmente avec la charge.** Les formules d'Odoo facturent chaque
  utilisateur disposant d'un accès au back-office. Le coût de RAD correspond à l'infrastructure, qu'une équipe grandissante
  n'augmente que lorsqu'elle a besoin de plus de capacité. Pour dix utilisateurs, RAD sur GKE coûte entre le quart et la
  moitié de la formule Odoo Online Custom, et l'écart se creuse à mesure que l'équipe s'agrandit.
- **L'édition Community n'est pas l'édition Enterprise.** Enterprise intègre la comptabilité complète, Studio, les applications mobiles,
  Helpdesk, Field Service, Planning et d'autres applications (voir le comparatif des éditions d'Odoo). Si vous en avez
  besoin, comparez avec Odoo Online ou Odoo.sh : le module RAD déploie Community.
- **Un serveur peu coûteux l'est jusqu'à ce qu'un problème survienne.** Sur RAD, la base de données est Cloud SQL, avec
  des sauvegardes quotidiennes et sept jours de récupération à un point précis dans le temps, ainsi qu'une exportation nocturne de la
  base de données et des fichiers. Les mots de passe sont conservés dans Secret Manager, et les journaux ainsi que la surveillance proviennent de
  Google Cloud. Sur votre propre serveur, chacune de ces tâches doit être gérée manuellement.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le au besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Odoo s'exécute dans **un projet géré par RAD pour vous**, vous disposez d'une seconde option qui va bien
au-delà du passage à l'échelle jusqu'à zéro : **supprimer tout le projet, et le restaurer sous 30 jours pour un coût
quasi nul.** Cela convient particulièrement à une instance Odoo dont vous n'avez besoin que ponctuellement — préparation d'une certification,
environnement de démo, activité saisonnière —, bien plus que de la laisser tourner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration ; on ne peut donc pas compter sur la restauration comme moyen garanti de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué les sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Fonctionnement.** Supprimer un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. La facturation étant déjà dissociée, rien n'est facturé pendant cette période d'attente. Contrairement à
  la suppression d'un module isolé, cela ne détruit pas Cloud SQL, la VM ou Cloud Run un par un — le
  projet entier, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Sous 30 jours, le propriétaire du projet peut
  le restaurer. RAD demande à Google d'annuler la suppression du projet et rattache son compte de facturation, puis
  vous invite à exécuter **Update** sur chaque déploiement pour confirmer que tout est rétabli. Comme rien
  n'a été détruit individuellement, cet Update retrouve les mêmes ressources déjà en place — il s'agit d'une vérification,
  pas d'une reconstruction, et un Update ne refacture jamais les frais de module. Pour Odoo sur GKE derrière un
  petit Services_GCP et Project_GCP, cela ne coûte normalement **aucun crédit**, car les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), contre les 185 crédits qu'exige un redéploiement complet.
- **Un mois d'utilisation occasionnelle peut donc ne coûter que quelques dollars, et non 130–150 $ US.** Déployez Odoo, utilisez-le pendant une
  soirée, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le
  à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, ainsi que les heures pendant lesquelles
  Odoo a réellement été actif.
- **Conditions requises.** Vous devez être le propriétaire du projet (et non un projet externe dont RAD gère
  uniquement la facturation), et vous le restaurez vous-même dans les 30 jours — passé ce délai, Google le supprime
  définitivement. La restauration est validée comme la création d'un nouveau projet : votre solde de crédits achetés doit
  toujours être supérieur au seuil minimal du palier (100 crédits pour le palier sandbox, adapté à la plupart des usages de formation et de démo).
  Google indique que la plupart des services sont à nouveau pleinement opérationnels sous 36 heures après une restauration.
- **Une limite importante : le bucket de sauvegarde ne subsiste pas.** Les sauvegardes nocturnes de la base de données et des fichiers d'Odoo
  sont écrites dans un bucket situé à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression réversible (soft-delete) de Cloud
  Storage ; il est donc très probablement supprimé dès que vous supprimez le projet — même
  si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à Odoo que vous souhaitez
  conserver, copiez une sauvegarde à l'extérieur (vers Google Drive ou un bucket hors du projet) avant de supprimer,
  comme pour le processus de redéploiement ci-dessous. Pour une installation par défaut ne contenant rien d'irremplaçable,
  cela n'a pas d'importance.

### Ne payez que pendant l'utilisation, l'autre approche : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE conserve au moins un pod en cours d'exécution, il ne descend donc jamais à zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois le délai de 30 jours
écoulé, le moyen de stopper les frais consiste à supprimer le déploiement et à le déployer à nouveau lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) : 175 crédits (17,50 $ US)
  et environ une heure, car RAD recrée le projet et les services partagés avant Odoo.
  La suppression permet de faire des économies si Odoo devait rester inutilisé pendant environ quatre jours ou plus dans votre
  propre projet (environ 5 $ US par jour), ou environ deux jours dans un projet géré par RAD (129 crédits par jour).
- **Supprimez tout ce qu'utilise Odoo.** La majeure partie du coût de fonctionnement provient de la base de données et du serveur de fichiers.
  Ils ne s'arrêtent que lorsque plus rien d'autre dans le projet ne les utilise ; ainsi, supprimer Odoo alors que d'autres
  applications partagent le projet n'économise que la partie GKE.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket au sein du
  déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde vers
  Google Drive ou vers un bucket que vous conservez.
- **Restaurez lors du redéploiement.** Déployez à nouveau avec `enable_backup_import = true`,
  `backup_source = "gdrive"`, `backup_file` configuré avec l'identifiant de fichier Drive et `backup_format` défini sur
  `sql`, `tar` ou `zip`. L'importation lit depuis Google Drive ou depuis le bucket de sauvegarde
  propre au nouveau déploiement ; une copie conservée ailleurs sur Cloud Storage doit donc d'abord y être téléversée.
  Vérifiez vos pièces jointes après l'importation.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé à votre place ; vous saisissez à nouveau
  les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Odoo pour un groupe. Chaque participant
  dispose d'Odoo dans son propre projet Google Cloud pendant une durée de 15 minutes à 24 heures, dans la limite d'une enveloppe
  définie par le formateur. Alternativement, le formateur met en place un environnement partagé unique pour toute la classe, et chacun utilise la même application et ses données. Soit le formateur finance chaque place au départ, soit chaque participant paie la
  sienne. Tout est supprimé à la fin de la session, et les crédits inutilisés reviennent au
  formateur. Une session de trois heures coûte environ 20 crédits (2 $ US) par participant en builds et
  en coûts de fonctionnement, plus les frais de module, sauf si les frais sont offerts pour la session.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exploite Odoo pour un client depuis un
  portefeuille dédié qu'il finance, et règle directement avec le client. Si le solde du portefeuille devient insuffisant,
  la facturation se met en pause et les données sont conservées, afin que personne ne reçoive de facturation imprévue. À la fin de
  la mission, le partenaire transfère le projet, et les déploiements deviennent la propriété du
  client.

Les crédits peuvent être achetés dans plus de 20 devises, notamment XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou mobile money.

**Sources (8 octobre 2026) :** Tarifs publics de Google Cloud issus de l'API Cloud Billing Catalog ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
concernant le délai de récupération de 30 jours et les précisions sur les objets Cloud Storage sans suppression réversible ;
frais RAD et estimation quotidienne de 99 crédits sur [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Tarifs Odoo](https://www.odoo.com/pricing), [Tarifs Odoo.sh](https://www.odoo.sh/pricing)
et [Éditions Odoo](https://www.odoo.com/page/editions) ;
[Cloudpepper](https://cloudpepper.io/pricing), [Hetzner Cloud](https://www.hetzner.com/cloud)
et [DigitalOcean](https://www.digitalocean.com/pricing/droplets). Les tarifs évoluent ; vérifiez chaque
source avant de vous baser sur un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Odoo fonctionne comme une charge de travail ERP Python/PostgreSQL. Le déploiement articule un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Odoo, 1 vCPU / 2 Gio par défaut, redimensionnés automatiquement à l'horizontale entre un et trois pods |
| Base de données | Cloud SQL for PostgreSQL | Requis — Odoo ne prend pas en charge MySQL ni SQL Server ; PostgreSQL 17 par défaut, issu des services partagés |
| Fichiers partagés | Serveur de fichiers NFS (VM Compute Engine) | Répertoires filestore, sessions et extra-addons d'Odoo partagés entre tous les réplicas ; une petite VM e2-small par défaut, avec Filestore disponible en option |
| Stockage d'objets | Cloud Storage | Un bucket d'addons dédié (`odoo-addons`) pour les addons personnalisés et communautaires |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; requis quand `max_instance_count > 1` pour partager l'état des sessions |
| Secrets | Secret Manager | Mot de passe maître généré automatiquement (`ODOO_MASTER_PASS`) et mot de passe de base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître dès le départ :**

- **PostgreSQL est obligatoire.** Le moteur de base de données est fixe ; sélectionner MySQL ou `NONE` empêche
  le démarrage.
- **NFS est requis.** Sans le volume NFS partagé, le filestore d'Odoo (pièces jointes,
  champs binaires, assets compilés) reste isolé sur chaque pod et est perdu au redémarrage.
- **L'affinité de session est `ClientIP`.** Odoo stocke les sessions sur NFS ; acheminer les requêtes vers le
  même pod évite les recherches de session entre pods.
- **Deux jobs d'initialisation s'exécutent à chaque déploiement.** `nfs-init` configure la propriété des répertoires NFS et
  `db-init` crée la base de données et l'utilisateur PostgreSQL — les deux sont idempotents.
- **Le mot de passe maître d'Odoo** est généré automatiquement et stocké dans Secret Manager ; vous
  ne le définissez jamais en texte clair.
- **Le premier démarrage est lent.** Odoo installe le module de base et applique les migrations de schéma au premier
  lancement ; la sonde de démarrage accorde jusqu'à 9 minutes (délai de 180 s + 3 périodes de 120 s).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Odoo {#a-gke-autopilot--the-odoo-workload}

Les pods Odoo sont planifiés sur Autopilot, qui facture le processeur et la mémoire réellement
demandés par les pods. L'autoscaling horizontal de pods (HPA) ajuste le déploiement entre le nombre minimal et maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Odoo pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Check Odoo version running in the container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- odoo --version
  ```

Consultez [App_GKE](App_GKE.md) pour découvrir comment Autopilot, la mise à l'échelle et le type
de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL {#b-cloud-sql-for-postgresql}

Odoo stocke toutes les données ERP (contacts, factures, stocks, commandes) dans une instance gérée Cloud SQL
for PostgreSQL. Les pods y accèdent de manière privée via le conteneur sidecar **Cloud SQL Auth Proxy**
sur un socket Unix, ainsi aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init`
crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm database and user were created:
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  gcloud sql users list --instance=<instance-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Serveur de fichiers NFS et Cloud Storage {#c-nfs-file-server-and-cloud-storage}

Le filestore d'Odoo (pièces jointes binaires, images, assets compilés), les données de session et les
répertoires extra-addons sont écrits sur un **partage NFS** hébergé par une petite VM Compute Engine
et monté dans chaque pod, de sorte que tous les réplicas accèdent aux mêmes fichiers. Filestore peut remplacer la VM,
mais sa plus petite instance est de 1 Tio. Un bucket **Cloud Storage** dédié
(`odoo-addons`) est également provisionné pour les addons personnalisés et communautaires.

- **Console :** Compute Engine → VM instances pour le serveur NFS ; Cloud Storage → Buckets pour
  le bucket des addons.
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT"   # the NFS server VM
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<addons-bucket>/        # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  # List NFS directories:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /mnt/
  ```

Consultez [App_GKE](App_GKE.md) pour les options de provisionnement NFS, GCS Fuse et CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis prend en charge le stockage de session d'Odoo lorsque plusieurs réplicas s'exécutent. Sans Redis,
l'affinité de session (`ClientIP`) est la seule protection contre la perte de session lors du redémarrage d'un pod.
Redis est désactivé par défaut ; définissez `enable_redis = true` et `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (en cas d'utilisation d'une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS_"
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe maître d'Odoo (`ODOO_MASTER_PASS`) et le mot de passe de la base de données sont stockés en tant que
secrets dans Secret Manager et injectés dans les pods à l'exécution ; le texte brut n'apparaît jamais dans
la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de base de données figure dans les [Sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration du pilote Secret Store CSI et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine
personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin
que l'adresse soit préservée lors des redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails relatifs aux domaines personnalisés, à Cloud CDN et à l'IP
statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont transmis à Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  # Monitor startup progress:
  kubectl logs -n "$NAMESPACE" -l app=odoo --follow | grep -E "odoo.modules|http.server"
  ```

---

## 3. Comportement de l'application Odoo {#3-odoo-application-behaviour}

- **Deux jobs d'initialisation à chaque déploiement.**
  - `nfs-init` — monte le partage NFS et crée `/mnt/filestore`, `/mnt/sessions` et
    `/mnt/extra-addons` avec la propriété `101:101` (l'utilisateur du processus Odoo). Doit réussir
    avant le démarrage d'Odoo.
  - `db-init` — s'exécute après `nfs-init` et crée de manière idempotente la base de données PostgreSQL et
    l'utilisateur applicatif. Ces deux jobs peuvent être réexécutés sans risque.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
  kubectl logs -n "$NAMESPACE" -l job-name=db-init
  ```
- **Migration de schéma au démarrage.** Le conteneur démarre Odoo avec `-i base`, ce qui applique
  automatiquement toutes les migrations de schéma en attente. Les montées de version sont appliquées au prochain démarrage du pod.
- **Mot de passe maître Odoo.** Un mot de passe alphanumérique de 16 caractères généré automatiquement est stocké dans
  Secret Manager et injecté sous le nom `ODOO_MASTER_PASS`. Il protège l'interface de gestion des bases de données
  sur `/web/database/manager`. Vous pouvez le remplacer à l'aide de `explicit_secret_values` :
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **SMTP pour les e-mails sortants.** Odoo utilise des variables d'environnement pour son transport de messagerie
  sortant (confirmations de commande, réinitialisations de mot de passe, notifications CRM). Configurez `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` dans `environment_variables` avant
  la mise en production ; basculez `SMTP_PASSWORD` vers `secret_environment_variables`.
- **Chemin de contrôle de santé.** La sonde de démarrage accorde un délai initial de 180 secondes puis vérifie `GET
  /web/health` (HTTP 200 uniquement quand Odoo dispose d'une connexion active à la base de données). La sonde de vivacité
  continue de vérifier `/web/health` toutes les 30 secondes. Lors du tout premier démarrage (création du schéma à
  partir de zéro), la mise en route peut prendre de 2 à 10 minutes selon le processeur disponible.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost:8069/web/health
  # Expect: 200
  ```
- **Planificateur d'arrière-plan Odoo (cron).** Le planificateur intégré d'Odoo nécessite au moins un
  pod en cours d'exécution. Conservez `min_instance_count = 1` en production pour éviter toute interruption des tâches cron.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Odoo sont mentionnés ; tous les autres paramètres sont hérités du socle
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court garantissant l'unicité des noms de ressources par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la responsabilité. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `odoo` | Nom de base des ressources. Ne pas modifier après le premier apply. |
| `application_display_name` | `Odoo ERP` | Nom convivial affiché dans la console. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `18.0` | Canal nightly Odoo à installer (`"18.0"`, `"17.0"`, `"16.0"`). Incrémenter pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir sur `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` effectue le build depuis le Dockerfile nightly d'Odoo ; `"prebuilt"` déploie une image existante. |
| `container_image` | `""` | URI de l'image de substitution (utilisé avec `"prebuilt"`). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de ressources par pod. **Augmenter à ≥ 2 vCPU / 4 Gio pour la production.** |
| `min_instance_count` | `1` | Réplicas minimum. Conserver ≥ 1 pour préserver le planificateur cron d'Odoo. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8069` | Port d'écoute d'Odoo. Ne pas modifier sauf si le serveur Odoo est reconfiguré. |
| `enable_cloudsql_volume` | `true` | Conteneur sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de conteneur dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en texte brut. Vides par défaut — définir `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` ici pour les e-mails sortants. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager (ex. `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Valeurs sensibles écrites dans Secret Manager pendant le déploiement. Utiliser pour définir un `ODOO_MASTER_PASS` personnalisé. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. Lorsqu'une passerelle (Gateway) est utilisée (valeur par défaut d'Odoo), `LoadBalancer` est créé en tant que `ClusterIP`, faisant de la Gateway le seul point d'entrée public. |
| `session_affinity` | `ClientIP` | Routage persistant (sticky) ; requis lorsque Redis n'est pas activé pour le partage de session. |
| `workload_type` | `null` | Résolu automatiquement en StatefulSet quand `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de pod ; `nfsserver` est requis pour la connectivité du pare-feu NFS. |
| `gke_cluster_name` | `""` | Nom du cluster cible ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour le générer automatiquement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les PVC par pod dans le StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod. Prévoir 100 Gio ou plus dans les déploiements ERP actifs. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC à l'intérieur du pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le processeur, la mémoire et le nombre d'objets dans l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers simples sont traités comme des octets par Kubernetes et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-delà de 1 si une marge d'éviction est nécessaire. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Délai généreux pour la création du schéma au premier démarrage. Augmenter `failure_threshold` à `5` lors des tout premiers déploiements. |
| `health_check_config` | `{ path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Contrôle de vivacité. `/web/health` renvoie 200 uniquement lorsqu'Odoo dispose d'une connexion active à la base de données. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `nfs-init` + `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées définies par l'utilisateur (CronJobs Kubernetes). |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Paramètres clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — les répertoires filestore, sessions et addons d'Odoo doivent résider sur un stockage partagé. |
| `nfs_mount_path` | `/mnt` | Chemin de montage NFS à l'intérieur du conteneur tel que vu par App_GKE. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket des addons. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket `odoo-addons` géré par Odoo. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage des sessions. Requis quand `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Requis quand `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — ne pas modifier en MySQL ou `NONE`. |
| `application_database_name` | `gkeappdb` | Nom de la base de données. Immuable après le premier apply. |
| `application_database_user` | `gkeappuser` | Utilisateur applicatif. Immuable après le premier apply. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installer des extensions PostgreSQL (ex. `postgis`, `unaccent`) après le provisionnement. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de base de données sans temps d'arrêt. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 90+ pour les données financières ou de conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer un dump PostgreSQL lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du code SQL depuis un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'Ingress pour des noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à desservir. |
| `reserve_static_ip` | `true` | IP externe stable préservée lors des redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger l'authentification Google devant Odoo. Recommandé pour les déploiements ERP réservés aux administrateurs. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Utilisateurs autorisés à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une stratégie Cloud Armor (WAF) au backend Ingress. Fortement recommandé pour tout déploiement Odoo exposé à Internet. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées à bénéficier d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la stratégie. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit détaillés de Cloud Audit Logs. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape (Cloud Deploy). |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL pour accéder à Odoo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critique | Odoo requiert exclusivement PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, les pièces jointes et les données de session sont isolées sur chaque pod et perdues au redémarrage. |
| `application_database_name` / `_user` | définir une seule fois | Critique | Immuable après le premier déploiement ; renommer recrée la base de données/l'utilisateur et détruit toutes les données de l'ERP. |
| `container_resources.memory_limit` | `≥ 4Gi` pour la production | Critique | La valeur par défaut `512Mi` provoque immédiatement un OOM Python lors du chargement des modules. Augmentez toujours à au moins `2Gi`. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans un `backup_file` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont traités comme des octets par Kubernetes et bloquent toute planification. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | fort, unique | Critique | Le gestionnaire de base de données à l'adresse `/web/database/manager` n'est protégé que par ce mot de passe ; une valeur faible expose la suppression de base de données à quiconque peut accéder à l'URL. |
| `enable_redis` | `true` quand `max_instance_count > 1` | Élevé | Sans Redis et `session_affinity = ClientIP`, les utilisateurs sont déconnectés lorsqu'ils sont routés vers un pod différent. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true` ; vide entraîne des échecs du backend de session au démarrage. |
| `application_version` | LTS valide (`18.0`, `17.0`) | Élevé | Une balise de version non valide fait échouer l'étape Cloud Build lors du build de l'image. |
| `container_image_source` | `custom` | Élevé | Odoo nécessite une image personnalisée pour relier le socket PostgreSQL et les chemins du filestore ; une image amont non configurée pour les sockets Unix Cloud SQL échouera à se connecter. |
| `min_instance_count` | `1` | Élevé | `0` arrête le planificateur d'arrière-plan d'Odoo (cron) et ajoute des démarrages à froid de 30 à 60 secondes. |
| `session_affinity` | `ClientIP` | Élevé | Sans affinité de session et sans Redis, les déploiements multi-réplicas perdent continuellement l'état de session. |
| `backup_retention_days` | `90` pour la production | Élevé | Odoo contient des enregistrements financiers ; 7 jours sont insuffisants pour la plupart des exigences de conformité. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Le gestionnaire de base de données et le portail d'administration d'Odoo ne doivent pas être accessibles publiquement sans authentification. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds lorsque le pod unique ne peut pas être évincé. |
| `stateful_pvc_size` | `100Gi`+ pour la production | Moyen | Les pièces jointes de l'ERP (factures, contrats, images de produits) s'accumulent rapidement. |

---

Pour le comportement du socle mentionné tout au long de ce document — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative spécifique à Odoo
partagée avec la variante Cloud Run est décrite dans **[Odoo_Common](Odoo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Odoo sur GKE Autopilot](../labs/Odoo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Odoo sur Cloud Run](Odoo_CloudRun.md) — la même application sur Cloud Run, si vous avez besoin de l'autre cible de déploiement.
- [Configuration applicative partagée d'Odoo](Odoo_Common.md) — la configuration partagée par les deux cibles de déploiement.
