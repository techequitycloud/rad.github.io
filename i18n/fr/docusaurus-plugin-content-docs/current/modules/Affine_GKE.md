---
title: "AFFiNE sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'AFFiNE sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Affine_GKE.md @ e69407af sha256:fe650bb3801a -->

# AFFiNE sur GKE Autopilot {#affine-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Affine_GKE.png" alt="AFFiNE sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

AFFiNE est une base de connaissances open source, axée sur la confidentialité,
qui unifie les documents, les tableaux blancs et les bases de données dans un
seul espace de travail — une alternative auto-hébergeable à Notion et Miro. Ce
module déploie AFFiNE sur **GKE Autopilot** comme une fine couche au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'AFFiNE utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte AFFiNE sur RAD, et comment cela se compare {#what-affine-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'AFFiNE sur RAD coûte environ 150 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 300 crédits (30 $ US au prix de la recharge) dans un projet que vous possédez, et 270 crédits (10 % de moins) dans un projet géré par RAD. GKE convient aux applications AFFiNE qui doivent rester actives en continu ou s'adapter à plusieurs pods ; pour le coût le plus bas, le [module Cloud Run](Affine_CloudRun.md) exécute le même AFFiNE pour environ 181 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 150 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 150 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois (environ 333 $ US au prix de la recharge, 266 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le serveur de fichiers/cache sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'en ajoute pas une deuxième.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 150 $ US** |

### Comment cela se compare {#how-it-compares}

- Notion, l'acteur historique qu'AFFiNE vise à remplacer, facture **8,50 £/membre/mois** sur son plan Plus et **16,50 £/membre/mois** sur son plan Business — une licence par siège qui augmente avec les effectifs, contrairement au coût d'infrastructure fixe d'AFFiNE ici.
- **RAD exécute le projet open source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** L'exécution du même logiciel open source par vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près la même chose ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher que cela en termes monétaires — la différence réside dans la base de données gérée, Secret Manager et la surveillance qui sont inclus avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AFFiNE s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que l'exécution continue d'AFFiNE.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'AFFiNE écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimez et redéployez {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 305 crédits (environ 30,50 $ US) dans votre propre projet, ou 275 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'AFFiNE resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 6 jours ou plus dans votre propre projet (4,99 $ US/jour) ou 2 jours ou plus dans un projet géré par RAD (111 crédits/jour).
- **La majeure partie du coût d'exécution est généralement l'infrastructure partagée.** La base de données et la VM de fichiers ou de cache ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, de sorte que la suppression d'AFFiNE pendant qu'une autre application partage le projet n'économise que la partie calcul d'AFFiNE.
- **Gardez vos données en premier.** Tout ce qu'AFFiNE écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'AFFiNE dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute AFFiNE pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification Notion](https://www.notion.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

AFFiNE s'exécute comme un serveur Node.js auto-hébergé unique. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de serveur Node.js sur le port 3010, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` |
| Collaboration en temps réel | Redis (co-hébergé sur la VM NFS partagée) | Pub/sub de synchronisation de documents Yjs et file d'attente de jobs en arrière-plan |
| Persistance des fichiers | Cloud Filestore (NFS) | Les blobs téléchargés persistent sous `/root/.affine/storage`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement (sauvegardes/stockage auxiliaire) |
| Secrets | Secret Manager | Seul le mot de passe de la base de données auto-généré — la propre clé de signature d'AFFiNE réside dans PostgreSQL |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15`
  et `Affine_Common` fixe le moteur quoi qu'il arrive — les autres moteurs ne sont pas
  pris en charge.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur loopback, pas via un
  socket.** `enable_cloudsql_volume = true` exécute un sidecar cloud-sql-proxy
  écoutant sur `127.0.0.1:5432` (le modèle GKE) — c'est différent de
  la variante Cloud Run, qui monte un socket Unix. Le point d'entrée cloud
  résout l'hôte loopback et définit `sslmode=disable` pour celui-ci ; une
  véritable IP privée (Cloud Run) obtient `sslmode=require` à la place.
- **Redis est requis, pas optionnel.** `enable_redis = true` par défaut ; la
  VM NFS partagée co-héberge également Redis, donc la description indique
  explicitement de conserver `enable_nfs = true` à moins qu'un `redis_host`
  externe ne soit fourni. Sans Redis, la synchronisation de documents en temps
  réel et la file d'attente de jobs ne fonctionnent pas.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à
  `/root/.affine/storage`) afin que les blobs téléchargés persistent et puissent être
  partagés entre les pods — et parce qu'il héberge l'instance Redis dont
  l'application dépend.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Pas de compte/mot de passe administrateur à récupérer.** AFFiNE n'a pas de
  crédential administrateur de première exécution forcée ; le premier
  utilisateur à s'inscrire sur l'URL déployée devient le propriétaire de
  l'espace de travail.
- **La clé de signature réside dans la base de données, pas dans Secret Manager.** AFFiNE
  génère sa clé de signature/privée pendant l'étape `affine-migrate`
  du job `self-host-predeploy` et la persiste dans PostgreSQL — `secret_ids` est
  intentionnellement vide ; le mot de passe de la base de données est le seul
  secret que Secret Manager détient pour cette application.
- **La création du schéma se fait dans un job d'initialisation, pas au démarrage.** Le
  job `affine-migrate` exécute `node ./scripts/self-host-predeploy` (migration
  idempotente + génération de clé) avant le démarrage du conteneur du serveur,
  il n'y a donc pas d'étape d'installation au premier démarrage à attendre
  pendant l'exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail AFFiNE {#a-gke-autopilot--the-affine-workload}

Les pods AFFiNE sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Le type de charge de travail est résolu via
la logique partagée `workload_type`/`stateful_pvc_enabled` (voir
[App_GKE](App_GKE.md)) ; par défaut, AFFiNE s'exécute en tant que
`Deployment`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail AFFiNE pour
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~affine 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AFFiNE stocke toutes les données de l'espace de travail (documents, tableaux
blancs, bases de données, utilisateurs) dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Les pods y accèdent via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du
premier déploiement, le job `db-init` crée le rôle et la base de
données de l'application et accorde les privilèges (plus une concession
`cloudsqlsuperuser` au mieux pour que les migrations puissent
`CREATE EXTENSION`) ; le job `affine-migrate` exécute ensuite la
propre migration de schéma d'AFFiNE.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Redis — collaboration en temps réel {#c-redis--real-time-collaboration}

La synchronisation de documents Yjs pub/sub et la file d'attente de jobs en
arrière-plan d'AFFiNE nécessitent Redis. `enable_redis = true` par défaut ;
lorsque `redis_host` est laissé vide, la Fondation injecte l'IP du
serveur NFS partagé (la VM NFS co-héberge Redis). Le point d'entrée cloud
mappe les `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` injectés
sur les `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD` d'AFFiNE.

- **Console :** Compute Engine → Instances de VM (la VM NFS/Redis partagée).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i REDIS
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Voir [App_GKE](App_GKE.md) pour la découverte et le provisionnement de la VM NFS/Redis partagée.

### D. Cloud Storage — persistance des fichiers {#d-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est
provisionné automatiquement et le compte de service de la charge de travail
se voit accorder l'accès ; il sert aux sauvegardes et au stockage auxiliaire.
Séparément, les blobs téléchargés d'AFFiNE résident sur **NFS (Cloud
Filestore)** à `/root/.affine/storage`, partagés entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~affine"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Seul le secret du mot de passe de la base de données est généré
automatiquement pour AFFiNE — il n'y a pas de secret au niveau de
l'application car AFFiNE persiste sa propre clé de signature dans
PostgreSQL. Sur GKE, les secrets sont projetés dans les pods via le pilote
CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~affine"
  gcloud secrets versions access latest --secret=<database-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements). Un domaine personnalisé avec un
certificat géré par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests
de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application AFFiNE {#3-affine-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` (`postgres:15-alpine`,
  délai d'expiration 600 s) crée de manière idempotente le rôle et la base de données de l'application,
  accorde les privilèges sur la base de données et le schéma `public`, et accorde au mieux
  `cloudsqlsuperuser` afin que les migrations ultérieures puissent `CREATE EXTENSION`. Il
  signale ensuite le sidecar Cloud SQL Auth Proxy (`POST /quitquitquit`) afin que le
  pod Job se termine proprement.
- **Migration de schéma dans un job d'initialisation dédié, pas au démarrage.** Le
  job `affine-migrate` (l'image d'application AFFiNE construite, 2 Go de mémoire, délai d'expiration
  1200 s, `max_retries = 3`) s'exécute après `db-init` et exécute le propre
  `node ./scripts/self-host-predeploy` d'AFFiNE, qui effectue la migration de schéma idempotente
  **et génère la clé de signature/privée**, la persistant dans
  PostgreSQL. Le conteneur d'exécution ne migre jamais en ligne — au moment où le
  serveur démarre, le schéma et la clé existent déjà.
- **Pas de compte administrateur forcé.** AFFiNE n'a pas de
  crédential superadministrateur imposée par l'image ; le premier utilisateur à
  visiter l'URL déployée et à s'inscrire devient le propriétaire initial de
  l'espace de travail.
- **La connexion à la base de données est TCP-over-loopback via le sidecar Auth Proxy, pas un
  socket.** Le point d'entrée cloud (`cloud-entrypoint.sh`) assemble
  `DATABASE_URL` à partir des variables `DB_*` injectées ; sur GKE, l'hôte résolu est
  `127.0.0.1` (le sidecar proxy) donc il utilise `sslmode=disable`. Il mappe également
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` sur les
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD` d'AFFiNE, et
  définit par défaut `AFFINE_SERVER_EXTERNAL_URL` sur l'URL de service injectée par la plateforme
  afin que les liens d'invitation/partage se résolvent correctement.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /` ; les sondes de vivacité et
  de disponibilité utilisent `GET /info`, le point de terminaison d'informations du serveur d'AFFiNE. Le
  chemin de vivacité doit renvoyer un 200 littéral car App_GKE le reflète dans la
  vérification de santé de la passerelle — `/` redirige (302), ce que kubelet accepte mais le
  load balancer traite comme malsain, de sorte que la passerelle servirait 503. Sonde de démarrage : 60 s de délai initial, 15 s de période, 30 seuils d'échec
  (jusqu'à ~510 s à partir du démarrage du conteneur). Vivacité : 60 s de délai initial,
  30 s de période, 3 seuils d'échec. Étant donné que la migration s'exécute dans le
  job `affine-migrate` séparé, la fenêtre de démarrage couvre principalement le chargement du bundle Node.js
  et la configuration de la connexion Redis/PostgreSQL, et non la création du schéma.
- **L'indexeur de texte intégral est désactivé.** `AFFINE_INDEXER_ENABLED = "false"`
  car l'indexeur nécessite un backend de recherche basé sur pgvector qui n'est pas
  provisionné par ce module ; le serveur démarre sur PostgreSQL + Redis simple.
- **Inspectez les jobs d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<affine-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_SERVER|AFFINE_SERVER'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
AFFiNE sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `affine` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image pour `ghcr.io/toeverything/affine`. `latest` correspond à `stable` (AFFiNE ne publie pas de tag `latest`). Incrémenter pour déclencher une nouvelle construction d'image. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | AFFiNE est toujours une construction personnalisée légère par rapport à l'image amont afin que le point d'entrée cloud puisse s'exécuter. |
| `container_port` | `3010` | Port du serveur auto-hébergé d'AFFiNE. |
| `container_resources.cpu_limit` | `2000m` | 2 vCPU par défaut. |
| `container_resources.memory_limit` | `4Gi` | 4 Gi par défaut. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods. |
| `max_instance_count` | `5` | Nombre maximal de réplicas de pods. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy sur loopback (`127.0.0.1:5432`) — requis sur GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du socket Unix Auth Proxy (utilisé pour le point de terminaison metadata/quitquitquit, pas la connexion DB elle-même). |
| `enable_image_mirroring` | `true` | Toujours vrai — l'image de base est mise en miroir de Docker Hub/GHCR vers Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur d'AFFiNE. |
| `workload_type` | `null` → `Deployment` | Déploiement par défaut. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |
| `network_tags` | `["nfsserver"]` | Appliqué aux nœuds/pods ; correspond au tag de pare-feu de la VM NFS/Redis partagée. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Garder vrai — la VM NFS partagée co-héberge également l'instance Redis dont AFFiNE a besoin ; la désactiver supprime à la fois la persistance des blobs et Redis à moins qu'un `redis_host` externe ne soit fourni. |
| `nfs_mount_path` | `/root/.affine/storage` | Où AFFiNE stocke les blobs téléchargés. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la production — la synchronisation en temps réel Yjs et la file d'attente de jobs s'exécutent via Redis. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS partagé. |
| `redis_port` | `6379` | Port TCP Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis, si nécessaire. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE nécessite PostgreSQL 15+ ; les autres moteurs sont rejetés par la couche Common. |
| `application_database_name` | `affine` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `affine` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre AFFiNE. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `affine-migrate`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails CI/CD GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | La sélection d'un moteur non-PostgreSQL rompt `self-host-predeploy` et toutes les requêtes. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `enable_redis` | `true` | Critique | La synchronisation de documents en temps réel et la file d'attente de jobs d'AFFiNE dépendent de Redis ; la désactiver sans alternative rompt la collaboration et les jobs en arrière-plan. |
| `enable_nfs` | `true` (sauf si un `redis_host` externe est fourni) | Critique | La VM NFS partagée co-héberge également Redis — la désactivation de NFS sans Redis externe supprime silencieusement la connexion Redis d'AFFiNE aussi, pas seulement la persistance des blobs. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité DB sur GKE. |
| `container_resources.memory_limit` | `4Gi` | Élevé | Le job d'initialisation `affine-migrate` seul demande 2 Gi ; sous-provisionner le conteneur du serveur risque un OOM sous une charge de collaboration en temps réel. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions en temps réel basées sur WebSocket. |
| `AFFINE_SERVER_EXTERNAL_URL` (par défaut automatique) | URL du service de la plateforme | Moyen | Si elle est incorrectement remplacée via `environment_variables`, les liens d'invitation et de partage se résolvent vers le mauvais hôte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `AFFINE_INDEXER_ENABLED` (fixe `false`) | Laisser tel quel sauf si une base de données vectorielle est connectée | Faible | L'activer sans un backend basé sur pgvector rompt l'indexeur de texte intégral. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et `AFFINE_SERVER_EXTERNAL_URL`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à AFFiNE
partagée avec la variante Cloud Run est décrite dans
**[Affine_Common](Affine_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AFFiNE sur GKE Autopilot](../labs/Affine_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [AFFiNE Common — Configuration d'application partagée](Affine_Common.md) — la configuration partagée par les deux cibles de déploiement.
