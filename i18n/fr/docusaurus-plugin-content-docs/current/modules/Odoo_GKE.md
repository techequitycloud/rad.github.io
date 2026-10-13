---
title: "Odoo sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Odoo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Odoo_GKE.md @ e69407af sha256:c698880551eb -->

# Odoo sur GKE Autopilot {#odoo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.png" alt="Odoo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo est une suite ERP open source complète avec plus de 12 millions d'utilisateurs et des
modules couvrant la GRC, la comptabilité, la gestion des stocks, la fabrication, les RH et le
commerce électronique. Ce module déploie Odoo Community Edition sur **GKE Autopilot** sur la
base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Odoo et sur la manière de les
explorer et de les exploiter à partir de la console Google Cloud et de la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et le cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Odoo sur RAD, et comparaison {#what-odoo-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, le module GKE Autopilot d'Odoo sur RAD coûte environ
130 à 300 $ US par mois, sans licence par utilisateur.** La même équipe paie environ 220 à
410 £ par mois sur Odoo Online et environ 470 £ sur Odoo.sh. GKE convient à Odoo qui doit
rester opérationnel, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de
travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Odoo_CloudRun.md)
exécute le même Odoo pour environ 84 $ US par mois. Un serveur autogéré est moins cher en
espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les
correctifs de sécurité et les mises à niveau. Les chiffres sont ceux du 8 octobre 2026 ; les
sources sont énumérées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une
démonstration, une activité saisonnière — un projet géré par RAD peut être supprimé et
restauré dans les 30 jours pour quelques crédits, de sorte que 130-150 $ US deviennent
quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Odoo Community Edition**, qui est open source (LGPL), il n'y a donc pas de
frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 3 crédits par build (un build Odoo prend environ 27 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 par mois (environ 297 $ US au prix de la recharge, 238 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US en recharge unique, et moins avec un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par
chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud SQL pour PostgreSQL 17, 1 vCPU, 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS : une VM e2-small avec 20 Go de disque | 14 $ US |
| GKE Autopilot, un pod Odoo avec 1 vCPU et 2 Gio, fonctionnant en permanence | 40 $ US |
| Équilibrage de charge : l'équilibreur de charge du service, plus la passerelle pour le domaine personnalisé qui est activée par défaut | 18-37 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les modules complémentaires et les sauvegardes quotidiennes | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US dans le niveau gratuit de GKE, sinon 73 $ US |
| **Total** | **environ 130-150 $ US**, ou environ 220 $ US sans le niveau gratuit |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par
compte de facturation, il ne s'applique donc que si c'est votre seul cluster de ce type. En
africa-south1 (Johannesburg), Cloud SQL coûte le même prix, et le pod et la VM environ 10 %
de plus. Deux éléments déterminent le chiffre :

- **GKE ne se met pas à l'échelle zéro.** Au moins un pod Odoo fonctionne toujours, de sorte
  que les actions planifiées (récupération de courrier, factures récurrentes, rappels)
  continuent de fonctionner, et le coût est le même, que quelqu'un utilise Odoo ou non. Des
  pods supplémentaires, jusqu'à trois par défaut, ne sont ajoutés qu'en cas de charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise une petite VM NFS par
  défaut. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US
  par mois à elle seule.

### Comparaison pour dix utilisateurs internes {#how-it-compares-for-ten-internal-users}

| Option | Édition | Par mois | Qui l'exécute |
|---|---|---|---|
| Odoo Online, plan Standard | Enterprise | 220 £ (10 × 22 £, facturé annuellement ; 180 £ la première année) | Odoo. Les modules personnalisés ne sont pas autorisés |
| Odoo Online, plan Personnalisé | Enterprise | 410 £ (10 × 41 £, facturé annuellement) | Odoo. Ajoute Studio, l'API externe et la multi-entreprise |
| Odoo.sh, 1 worker, 20 Go, 1 branche de staging | Enterprise | Environ 468 £ (58 £ d'hébergement + 410 £ de licence Custom) | Odoo héberge ; vous gérez votre code |
| Enterprise sur vos propres serveurs | Enterprise | Licence de 410 £, plus les serveurs | Vous |
| Hébergement communautaire géré (Cloudpepper Pro, serveur moyen) | Community | 73 € | Le fournisseur, sur hébergement partagé |
| Votre propre serveur (Hetzner CPX22 ou DigitalOcean 2 vCPU, 4 Go) | Community | 20 €, ou 24 $ US plus 7 $ US pour les sauvegardes quotidiennes | Vous : système d'exploitation, PostgreSQL, sauvegardes, correctifs, mises à niveau |
| **RAD, GKE Autopilot, votre propre projet** | Community | **Environ 130-150 $ US**, plus 17,50 $ US une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | Community | **Environ 2 970 crédits (238-297 $ US)** | RAD |
| RAD, Cloud Run | Community | Environ 84 $ US, ou 960 crédits ; voir le [guide Cloud Run](Odoo_CloudRun.md) | RAD |

Les prix d'Odoo ont été relevés sur odoo.com depuis le Royaume-Uni. Odoo fixe les prix par
pays, et ses prix dans de nombreux pays africains sont plus bas, alors vérifiez odoo.com/pricing
depuis votre propre pays. Ce que le tableau montre :

- **Les licences augmentent avec chaque utilisateur ; le coût de RAD augmente avec la charge.**
  Les plans d'Odoo facturent chaque utilisateur ayant accès au back-office. Le coût de RAD
  est l'infrastructure, qu'une équipe croissante n'atteint que lorsqu'elle a besoin de plus
  de capacité. Pour dix utilisateurs, RAD sur GKE coûte entre un quart et la moitié du plan
  Odoo Online Custom, et l'écart se creuse à mesure que l'équipe grandit.
- **Community n'est pas Enterprise.** Enterprise ajoute la comptabilité complète, Studio, les
  applications mobiles, Helpdesk, Field Service, Planning et d'autres applications (voir la
  comparaison des éditions d'Odoo). Si vous en avez besoin, comparez avec Odoo Online ou
  Odoo.sh : le module de RAD déploie Community.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.** Sur
  RAD, la base de données est Cloud SQL, avec des sauvegardes quotidiennes et sept jours de
  récupération à un instant précis, plus une exportation nocturne de la base de données et
  des fichiers. Les mots de passe sont conservés dans Secret Manager, et les journaux et la
  surveillance proviennent de Google Cloud. Sur votre propre serveur, chacune de ces tâches
  doit être effectuée par quelqu'un.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Odoo s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option
qui va bien au-delà de la mise à l'échelle zéro : **supprimer l'ensemble du projet et le
restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à Odoo dont vous
n'avez besoin qu'occasionnellement — pour préparer une certification, un environnement de
démonstration, une activité saisonnière — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation
  est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression
  d'un seul module, cela ne supprime pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble
  du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de
  rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de
  module à nouveau. Pour Odoo sur GKE derrière un petit Services_GCP et Project_GCP, cela
  représente environ **7 crédits au total (moins de 1 $ US)**, contre les 185 crédits que
  coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 130-150 $
  US.** Déployez Odoo, utilisez-le un soir, supprimez le projet. Restaurez-le la prochaine
  fois que vous le souhaitez, confirmez avec Update, et supprimez-le à nouveau lorsque vous
  avez terminé. Vous ne payez que les frais de module une fois, les builds et les heures
  pendant lesquelles Odoo était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez
  et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30
  jours — après cela, Google le supprime définitivement. La restauration est admise comme la
  création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le
  seuil du niveau (100 crédits pour le niveau sandbox que la plupart des études et
  démonstrations utilisent). Google indique que la plupart des services sont à nouveau
  entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  quotidiennes de la base de données et des fichiers d'Odoo sont écrites dans un bucket à
  l'intérieur du projet, et ce bucket **n'est pas** protégé par la suppression
  logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous
  supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous
  avez apporté des modifications à Odoo que vous souhaitez conserver, copiez une sauvegarde
  (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle
zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  185 crédits (18,50 $ US) et environ une heure, car RAD recrée le projet et les services
  partagés avant Odoo. La suppression permet d'économiser de l'argent si Odoo resterait
  inutilisé pendant environ quatre jours ou plus dans votre propre projet (environ 5 $ US
  par jour), ou environ deux jours dans un projet géré par RAD (99 crédits par jour).
- **Supprimez tout ce qu'Odoo utilise.** La majeure partie du coût d'exécution est la base de
  données et le serveur de fichiers. Ils ne s'arrêtent que si rien d'autre dans le projet ne
  les utilise, donc la suppression d'Odoo pendant que d'autres applications partagent le
  projet n'économise que la partie GKE.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à
  l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez
  la dernière sauvegarde sur Google Drive, ou sur un bucket que vous conservez.
- **Restaurer lors du redéploiement.** Déployez à nouveau avec `enable_backup_import = true`,
  `backup_source = "gdrive"`, `backup_file` définis sur l'ID du fichier Drive et `backup_format` sur
  `sql`, `tar` ou `zip`. L'importation lit depuis Google Drive ou depuis le propre
  bucket de sauvegarde du nouveau déploiement, donc une copie conservée ailleurs dans Cloud
  Storage doit y être téléchargée en premier. Vérifiez vos pièces jointes après
  l'importation.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous
  saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Odoo pour une
  classe. Chaque participant obtient Odoo dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places à l'avance, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session, et les crédits inutilisés sont reversés au
  formateur. Une session de trois heures coûte environ 20 crédits (2 $ US) par participant
  en builds et en coût d'exécution, plus les frais de module, sauf si les frais sont
  supprimés pour la session.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Odoo pour un
  client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le
  client. Si le portefeuille est faible, la facturation est interrompue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin de l'engagement,
  le partenaire transfère le projet, et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage
sans suppression logicielle ; frais RAD et l'estimation quotidienne de 99 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Tarification
Odoo](https://www.odoo.com/pricing), [Tarification Odoo.sh](https://www.odoo.sh/pricing) et
[Éditions Odoo](https://www.odoo.com/page/editions) ;
[Cloudpepper](https://cloudpepper.io/pricing), [Hetzner Cloud](https://www.hetzner.com/cloud)
et [DigitalOcean](https://www.digitalocean.com/pricing/droplets). Les prix changent ;
vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Odoo fonctionne comme une charge de travail ERP Python/PostgreSQL. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Odoo, 1 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique d'un à trois pods |
| Base de données | Cloud SQL pour PostgreSQL | Requis — Odoo ne prend pas en charge MySQL ou SQL Server ; PostgreSQL 17 par défaut, à partir des services partagés |
| Fichiers partagés | Serveur de fichiers NFS (VM Compute Engine) | Le filestore d'Odoo, les sessions et les répertoires d'addons supplémentaires partagés entre toutes les répliques ; une petite VM e2-small par défaut, avec Filestore disponible en option |
| Stockage d'objets | Cloud Storage | Un bucket d'addons dédié (`odoo-addons`) pour les addons personnalisés et communautaires |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; requis lorsque `max_instance_count > 1` pour partager l'état de la session |
| Secrets | Secret Manager | Mot de passe maître auto-généré (`ODOO_MASTER_PASS`) et mot de passe de base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** Le moteur de base de données est fixe ; la sélection de
  MySQL ou `NONE` interrompt le démarrage.
- **NFS est requis.** Sans le volume NFS partagé, le filestore d'Odoo (pièces jointes,
  champs binaires, actifs compilés) est isolé de chaque pod et perdu au redémarrage.
- **L'affinité de session est `ClientIP`.** Odoo stocke les sessions sur NFS ; l'épinglage des
  requêtes au même pod évite les recherches de session inter-pods.
- **Deux jobs d'initialisation s'exécutent à chaque déploiement.** `nfs-init` configure la
  propriété du répertoire NFS et `db-init` crée la base de données et l'utilisateur
  PostgreSQL — les deux sont idempotents.
- **Le mot de passe maître Odoo** est généré automatiquement et stocké dans Secret Manager ;
  vous ne le définissez jamais en texte clair.
- **Le premier démarrage est lent.** Odoo installe le module de base et exécute les
  migrations de schéma au premier démarrage ; la sonde de démarrage autorise jusqu'à 9
  minutes (délai de 180 s + 3 × période de 120 s).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Odoo {#a-gke-autopilot--the-odoo-workload}

Les pods Odoo sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres de répliques minimum et maximum.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  Odoo pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Check Odoo version running in the container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- odoo --version
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

Odoo stocke toutes les données ERP (contacts, factures, inventaire, commandes) dans une
instance Cloud SQL pour PostgreSQL gérée. Les pods l'atteignent en privé via le sidecar
**Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune IP publique n'est exposée. Au
premier déploiement, le job `db-init` crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs et les métriques.
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

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle
de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Serveur de fichiers NFS et Cloud Storage {#c-nfs-file-server-and-cloud-storage}

Le filestore d'Odoo (pièces jointes binaires, images, actifs compilés), les données de
session et les répertoires d'addons supplémentaires sont écrits sur un **partage NFS** servi
par une petite VM Compute Engine et monté dans chaque pod, de sorte que toutes les répliques
voient les mêmes fichiers. Filestore peut remplacer la VM, mais sa plus petite instance est
de 1 Tio. Un bucket **Cloud Storage** dédié (`odoo-addons`) est également provisionné pour les
addons personnalisés et communautaires.

- **Console :** Compute Engine → Instances de VM pour le serveur NFS ; Cloud Storage →
  Buckets pour le bucket d'addons.
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

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis prend en charge le stockage de session d'Odoo lorsque plusieurs répliques sont en
cours d'exécution. Sans Redis, l'affinité de session (`ClientIP`) est la seule protection
contre la perte de session lors du redémarrage du pod. Redis est désactivé par défaut ;
définissez `enable_redis = true` et `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS_"
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe maître Odoo (`ODOO_MASTER_PASS`) et le mot de passe de la base de données sont
stockés en tant que secrets Secret Manager et injectés dans les pods au moment de
l'exécution ; le texte clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de
Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et
une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de
l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers
Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives
sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
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
    `/mnt/extra-addons` avec la propriété `101:101` (l'utilisateur du processus Odoo). Doit
    réussir avant le démarrage d'Odoo.
  - `db-init` — s'exécute après `nfs-init` et crée de manière idempotente la base de
    données PostgreSQL et l'utilisateur de l'application. Les deux jobs peuvent être
    réexécutés en toute sécurité.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
  kubectl logs -n "$NAMESPACE" -l job-name=db-init
  ```
- **Migration de schéma au démarrage.** Le conteneur démarre Odoo avec `-i base`, qui
  applique automatiquement toutes les migrations de schéma en attente. Les mises à niveau de
  version sont appliquées au prochain démarrage du pod.
- **Mot de passe maître Odoo.** Un mot de passe alphanumérique de 16 caractères
  auto-généré est stocké dans Secret Manager et injecté en tant que `ODOO_MASTER_PASS`. Il
  protège l'interface de gestion de la base de données à `/web/database/manager`. Remplacez-le en
  utilisant `explicit_secret_values` :
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **SMTP pour les e-mails sortants.** Odoo utilise des variables d'environnement pour son
  transport de courrier sortant (confirmations de commande, réinitialisations de mot de
  passe, notifications CRM). Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_SSL` et `EMAIL_FROM` dans `environment_variables` avant la mise en service ; déplacez
  `SMTP_PASSWORD` vers `secret_environment_variables`.
- **Chemin de santé.** La sonde de démarrage autorise 180 secondes de délai initial, puis
  vérifie `GET
  /web/health` (HTTP 200 uniquement lorsque Odoo a une connexion de base de données
  active). La sonde de vivacité continue de vérifier `/web/health` toutes les 30 secondes. Au
  premier démarrage (création de schéma à partir de zéro), le démarrage peut prendre 2 à 10
  minutes selon le CPU disponible.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost:8069/web/health
  # Expect: 200
  ```
- **Planificateur d'arrière-plan Odoo (cron).** Le planificateur intégré d'Odoo nécessite au
  moins un pod en cours d'exécution. Conservez `min_instance_count = 1` en production pour éviter
  l'interruption du cron.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Odoo sont listés ; toutes les
autres entrées sont héritées d'[App_GKE](App_GKE.md) avec son comportement standard et ses
valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `odoo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Odoo ERP` | Nom convivial affiché dans la console. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `18.0` | Canal nocturne Odoo à installer (`"18.0"`, `"17.0"`, `"16.0"`). Incrémenter pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` construit à partir du Dockerfile nocturne d'Odoo ; `"prebuilt"` déploie une image existante. |
| `container_image` | `""` | Remplace l'URI de l'image (utilisé avec `"prebuilt"`). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de ressources par pod. **Augmenter à ≥ 2 vCPU / 4 Gio pour la production.** |
| `min_instance_count` | `1` | Répliques minimales. Garder ≥ 1 pour préserver le planificateur cron d'Odoo. |
| `max_instance_count` | `3` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `8069` | Port sur lequel Odoo écoute. Ne pas modifier sauf si le serveur Odoo est reconfiguré. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image du conteneur dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en texte clair. Vide par défaut — définissez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` ici pour les e-mails sortants. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager (par exemple `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Valeurs sensibles écrites dans Secret Manager pendant le déploiement. Utilisez-les pour définir un `ODOO_MASTER_PASS` personnalisé. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant ; requis lorsque Redis n'est pas activé pour le partage de session. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Balises de pod ; `nfsserver` est requis pour la connectivité du pare-feu NFS. |
| `gke_cluster_name` | `""` | Nom du cluster cible ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour la génération automatique. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les PVC par pod dans le StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de PVC par pod. Prévoir 100 Gio+ dans les déploiements ERP actifs. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage à l'intérieur du pod pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont traités comme des octets par Kubernetes et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Délai généreux pour la création de schéma au premier démarrage. Augmenter `failure_threshold` à `5` lors des tout premiers déploiements. |
| `health_check_config` | `{ path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Vérification de vivacité. `/web/health` renvoie 200 uniquement lorsque Odoo a une connexion de base de données active. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de disponibilité facultative de Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `nfs-init` + `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées définies par l'utilisateur (Kubernetes CronJobs). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — les répertoires de filestore, de sessions et d'addons d'Odoo doivent résider sur un stockage partagé. |
| `nfs_mount_path` | `/mnt` | Chemin de montage NFS à l'intérieur du conteneur tel que vu par App_GKE. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket d'addons. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket `odoo-addons` géré par Odoo. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage de session. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — ne pas changer pour MySQL ou `NONE`. |
| `application_database_name` | `gkeappdb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeappuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installer des extensions PostgreSQL (par exemple `postgis`, `unaccent`) après le provisionnement. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 90+ pour les données financières/de conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer un dump PostgreSQL lors du déploiement. |

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
| `enable_iap` | `false` | Exiger la connexion Google devant Odoo. Recommandé pour les déploiements ERP réservés aux administrateurs. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. Fortement recommandé pour tout déploiement Odoo exposé à Internet. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP dans le cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Odoo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
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
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critique | Odoo requiert exclusivement PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, les pièces jointes et les données de session sont isolées dans chaque pod et perdues au redémarrage. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données ERP. |
| `container_resources.memory_limit` | `≥ 4Gi` pour la production | Critique | La valeur par défaut `512Mi` provoque un OOM Python immédiat pendant le chargement du module. Toujours augmenter à au moins `2Gi`. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont traités comme des octets par Kubernetes et bloquent toute planification. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | fort, unique | Critique | Le gestionnaire de base de données à `/web/database/manager` n'est protégé que par ce mot de passe ; une valeur faible expose la suppression de la base de données à quiconque peut atteindre l'URL. |
| `enable_redis` | `true` lorsque `max_instance_count > 1` | Élevé | Sans Redis et `session_affinity = ClientIP`, les utilisateurs sont déconnectés lorsqu'ils sont acheminés vers un pod différent. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true` ; vide provoque des échecs du backend de session au démarrage. |
| `application_version` | LTS valide (`18.0`, `17.0`) | Élevé | Une balise de version invalide fait échouer l'étape Cloud Build pendant la création de l'image. |
| `container_image_source` | `custom` | Élevé | Odoo requiert une image personnalisée pour connecter le socket PostgreSQL et les chemins du filestore ; une image amont non configurée pour les sockets Unix Cloud SQL échouera à se connecter. |
| `min_instance_count` | `1` | Élevé | `0` arrête le planificateur d'arrière-plan Odoo (cron) et ajoute des démarrages à froid de 30 à 60 secondes. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance et sans Redis, les déploiements multi-réplicas perdent continuellement l'état de la session. |
| `backup_retention_days` | `90` pour la production | Élevé | Odoo contient des enregistrements financiers ; 7 jours sont insuffisants pour la plupart des exigences de conformité. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Le gestionnaire de base de données Odoo et le portail d'administration ne devraient pas être accessibles publiquement sans authentification. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds lorsque le pod unique ne peut pas être expulsé. |
| `stateful_pvc_size` | `100Gi`+ pour la production | Moyen | Les pièces jointes ERP (factures, contrats, images de produits) s'accumulent rapidement. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes, et
mise en miroir des images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Odoo
partagée avec la variante Cloud Run est décrite dans **[Odoo_Common](Odoo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Odoo sur GKE Autopilot](../labs/Odoo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Odoo sur Cloud Run](Odoo_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Configuration d'application partagée Odoo](Odoo_Common.md) — la configuration partagée par les deux cibles de déploiement.
