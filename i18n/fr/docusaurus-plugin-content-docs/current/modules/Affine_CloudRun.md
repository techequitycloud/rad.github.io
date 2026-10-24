---
title: "AFFiNE sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'AFFiNE sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Affine_CloudRun.md @ e69407af sha256:86567161abb0 -->

# AFFiNE sur Google Cloud Run {#affine-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Affine_CloudRun.png" alt="AFFiNE sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

AFFiNE est une base de connaissances open source, axée sur la confidentialité, qui unifie les documents, les tableaux blancs et les bases de données dans un seul espace de travail — une alternative auto-hébergeable à Notion et Miro. Ce module déploie AFFiNE sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'AFFiNE utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte AFFiNE sur RAD, et comment cela se compare {#what-affine-costs-on-rad-and-how-that-compares}

**AFFiNE sur le module Cloud Run de RAD coûte environ 181 US$ par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 300 crédits (30 US$ au prix de la recharge) dans un projet que vous possédez, et 270 crédits (10 % de moins) dans un projet géré par RAD. Si AFFiNE doit fonctionner en continu sur plusieurs pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Affine_GKE.md). Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 181 US$ par mois deviennent presque nuls. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 US$ au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 181 US$ par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **83 crédits par jour**, environ 2 490 par mois (environ 249 US$ au prix de la recharge, 199 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ en recharge unique, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données et le serveur de fichiers/cache sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'en ajoute pas une deuxième.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 181 US$** |

### Comment cela se compare {#how-it-compares}

- Notion, l'acteur en place qu'AFFiNE est conçu pour remplacer, facture **8,50 £/membre/mois** sur son plan Plus et **16,50 £/membre/mois** sur Business — une licence par siège qui continue de croître avec les effectifs, contre le coût d'infrastructure fixe d'AFFiNE ici.
- **RAD exécute le projet open source lui-même, et non la location hébergée d'un fournisseur.** Vous obtenez le même logiciel, sous votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui croît indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** L'exécution du même logiciel open source par vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un Droplet DigitalOcean 2 vCPU/4 Go (également 24 $/mois) est à peu près de la même forme ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher que cela en termes monétaires — la différence est la base de données gérée, Secret Manager et la surveillance qui viennent avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AFFiNE s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que l'exécution continue d'AFFiNE.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne supprime pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 US$), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'AFFiNE écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ
  305 crédits (environ 30,50 US$) dans votre propre projet, ou
  275 crédits dans un projet géré par RAD, car RAD reconstruit les ressources
  à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'AFFiNE resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 5 jours ou plus dans votre propre projet (6,03 US$/jour) ou 3 jours ou plus dans un projet géré par RAD (83 crédits/jour).
- **La majeure partie du coût d'exécution est généralement l'infrastructure partagée.** La base de données et la VM de fichier ou de cache ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, de sorte que la suppression d'AFFiNE pendant qu'une autre application partage le projet n'économise que la partie calcul d'AFFiNE.
- **Gardez vos données en premier.** Tout ce qu'AFFiNE écrit dans un bucket de sauvegarde à l'intérieur du déploiement est
  supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant
  de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque
  vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  AFFiNE dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur.
  Le formateur finance toutes les places, ou chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute AFFiNE pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification Notion](https://www.notion.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Le serveur auto-hébergé d'AFFiNE s'exécute comme un conteneur Node.js unique sur Cloud Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut, instance unique toujours active |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — AFFiNE ne prend pas en charge MySQL (appliqué au moment de la planification) |
| Collaboration en temps réel | Redis | **Obligatoire** — pub/sub de synchronisation de documents Yjs et la file d'attente de jobs ; l'hôte NFS co-héberge le Redis par défaut |
| Stockage d'objets binaires | Filestore / NFS | Pièces jointes téléchargées persistantes à `/root/.affine/storage` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement ; AFFiNE n'a pas besoin de secret d'application |
| Image de conteneur | Cloud Build + Artifact Registry | Build personnalisé léger sur `ghcr.io/toeverything/affine` |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, LB HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Une validation au moment de la planification restreint `database_type` aux versions de PostgreSQL ; MySQL est rejeté.
- **Redis est obligatoire.** Une validation au moment de la planification échoue le déploiement si `enable_redis = false`. Sans `redis_host` explicite, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis.
- **Instance unique par conception.** `min_instance_count = 1`, `max_instance_count = 1`, `cpu_always_allocated = true` — les WebSockets de collaboration en temps réel doivent rester accessibles et alimentés en CPU, et l'état de collaboration par processus ainsi que les objets binaires du système de fichiers rendent la mise à l'échelle horizontale dangereuse.
- **Pas de socket Cloud SQL.** `enable_cloudsql_volume = false` : AFFiNE consomme une autorité d'URL `DATABASE_URL` qui ne peut pas contenir les deux-points du chemin du socket, de sorte que le point d'entrée se connecte via l'IP privée de l'instance avec `sslmode=require`.
- **Deux jobs d'initialisation à l'apply.** `db-init` crée la base de données et l'utilisateur de manière idempotente ; `affine-migrate` exécute `self-host-predeploy` d'AFFiNE (migration de schéma + génération de clé de signature) avant le démarrage du serveur.
- **Pas de secret d'application.** AFFiNE persiste sa propre clé de signature dans PostgreSQL pendant la migration ; seul le **mot de passe de la base de données** auto-généré réside dans Secret Manager.
- **Les sondes de santé ciblent `/`** — AFFiNE renvoie HTTP 200 sur son chemin racine une fois prêt.
- **`application_version = "latest"` correspond à `stable`** — AFFiNE ne publie pas de tag d'image `latest`.
- **La recherche en texte intégral/vectorielle est désactivée** (`AFFINE_INDEXER_ENABLED = "false"`) — l'indexeur a besoin d'un backend vectoriel non provisionné ici.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service AFFiNE {#a-cloud-run--the-affine-service}

AFFiNE s'exécute en tant que service Cloud Run v2 épinglé à une seule instance toujours active. Chaque déploiement crée une révision immuable ; le trafic se déplace vers la plus récente et saine.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AFFiNE stocke les espaces de travail, les documents, les utilisateurs et sa propre clé de signature dans une instance Cloud SQL pour PostgreSQL 15 gérée. Étant donné que `DATABASE_URL` d'AFFiNE est un DSN d'autorité d'URL, le service se connecte via l'**IP privée avec TLS** (`sslmode=require`) plutôt que le socket du proxy d'authentification. Lors du premier déploiement, le job `db-init` crée la base de données et l'utilisateur de l'application, puis `affine-migrate` crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis — collaboration en temps réel {#c-redis--real-time-collaboration}

Redis gère le pub/sub de synchronisation de documents Yjs d'AFFiNE et sa file d'attente de jobs en arrière-plan — le déploiement refuse de planifier sans lui. Lorsqu'aucun `redis_host` externe n'est configuré, le Redis co-hébergé du serveur NFS partagé est utilisé automatiquement.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée) ; Compute Engine → Instances de VM (l'hôte NFS/Redis).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info clients
  ```

### D. Filestore (NFS) et Cloud Storage {#d-filestore-nfs-and-cloud-storage}

Les objets binaires téléchargés (images, pièces jointes, intégrations de fichiers) sont écrits sur un partage **NFS** monté à `/root/.affine/storage`, afin qu'ils survivent aux révisions et aux redémarrages. Un bucket **Cloud Storage** dédié (suffixe `storage`) est également provisionné automatiquement. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances (ou Compute Engine → Instances de VM pour la VM NFS auto-gérée) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données auto-généré est le seul secret — AFFiNE génère et stocke sa clé de signature dans PostgreSQL pendant le job `affine-migrate`, de sorte qu'aucun secret d'application n'existe pour être géré ou tourné.

- **Console :** Sécurité → Secret Manager.
- **CLI :
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité. Le point d'entrée cloud par défaut `AFFINE_SERVER_EXTERNAL_URL` à l'URL de service injectée afin que les invitations et les liens de partage se résolvent correctement.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application AFFiNE {#3-affine-application-behaviour}

- **Configuration de la base de données en deux étapes.** À l'apply, `db-init` (image `postgres:15-alpine`) crée de manière idempotente le rôle et la base de données AFFiNE, accorde les privilèges, et accorde au mieux `cloudsqlsuperuser` afin que les migrations puissent `CREATE EXTENSION`. Ensuite, `affine-migrate` exécute `node ./scripts/self-host-predeploy` d'AFFiNE en utilisant l'image de l'application construite — migration de schéma idempotente **plus génération de clé de signature**. Les deux peuvent être réexécutés en toute sécurité ; `affine-migrate` réessaie jusqu'à 3 fois.
- **La clé de signature réside dans la base de données.** Contrairement à la plupart des applications, il n'y a pas de variable d'environnement de type `APP_SECRET` : la clé générée par `self-host-predeploy` est persistante dans PostgreSQL, de sorte que le déploiement ne contient aucun secret d'application à désynchroniser ou à faire pivoter.
- **Assemblage DSN au démarrage.** Le point d'entrée cloud construit `DATABASE_URL` à partir des variables `DB_*` injectées par la Fondation (encodage URL des identifiants) et mappe `REDIS_HOST/PORT/AUTH` à `REDIS_SERVER_*` d'AFFiNE. Sur Cloud Run, il se connecte à l'IP privée de Cloud SQL avec `sslmode=require` ; une variable d'environnement `DATABASE_URL` prédéfinie a la priorité.
- **URL externe.** `AFFINE_SERVER_EXTERNAL_URL` par défaut est l'URL du service Cloud Run. Définissez-le explicitement (via `environment_variables`) une fois qu'un domaine personnalisé est actif afin que les liens de partage et les e-mails d'invitation utilisent le bon hôte.
- **Configuration initiale.** Ouvrez l'URL du service et créez le premier compte — sur une nouvelle instance auto-hébergée AFFiNE, le premier utilisateur enregistré devient l'administrateur du serveur, et le panneau d'administration se trouve à `<url>/admin`.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/`, qui renvoie HTTP 200 une fois le serveur prêt (fenêtre de démarrage : 60 s de délai initial + jusqu'à 30 × 15 s).
- **Contrainte de mise à l'échelle.** Le service est épinglé à une seule instance toujours active. Les objets binaires sur le système de fichiers NFS et l'état Yjs par processus rendent les instances multiples dangereuses ; mettez à l'échelle verticalement (`cpu_limit` / `memory_limit`) à la place.
- **Vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~affine" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" \
    --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"    # expect 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour AFFiNE sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès IAM et les alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `affine` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image pour `ghcr.io/toeverything/affine` ; `latest` correspond à `stable`. Incrémenter pour déclencher une reconstruction et une nouvelle révision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | AFFiNE nécessite au moins 2 Gi pour un fonctionnement fiable. |
| `container_port` | `3010` | Port natif du serveur auto-hébergé d'AFFiNE. |
| `min_instance_count` | `1` | Maintient le serveur WebSocket de collaboration toujours accessible — la mise à l'échelle à zéro interrompt les sessions d'édition en direct. |
| `max_instance_count` | `1` | **Épinglé.** Les objets binaires sur le système de fichiers + l'état de collaboration par processus rendent la mise à l'échelle horizontale dangereuse. |
| `cpu_always_allocated` | `true` | La synchronisation WebSocket Yjs est affamée sous la limitation du CPU basée sur les requêtes — gardez la valeur true pour un éditeur collaboratif en direct. |
| `enable_cloudsql_volume` | `false` | L'autorité d'URL `DATABASE_URL` d'AFFiNE ne peut pas contenir le chemin du socket Cloud SQL ; le point d'entrée utilise l'IP privée avec `sslmode=require`. |
| `container_image_source` | `custom` | La build de wrapper léger fournit le point d'entrée cloud — requis. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionné sur les valeurs par défaut `Affine_Common` (`NODE_ENV`, `AFFINE_SERVER_HOST/PORT`, `AFFINE_CONFIG_PATH`, `AFFINE_INDEXER_ENABLED=false`). Ne jamais définir `PORT` — c'est un nom réservé à Cloud Run et cela interrompt la création de Job. |
| `secret_environment_variables` | `{}` | AFFiNE n'a pas besoin de secret d'application par défaut. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Stockage d'objets binaires **et** l'hôte Redis par défaut. Gardez la valeur true sauf si un `redis_host` externe est fourni. |
| `nfs_mount_path` | `/root/.affine/storage` | Où AFFiNE persiste les objets binaires téléchargés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun. Le bucket GCS `storage` est toujours provisionné par `Affine_Common`.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE nécessite PostgreSQL — MySQL est rejeté au moment de la planification. |
| `db_name` / `db_user` | `affine` / `affine` | Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour les jobs intégrés `db-init` (`postgres:15-alpine`) + `affine-migrate` (image d'application construite). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60 s de délai, 30 échecs | Fenêtre généreuse pour le premier démarrage. |
| `liveness_probe` | HTTP `/`, 60 s de délai | Le chemin racine renvoie 200 une fois prêt. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité de Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — la validation au moment de la planification rejette `false`. Pub/sub Yjs + file d'attente de jobs. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP de l'hôte NFS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls {#group-22--vpc-service-controls}

Toutes les entrées suivent le comportement standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging`).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

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
| `database_host` / `database_port` | Point de terminaison / port de la base de données (l'hôte est sensible). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket AFFiNE `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `affine-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

La validation croisée des variables s'exécute au moment de la planification (`validation.tf`) : elle impose PostgreSQL, Redis obligatoire avec un hôte résolvable, les comptes d'instances `min ≤ max`, et rejette un volume Cloud SQL avec `database_type = "NONE"` — les mauvaises configurations échouent rapidement au lieu de produire un déploiement défectueux.

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | AFFiNE nécessite PostgreSQL ; MySQL est rejeté au moment de la planification. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les espaces de travail. |
| `enable_redis` | `true` | Critique | Obligatoire — la collaboration en temps réel et la file d'attente de jobs nécessitent Redis ; `false` échoue la planification. |
| `redis_host` | `""` (NFS) ou explicite | Critique | Redis activé avec NFS désactivé et aucun hôte défini échoue la validation ; un hôte incorrect interrompt la synchronisation des documents à l'exécution. |
| `enable_nfs` | `true` | Critique | Sans NFS, les objets binaires téléchargés atterrissent sur un disque éphémère et disparaissent à chaque révision/redémarrage — et l'hôte Redis par défaut disparaît. |
| `container_port` | `3010` | Critique | Port natif d'AFFiNE ; une non-concordance échoue toutes les sondes de santé. |
| `max_instance_count` | `1` | Critique | Plus d'une instance divise l'état de collaboration par processus et les objets binaires du système de fichiers — divergence de données silencieuse. |
| `container_image_source` | `custom` | Élevé | L'image amont n'a pas le point d'entrée qui assemble `DATABASE_URL` / `REDIS_SERVER_*` — le serveur ne peut pas atteindre sa base de données. |
| `enable_cloudsql_volume` | `false` | Élevé | Les deux-points du chemin du socket interrompent l'analyseur d'URL d'AFFiNE (`invalid port`) ; conservez l'IP privée + `sslmode=require`. |
| `cpu_always_allocated` | `true` | Élevé | La limitation basée sur les requêtes affame la synchronisation WebSocket Yjs entre les requêtes — l'édition en direct est bloquée. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro interrompt les sessions de collaboration actives et ajoute des délais de démarrage à froid. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | Élevé | OOM Node.js pendant la synchronisation de documents ou la migration en dessous de 2 Gi. |
| `environment_variables` `PORT` | jamais défini | Élevé | `PORT` est réservé à Cloud Run ; le définir fait échouer chaque création de Job avec HTTP 400. |
| `application_version` | `stable` (tag épinglé) | Moyen | Les tags inexistants (par exemple, `latest` littéral) échouent la build de l'image ; le module mappe `latest` → `stable`. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2. |
| `AFFINE_SERVER_EXTERNAL_URL` | URL du service / domaine personnalisé | Moyen | Un hôte incorrect interrompt les liens d'invitation et les URL de partage. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à AFFiNE partagée avec la variante GKE est décrite dans **[Affine_Common](Affine_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : AFFiNE sur Cloud Run](../labs/Affine_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [AFFiNE sur GKE Autopilot](Affine_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [AFFiNE Common — Configuration d'application partagée](Affine_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Penpot sur Google Cloud Run](Penpot_CloudRun.md), [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) dans la solution **Design & Collaboration Visuelle**.
