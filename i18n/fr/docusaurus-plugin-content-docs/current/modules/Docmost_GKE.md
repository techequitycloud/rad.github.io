---
title: "Docmost sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Docmost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Docmost_GKE.md @ e69407af sha256:a56a943539a6 -->

# Docmost sur GKE Autopilot {#docmost-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docmost_GKE.png" alt="Docmost sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Docmost est une plateforme collaborative de wiki et de documentation en temps réel
(une alternative à Confluence/Notion) open source, basée sur NestJS. Ce module déploie Docmost sur
**GKE Autopilot** par-dessus la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Docmost et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs
à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte Docmost sur RAD, et comment cela se compare {#what-docmost-costs-on-rad-and-how-that-compares}

**Le module Docmost sur GKE Autopilot de RAD coûte environ 110,13 $ US par mois sans licence par utilisateur.** Cela se compare à au moins 60 $ US par mois pour le plan Business hébergé de Docmost (6 $ US par utilisateur, minimum 10 utilisateurs). Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Pour le coût le plus bas, le [guide Cloud Run](Docmost_CloudRun.md) exécute le même Docmost pour environ 82,03 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 110,13 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110,13 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **95 crédits par jour**, soit environ 2 850 par mois (environ 285 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 110,13 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Docmost, plan Business (10 utilisateurs) | 60 $ US par mois (annuel), minimum 10 utilisateurs | Docmost |
| **RAD, GKE Autopilot, votre propre projet** | **Environ 110,13 $ US** | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **Environ 285 $ US** | RAD |

- Le plan Business de Docmost ajoute le SSO et des permissions avancées que l'édition **Community** open source — celle que RAD déploie — n'inclut pas ; comparez avec Business seulement si vous en avez réellement besoin. Le niveau Community gratuit de Docmost est le logiciel auto-hébergé que RAD automatise pour vous.
- Le coût de la licence sur le propre plan de Docmost augmente avec chaque utilisateur ajouté au-delà de dix ; le coût de RAD est l'infrastructure, qui ne bouge pas lorsque vous ajoutez un autre éditeur.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Docmost s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Docmost dont vous n'avez besoin qu'occasionnellement — pour étudier, une démo, une activité
saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne démantèle pas Cloud SQL, la VM NFS ou le pod GKE un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Docmost, contre
  les 162 crédits (16,20 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 110,13 $ US.** Déployez Docmost, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Docmost était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc
  très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, de la même manière que le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois que la fenêtre de 30 jours est
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits
  (17,95 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Docmost. La suppression permet d'économiser de l'argent une fois que Docmost resterait inutilisé
  pendant environ **5 jours ou plus** dans votre propre projet (environ 3,67 $ US par jour), ou environ
  **2 jours ou plus** dans un projet géré par RAD (95 crédits par jour).
- **Supprimez tout ce que Docmost utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Docmost.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou sur un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous devez saisir à nouveau les
  paramètres lors du déploiement.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  de Docmost dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Docmost pour un client à partir d'un
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

Docmost s'exécute comme une charge de travail web Node.js (NestJS) sur le port 3000. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods NestJS sur le port 3000, mise à l'échelle horizontale automatique entre 1 et 3 réplicas |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Docmost ne prend pas en charge MySQL ou d'autres moteurs |
| Cache et collaboration | Redis | **Requis** pour l'édition en temps réel et les files d'attente en arrière-plan ; activé par défaut |
| Stockage de fichiers | Filestore / NFS | Pièces jointes écrites sur le volume NFS à `/app/data/storage` |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement (non utilisé par le pilote `local` par défaut) |
| Secrets | Secret Manager | `APP_SECRET` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur empêche le démarrage.
- **Redis est requis et activé par défaut.** Docmost utilise Redis pour l'édition
  collaborative en temps réel et les files d'attente de jobs en arrière-plan. `enable_redis = true` est la
  valeur par défaut ; laisser `redis_host` vide co-localise Redis sur la VM du serveur NFS.
- **NFS est activé par défaut** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Le pilote de stockage `local` de Docmost y écrit les pièces jointes téléchargées afin qu'elles survivent
  aux redémarrages de pods et soient partagées entre les réplicas.
- **`APP_SECRET` est généré automatiquement** et stocké dans Secret Manager (également
  matérialisé en un Secret Kubernetes via le chemin des valeurs de secret explicites). Il signe
  et chiffre les sessions et les données sensibles et ne doit jamais être modifié après le premier démarrage
  sans fenêtre de maintenance.
- **La base de données est accessible via le sidecar Cloud SQL Auth Proxy sur `127.0.0.1`**
  (boucle de retour en texte clair, `sslmode=disable`) — le point d'entrée se ramifie sur `DB_HOST` pour
  choisir la bonne forme de connexion et le mode SSL par plateforme.
- **Une image personnalisée est construite via Cloud Build** (`container_image_source = "custom"`,
  base `docmost/docmost:latest`) enveloppant l'image officielle avec le point d'entrée qui
  assemble `DATABASE_URL` / `REDIS_URL` / `APP_URL`. Les images reconstruites se déploient avec
  `imagePullPolicy=Always`.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1` ; GKE ne prend pas en charge
  la mise à l'échelle à zéro) pour que le wiki et le point de terminaison de collaboration soient toujours accessibles.
- **La configuration initiale se fait via l'interface utilisateur.** Docmost n'a pas de
  informations d'identification par défaut — le premier visiteur crée l'espace de travail initial et le compte administrateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Docmost {#a-gke-autopilot--the-docmost-workload}

Les pods Docmost sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum
et maximum de réplicas. Étant donné que les pièces jointes résident sur le volume NFS partagé, le
déploiement utilise la stratégie `Recreate` pour les mises à jour afin d'éviter que deux pods n'écrivent le même
état NFS/DB pendant un déploiement progressif.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Docmost pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Docmost stocke toutes les données d'application (espaces, pages, commentaires, utilisateurs, permissions) dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent en privé via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` (boucle de retour en texte clair) ; aucune adresse IP publique
n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application ; Docmost applique ensuite ses propres migrations de schéma automatiquement au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`docmost`), l'utilisateur (`docmost`) et le secret Secret Manager
contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Redis (collaboration en temps réel et files d'attente) {#c-redis-real-time-collaboration--queues}

Redis est **activé par défaut** et est requis pour l'éditeur collaboratif en temps réel de Docmost
et le traitement des jobs en arrière-plan. Lorsque `redis_host` est laissé vide et `enable_nfs`
est vrai, l'adresse IP de la VM du serveur NFS est utilisée comme point de terminaison Redis ; définissez `redis_host`
(et éventuellement `redis_auth`) pour pointer vers un Redis géré/externe à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_URL is assembled inside the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_URL
  ```

### D. Cloud Storage et stockage de fichiers NFS {#d-cloud-storage--nfs-file-storage}

Docmost écrit les pièces jointes téléchargées dans son pilote de stockage `local` à
`/app/data/storage`, soutenu par le volume **NFS** afin que les fichiers persistent lors des redémarrages de pods
et soient partagés entre les réplicas. Un bucket de données **Cloud Storage** dédié est également
provisionné automatiquement (disponible si vous passez Docmost à un pilote de stockage d'objets).

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`APP_SECRET` (utilisé pour signer et chiffrer les sessions et les données sensibles). Sur GKE, il est également
matérialisé en un Secret Kubernetes. Le mot de passe de la base de données est géré séparément par
la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Docmost {#3-docmost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  la base de données et l'utilisateur de l'application et accorde les privilèges, puis signale au
  sidecar proxy de s'arrêter afin que le job puisse se terminer. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent automatiquement au démarrage.** Docmost exécute ses propres migrations de schéma à
  chaque démarrage via sa commande `pnpm start` par défaut, de sorte que la mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte.
- **`APP_SECRET` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager (et un Secret Kubernetes). Le modifier invalide toutes les sessions existantes
  et rend les données chiffrées avec l'ancienne valeur irrécupérables — ne le modifiez que dans
  une fenêtre de maintenance planifiée.
- **`APP_URL` doit correspondre à l'URL accessible.** Il est injecté comme URL de service interne/prédite
  et utilisé pour les liens absolus et le WebSocket de collaboration. Une fois l'adresse IP du LoadBalancer externe (ou le domaine personnalisé) connue, définissez `APP_URL` sur cette URL externe
  via `environment_variables` (ou corrigez le déploiement) :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" APP_URL="https://docmost.example.com"
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health` — le point de terminaison public
  200 de Docmost. Prévoyez environ 2 minutes au premier démarrage pendant l'exécution des migrations.
- **Création de compte au premier démarrage.** Docmost est livré sans identifiants par défaut. Accédez à
  l'adresse IP / au domaine du LoadBalancer et remplissez le formulaire de configuration pour créer le premier
  espace de travail et l'utilisateur administrateur. Faites-le rapidement après le déploiement.
- **Reconstructions personnalisées.** Étant donné que l'image est construite sur mesure, les images reconstruites réutilisent une
  balise de version ; App_GKE définit `imagePullPolicy=Always` afin que les nœuds tirent la nouvelle image
  plutôt que de servir une couche mise en cache obsolète.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Docmost sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docmost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Docmost` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Balise d'image Docmost (mappée à l'ARG de build `DOCMOST_VERSION`) ; épingler à une version spécifique en production. |

### Groupe 4 — Conteneur et échelle {#group-4--container--scale}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Docmost est construit à partir d'un Dockerfile personnalisé enveloppant l'image officielle. |
| `container_image` | `docmost/docmost:latest` | Image de base en amont que le build personnalisé enveloppe. |
| `container_port` | `3000` | Docmost écoute sur le port 3000. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE nécessite ≥ 1 (pas de mise à l'échelle à zéro). |
| `max_instance_count` | `3` | Réplicas maximum. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connexion en boucle. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) sont définies automatiquement — ne définissez pas `APP_SECRET`, `DATABASE_URL` ou `REDIS_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Résout en `Deployment` (sans état ; l'état est dans Postgres/NFS). |
| `session_affinity` | `ClientIP` | Le routage persistant maintient le WebSocket de collaboration d'un client sur un seul pod. |
| `namespace_name` | `""` | Espace de noms (par défaut à l'espace de noms dérivé par application). |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser désactivé — Docmost conserve l'état dans PostgreSQL et NFS partagé, pas dans des PVC par pod. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod (uniquement si un StatefulSet est choisi). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` / `quota_memory_requests` / `quota_memory_limits` | `false` / `""` / `""` | **Non référencé** — l'ensemble du bloc du Groupe 8 est déclaré uniquement pour la compatibilité d'interface ; il n'a aucun effet sur le déploiement de ce module. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health` 60s de délai | Sonde de démarrage. Prévoir ~2 minutes au premier démarrage. |
| `health_check_config` | HTTP `/api/health` | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring optionnelle (point de terminaison public). |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut — prend en charge le chemin des pièces jointes `/app/data/storage`. |
| `nfs_mount_path` | `/app/data/storage` | Chemin de montage correspondant au pilote de stockage local de Docmost. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de données auto-provisionné. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis** — Docmost utilise Redis pour l'édition en temps réel et les files d'attente. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'adresse IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Docmost nécessite PostgreSQL 15. |
| `application_database_name` | `docmost` | Nom de la base de données de l'application. Immuable après le premier déploiement. |
| `application_database_user` | `docmost` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL pour atteindre Docmost. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnellement) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée, un quota de mémoire en entier nu. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_SECRET` (auto-généré) | Ne jamais modifier après le premier démarrage | Critique | Le modifier invalide toutes les sessions et rend les données chiffrées avec l'ancienne valeur irrécupérables. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Docmost nécessite PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_redis` | `true` | Critique | L'éditeur en temps réel et les files d'attente de jobs de Docmost nécessitent Redis ; le désactiver empêche l'application de fonctionner correctement. |
| `enable_nfs` | `true` | Élevé | Avec NFS désactivé, les pièces jointes téléchargées atterrissent sur un disque de pod éphémère et sont perdues au redémarrage / non partagées entre les réplicas. |
| `APP_URL` | URL du LoadBalancer externe / du domaine | Élevé | Une URL incorrecte rompt les liens absolus et le point de terminaison WebSocket de collaboration. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, le WebSocket de collaboration d'un client peut se reconnecter à un pod différent. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connexion PostgreSQL en boucle. |
| `min_instance_count` | `1` | Élevé | GKE nécessite un minimum ≥ 1 ; maintenir 1 garantit que le wiki est toujours accessible. |
| `stateful_pvc_enabled` | laisser désactivé | Moyen | Les PVC par pod sont inutiles — Docmost conserve l'état dans Postgres/NFS ; l'activer ajoute des coûts/complexité. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Docmost
partagée avec la variante Cloud Run est décrite dans
**[Docmost_Common](Docmost_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Docmost sur GKE Autopilot](../labs/Docmost_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docmost sur Google Cloud Run](Docmost_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Docmost Common — Configuration d'application partagée](Docmost_Common.md) — la configuration partagée par les deux cibles de déploiement.
