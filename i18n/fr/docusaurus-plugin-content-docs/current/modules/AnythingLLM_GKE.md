---
title: "AnythingLLM sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'AnythingLLM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/AnythingLLM_GKE.md @ 1665a43e sha256:d16ae96a5c24 -->

# AnythingLLM sur GKE Autopilot {#anythingllm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AnythingLLM_GKE.png" alt="AnythingLLM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

AnythingLLM est un espace de travail d'IA privé et une plateforme de génération augmentée
par la récupération (RAG) qui permet aux équipes de discuter avec des documents, de se
connecter à n'importe quel fournisseur de LLM (OpenAI, Anthropic, Ollama et autres) et de
créer des assistants de connaissances basés sur l'IA — sans envoyer de données à des
services tiers. Ce module déploie AnythingLLM sur **GKE Autopilot** sur la base du module
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par AnythingLLM et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la
fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte AnythingLLM sur RAD, et comment cela se compare {#what-anythingllm-costs-on-rad-and-how-that-compares}

**AnythingLLM sur le module GKE Autopilot de RAD coûte environ 150 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 175 crédits (17,50 $ US au prix de la recharge) dans un projet que vous possédez, et 157,5 crédits (10 % de moins) dans un projet géré par RAD. GKE convient à AnythingLLM qui doit rester opérationnel en continu ou s'adapter à plusieurs pods ; pour le coût le plus bas, le [module Cloud Run](AnythingLLM_CloudRun.md) exécute le même AnythingLLM pour environ 102 $ US par mois. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 150 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 150 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **112 crédits par jour**, soit environ 3 360 par mois (environ 336 $ US au prix de la recharge, 269 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le serveur de fichiers/cache sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'en ajoute pas une deuxième.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 150 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre Cloud hébergée d'AnythingLLM — le même logiciel, géré par son créateur — facture **50 $/mois** (Basic, une instance privée) ou **99 $/mois** (Pro, ressources prioritaires et SLA de support). RAD exécute la même application open source sur une infrastructure que vous ou RAD contrôlez, plutôt que sur une location partagée par un tiers.
- **RAD exécute le projet open source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sous votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par utilisateur ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** L'exécution du même logiciel open source par vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près de la même forme ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher que cela en termes monétaires — la différence est la base de données gérée, Secret Manager et la surveillance qui sont inclus avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AnythingLLM s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — pour préparer une certification, une démo, un besoin saisonnier — que l'exécution continue d'AnythingLLM.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet pour lequel RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes ne survivent pas.** Tout ce qu'AnythingLLM écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement supprimé dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de secours pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'AnythingLLM resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 4 jours ou plus dans votre propre projet (4,99 $ US/jour) ou 1 jour ou plus dans un projet géré par RAD (112 crédits/jour).
- **La majeure partie du coût d'exécution est généralement une infrastructure partagée.** La base de données et la VM de fichier ou de cache ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'AnythingLLM alors qu'une autre application partage le projet n'économise que la partie calcul d'AnythingLLM.
- **Gardez vos données en premier.** Tout ce qu'AnythingLLM écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient AnythingLLM dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute AnythingLLM pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification AnythingLLM Cloud](https://anythingllm.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

AnythingLLM s'exécute comme une charge de travail d'IA Node.js. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — AnythingLLM utilise Prisma ORM et ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Bucket de documents `anythingllm-docs` auto-provisionné ; buckets supplémentaires facultatifs |
| Volumes persistants | PVC Kubernetes (StatefulSet) | Facultatif — PVC de 20 GiB par pod à `/app/server/storage` lorsque `stateful_pvc_enabled = true` |
| Fichiers partagés | Filestore (NFS) | Activé par défaut (`enable_nfs = true`) — `STORAGE_DIR` pointe vers le montage NFS afin que l'index vectoriel LanceDB survive aux redémarrages/redéploiements de pods |
| Secrets | Secret Manager | Quatre secrets d'application auto-générés (`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`) plus le mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |
| Cache | Redis | Désactivé par défaut ; facultatif pour les charges de travail de session ou de cache |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma d'AnythingLLM nécessite PostgreSQL. Ne définissez pas `database_type` sur une variante MySQL ou SQL Server.
- **Quatre secrets d'application sont auto-générés.** `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY` et `SIG_SALT` sont créés dans Secret Manager lors du premier déploiement ; vous ne les définissez jamais en texte clair.
- **`min_instance_count = 1` est recommandé** pour maintenir AnythingLLM actif et éviter les démarrages à froid lors des opérations de chat et d'intégration de documents IA.
- **Le stockage doit être persistant.** Tous les documents de l'espace de travail, les index vectoriels et les données de conversation sont écrits sous `STORAGE_DIR`. AnythingLLM y conserve son index vectoriel LanceDB, qui réside sur le disque éphémère du pod sans NFS — de sorte que la base de connaissances est silencieusement effacée à chaque redémarrage/redéploiement de pod. `enable_nfs = true` par défaut pointe `STORAGE_DIR` vers le montage NFS afin que les vecteurs survivent ; `stateful_pvc_enabled = true` (désactivé par défaut) est un chemin de persistance alternatif uniquement pour un seul pod à `/app/server/storage`.
- **Redis est désactivé par défaut.** Il n'est pas requis pour la fonctionnalité principale d'AnythingLLM. Activez-le uniquement si votre déploiement nécessite une couche de cache partagée.
- **`stateful_pvc_enabled = true` sélectionne automatiquement `StatefulSet`** et monte un PVC de 20 GiB à `/app/server/storage` avec `fsGroup = 1000` pour correspondre à l'utilisateur du conteneur AnythingLLM.
- **La variable d'environnement `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` est définie automatiquement** à partir du bucket GCS `anythingllm-docs` provisionné.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail AnythingLLM {#a-gke-autopilot--the-anythingllm-workload}

Les pods AnythingLLM sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de réplicas. Les opérations d'intégration et d'inférence d'IA nécessitent au moins 2 vCPU et 4 GiB de RAM.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail AnythingLLM pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AnythingLLM stocke toutes les métadonnées de l'espace de travail, les comptes d'utilisateur et l'historique des conversations dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune adresse IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

La chaîne de connexion Prisma `DATABASE_URL` est assemblée par le script d'entrée d'AnythingLLM à partir des variables d'environnement `DB_*` injectées par la fondation au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage — bucket de documents {#c-cloud-storage--document-bucket}

`AnythingLLM_Common` provisionne automatiquement un bucket **Cloud Storage** dédié (`anythingllm-docs`) pour le stockage de documents et de vecteurs. Le compte de service de la charge de travail reçoit automatiquement l'accès et le nom du bucket est injecté en tant que `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Des buckets supplémentaires peuvent être déclarés dans `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<docs-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Volumes persistants (PVC StatefulSet) {#d-persistent-volumes-statefulset-pvcs}

Pour les déploiements à pod unique ou à données persistantes, l'activation de `stateful_pvc_enabled = true` crée un **PersistentVolumeClaim Kubernetes** par pod monté à `/app/server/storage` (le répertoire de stockage d'AnythingLLM). Le contexte de sécurité `fsGroup = 1000` garantit que l'utilisateur du conteneur peut écrire sur le volume.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Confirm the volume is mounted correctly:
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls /app/server/storage
  ```

### E. Filestore (NFS) — stockage persistant par défaut {#e-filestore-nfs--default-persistent-storage}

`enable_nfs = true` par défaut. L'index vectoriel LanceDB d'AnythingLLM se trouve sous `STORAGE_DIR`, qui par défaut est le disque éphémère du pod — sans NFS, la base de connaissances est silencieusement effacée à chaque redémarrage ou redéploiement de pod (les métadonnées de document persistent dans Postgres, mais les vecteurs disparaissent). Avec NFS activé, `STORAGE_DIR` est pointé vers `nfs_mount_path` afin que les vecteurs survivent, et les déploiements multi-pods partagent la même vue de document et de vecteur. `stateful_pvc_enabled = true` (désactivé par défaut) est une alternative pour la persistance uniquement pour un seul pod à `/app/server/storage`.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour les détails de provisionnement NFS.

### F. Secret Manager {#f-secret-manager}

Quatre secrets d'application AnythingLLM sont auto-générés et stockés dans Secret Manager — `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY` et `SIG_SALT` — plus le mot de passe de la base de données. Aucun de ceux-ci n'apparaît en texte clair nulle part dans le déploiement.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### G. Réseau et ingress {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Un test de disponibilité ciblant `/api/ping` est activé par défaut.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application AnythingLLM {#3-anythingllm-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job d'initialisation (`db-init`) utilise l'image `postgres:15-alpine` pour créer la base de données et l'utilisateur AnythingLLM avant le démarrage de la charge de travail. Il est idempotent et peut être réexécuté en toute sécurité.
- **Migrations Prisma au démarrage.** Le script d'entrée construit la chaîne de connexion `DATABASE_URL` à partir des variables d'environnement `DB_*` injectées par la plateforme et exécute les migrations Prisma, de sorte que les mises à niveau de version appliquent automatiquement les modifications de schéma.
- **Chargement du modèle d'IA.** AnythingLLM charge les modèles d'intégration en mémoire au premier démarrage. La sonde de démarrage utilise un délai initial de 60 secondes et 30 périodes d'échec (×10 secondes = 5 minutes au total) pour s'adapter à cela.
- **Chemin de santé.** Les sondes de disponibilité et de vivacité ciblent toutes deux `/api/ping`, qui renvoie HTTP 200 uniquement lorsque l'application est entièrement initialisée. Ce point de terminaison fonctionne aussi bien dans GKE où le trafic de sonde atteint le conteneur directement sans aucune redirection.
- **Configuration du fournisseur LLM.** Utilisez `environment_variables` pour les paramètres de fournisseur non sensibles (`LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`) et `secret_environment_variables` pour mapper les noms de variables d'environnement aux secrets Secret Manager pour les clés API (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
- **Cohérence du moteur d'intégration.** La modification de `EMBEDDING_ENGINE` après l'ingestion de documents rend les index vectoriels existants incompatibles. Tous les documents doivent être réingérés après toute modification du moteur d'intégration.
- **Variables d'environnement fixes.** `SERVER_PORT=3001`, `UID=1000` et `GID=1000` sont définis automatiquement par `AnythingLLM_Common`. Ne les remplacez pas. `AnythingLLM_Common` définit également `STORAGE_DIR=/app/server/storage` comme sa propre valeur par défaut ; `AnythingLLM_GKE` le définit sur le chemin de montage NFS (`nfs_mount_path`, par défaut `/app/server/storage`) chaque fois que `enable_nfs = true` — la valeur par défaut — de sorte que l'index vectoriel et les documents persistent sur le partage NFS au propre chemin de stockage de l'image (voir Section E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour AnythingLLM sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

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
| `application_name` | `anythingllm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `AnythingLLM` | Nom convivial affiché dans la console. |
| `application_description` | `AnythingLLM Private AI Workspace on GKE` | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image ; épingler à un tag de version pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="4Gi" }` | Limites CPU/Mémoire. Minimum 2 vCPU / 4 GiB pour les charges de travail IA. |
| `min_instance_count` | `1` | Réplicas minimum. Maintenir ≥ 1 pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `3001` | Port HTTP natif d'AnythingLLM. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `timeout_seconds` | `300` | Délai d'expiration du backend de l'équilibreur de charge. Augmenter pour l'ingestion de documents longs. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets, par exemple `LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager pour les clés API. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Mode d'affinité de session. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu VPC. |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir `true` pour activer le PVC par pod et sélectionner automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. Minimum 20 GiB recommandé pour les données du magasin de vecteurs. |
| `stateful_pvc_mount_path` | `/app/server/storage` | Chemin de montage — répertoire de stockage d'AnythingLLM. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_fs_group` | `1000` | GID `fsGroup` au niveau du pod ; correspond à l'utilisateur du conteneur AnythingLLM. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`8Gi`, `16Gi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | `/api/ping`, délai initial de 60 s, 30 échecs | Fenêtre de démarrage étendue pour le chargement du modèle d'IA. |
| `health_check_config` / `liveness_probe` | `/api/ping`, délai initial de 30 s | Sonde de vivacité contre le point de terminaison de santé d'AnythingLLM. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, tâches de maintenance). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires aux côtés d'AnythingLLM. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Filestore (NFS) est monté par défaut — requis pour que l'index vectoriel LanceDB d'AnythingLLM (sous `STORAGE_DIR`) survive aux redémarrages/redéploiements de pods au lieu de résider sur un disque éphémère. |
| `nfs_mount_path` | `/app/server/storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. Le bucket `anythingllm-docs` est toujours créé. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis pour la fonctionnalité principale d'AnythingLLM. Activer pour les charges de travail de cache facultatives. |
| `redis_host` | `null` | Point de terminaison Redis. **Requis** lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe pour AnythingLLM — ne pas modifier. |
| `application_database_name` | `anythingllmdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `anythingllmuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Activer l'installation de l'extension PostgreSQL. |
| `postgres_extensions` | `[]` | Extensions à installer (par exemple, `['uuid-ossp', 'vector']`). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant AnythingLLM. **Recommandé pour la production.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre AnythingLLM. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `anythingllm-docs`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | AnythingLLM nécessite PostgreSQL ; tout autre moteur rompt Prisma ORM et provoque un crash au démarrage. |
| Persistance `STORAGE_DIR` | `stateful_pvc_enabled=true` ou NFS | Critique | Sans volume persistant, tous les documents de l'espace de travail, les index vectoriels et les données de conversation sont perdus lors de l'expulsion du pod. |
| `secret_environment_variables` (clés API) | Utiliser les références Secret Manager | Critique | Les clés API du fournisseur en `environment_variables` sont visibles dans les spécifications des pods Kubernetes. Utiliser `secret_environment_variables` pour tous les secrets. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_file` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`8Gi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation entraîne l'échec de toutes les connexions à la base de données au démarrage. |
| `container_resources.memory_limit` | `4Gi` | Élevé | Le pipeline d'intégration d'AnythingLLM nécessite 3 à 4 GiB de RAM ; les erreurs OOM (manque de mémoire) corrompent l'ingestion en cours. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro entraîne des démarrages à froid de 30 à 60 s ; les opérations d'IA en cours pendant la réduction d'échelle sont perdues. |
| `timeout_seconds` | `300` (augmenter pour les charges de travail lourdes) | Élevé | L'ingestion de documents longs ou les complétions LLM lentes dépassent le délai d'attente du backend, renvoyant 504. |
| `EMBEDDING_ENGINE` | défini une fois | Élevé | La modification du moteur d'intégration après l'ingestion rend les vecteurs existants incompatibles ; tous les documents doivent être réingérés. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Sans IAP, l'accès n'est contrôlé que par l'écran de connexion de l'application. |
| `enable_redis` | `false` (ou définir `redis_host`) | Moyen | Si `enable_redis = true` et `redis_host` n'est pas résolvable, le conteneur ne démarre pas. |
| `enable_nfs` | `true` (par défaut) | Moyen | Activé par défaut pour que l'index vectoriel LanceDB survive aux redémarrages des pods ; le désactiver isole également les pods multi-réplicas sur un stockage éphémère, ce qui rompt l'accès aux documents entre les pods. |
| `application_version` | épingler à une balise de version | Moyen | `latest` risque des mises à niveau rompant le schéma en production. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
mise à l'échelle automatique, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à AnythingLLM partagée avec la variante Cloud Run est décrite dans
**[AnythingLLM_Common](AnythingLLM_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : AnythingLLM sur GKE Autopilot](../labs/AnythingLLM_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [AnythingLLM sur Google Cloud Run](AnythingLLM_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [AnythingLLM Common — Configuration d'application partagée](AnythingLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
