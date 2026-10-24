---
title: "Tolgee sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Tolgee sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Tolgee_GKE.md @ e69407af sha256:bae73d168394 -->

# Tolgee sur GKE Autopilot {#tolgee-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tolgee_GKE.png" alt="Tolgee sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tolgee est une plateforme open source de **gestion de la localisation (i18n) et de la
traduction** conviviale pour les développeurs, construite sur Spring Boot. Ce module
déploie Tolgee sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Tolgee et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Tolgee sur RAD, et comment cela se compare {#what-tolgee-costs-on-rad-and-how-that-compares}

**Le module Tolgee sur GKE Autopilot de RAD coûte environ 149,81 $ US par mois dans un projet Google Cloud que vous possédez, avec des frais de module uniques de 175 crédits (17,50 $ US, ou 157,5 crédits dans un projet géré par RAD, soit 10 % de moins).** C'est la moins chère des deux façons d'exécuter Tolgee sur RAD — le [module Cloud Run](Tolgee_CloudRun.md) exécute la même plateforme pour environ 180,87 $ US par mois, maintenue toujours active, pour les mêmes frais de module. Les pods GKE Autopilot gèrent la disponibilité continue à moindre coût qu'une instance Cloud Run toujours active. Si vous n'avez besoin de Tolgee qu'occasionnellement — une poussée de traduction avant une version, une évaluation avant de l'adopter — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **149,81 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan hébergé de Tolgee, **Tolgee Cloud**, commence par un niveau gratuit (30 000 mots, 3 sièges), puis **Translate** à **58 €/mois** (environ 63 $ US), **Optimise** à **133 €/mois** (environ 144 $ US), et **Manage** à **373 €/mois** (environ 403 $ US), tous facturés annuellement (source : [tolgee.io/pricing](https://tolgee.io/pricing)). Le chiffre de RAD pour un projet propre se situe entre les niveaux Translate et Optimise de Tolgee Cloud, mais il achète une instance dédiée avec sa propre base de données et son propre serveur de fichiers plutôt qu'une instance partagée et limitée en sièges.
- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — tous moins chers en termes de trésorerie, mais l'exécution d'une plateforme i18n toujours accessible avec sa propre base de données, son propre serveur de fichiers et les frais généraux de cluster partagé signifie des correctifs, des sauvegardes et du TLS manuels.
- La disponibilité continue par défaut de Tolgee est ce qui rend le coût d'exécution de ce guide plus élevé que de nombreux autres modules sur RAD — les flux de travail de traduction sont généralement vérifiés tout au long de la journée de travail plutôt qu'ouverts occasionnellement, il est donc configuré pour ne pas réduire l'échelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Tolgee s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne supprime pas Cloud SQL, la VM NFS ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez des clés de traduction et un historique que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Tolgee purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Tolgee reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 4,99 $ US par jour), cela représente environ 4 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (111 crédits par jour). La majeure partie du coût d'exécution ici est le pod GKE, la base de données et le serveur de fichiers NFS ; ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Tolgee pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tolgee.io/pricing](https://tolgee.io/pricing) pour les plans hébergés de Tolgee Cloud.

## 1. Vue d'ensemble {#1-overview}

Tolgee s'exécute comme une charge de travail web Java / Spring Boot. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Spring Boot, 2 vCPU / 4 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Tolgee ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket pour le stockage de fichiers optionnel (captures d'écran/importations) |
| Secrets | Secret Manager | Mot de passe administrateur initial et secret de signature JWT générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, nom de domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur empêche le démarrage.
- **Tolgee se connecte à Cloud SQL via TCP via la boucle de l'Auth Proxy.** Son pilote
  JDBC PostgreSQL intégré ne peut pas utiliser un socket Unix, donc sur GKE, le point
  d'entrée se connecte au sidecar Cloud SQL Auth Proxy sur `127.0.0.1` (TCP simple,
  pas de SSL — le proxy termine TLS). `enable_cloudsql_volume` est donc par défaut
  **`true`**.
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager. Il ne doit
  jamais être renouvelé après le premier démarrage sans fenêtre de maintenance — le
  renouveler invalide immédiatement toutes les sessions utilisateur actives.
- **`SERVER_PORT`, pas `PORT`.** Tolgee lit `SERVER_PORT = 8080` ; le module le définit
  explicitement sur le conteneur.
- **L'affinité de session est `ClientIP` par défaut** afin que les sessions UI du même
  client reviennent au même pod.
- **Pas de Redis.** Tolgee stocke tout l'état de traduction dans PostgreSQL ; `enable_redis`
  est par défaut `false`.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle
  à zéro) ; `max_instance_count` est par défaut `5`, mais maintenez-le à
  `1` pour un déploiement stateful à un seul rédacteur, sauf si vous avez
  validé la sécurité des rédacteurs concurrents.
- **Le schéma est créé par Liquibase au premier démarrage** — pas de job de migration
  séparé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Tolgee {#a-gke-autopilot--the-tolgee-workload}

Les pods Tolgee sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Tolgee
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type
de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tolgee stocke toutes les données d'application (projets, langues, clés, traductions,
utilisateurs) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y
accèdent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` via TCP (le
pilote JDBC de Tolgee ne peut pas utiliser un socket Unix) ; aucune IP publique n'est
exposée. Lors du premier déploiement, l'étape `create-db-and-user.sh` du socle crée la base de
données et le rôle, et Tolgee exécute ses propres migrations Liquibase au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** (`name_suffix = "storage"`) est provisionné pour le stockage de
fichiers optionnel — Tolgee conserve les traductions dans PostgreSQL, donc ce bucket ne
contient que les captures d'écran téléchargées ou les artefacts d'importation si vous le
montez via `gcs_volumes` ou configurez le stockage de fichiers compatible S3 de
Tolgee. Le compte de service de la charge de travail se voit accorder l'accès.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/            # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : le **mot de
passe administrateur initial** (`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`) utilisé pour se connecter pour la
première fois, et le **secret de signature JWT** (`TOLGEE_AUTHENTICATION_JWT_SECRET`) utilisé pour
signer tous les jetons de session utilisateur. Le mot de passe de la base de données est
géré séparément par le socle. Sur GKE, la couche commune expose également les valeurs
brutes des secrets afin que la charge de travail puisse contourner la cohérence
lecture-après-écriture de Secret Manager (le modèle Keycloak/Directus).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et `reserve_static_ip` est par défaut **`true`** — il
s'agit d'une valeur par défaut requise, pas d'une simple commodité : `App_GKE`
calcule le `GKE_SERVICE_URL` injecté dans le conteneur à partir de l'adresse IP statique
*réservée*, mais revient au nom d'hôte `*.svc.cluster.local` interne au cluster
inaccessible si aucune adresse IP statique n'est réservée et que l'adresse IP éphémère du
LoadBalancer n'est pas encore connue au moment où Terraform rend les variables d'environnement
du déploiement. Tolgee est l'un des modules corrigés par cette valeur par défaut lors de
la campagne de vérification GKE à l'échelle de la flotte (voir [Variables de
configuration → Groupe 19](#group-19--custom-domain-static-ip--networking)).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de
l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques
GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité
optionnels (contre `/actuator/health`) et des politiques d'alerte sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Tolgee {#3-tolgee-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Aucun job d'initialisation
  dédié n'est exécuté — l'étape `create-db-and-user.sh` du socle App_GKE crée le rôle et la
  base de données PostgreSQL et accorde la propriété du schéma. Tolgee crée et migre
  ensuite l'intégralité de son schéma avec **Liquibase** automatiquement au premier
  démarrage.
- **Migrations au démarrage.** Tolgee applique ses changements Liquibase à chaque démarrage,
  donc la mise à niveau du `application_version` applique les changements de schéma sans
  étape séparée.
- **Le secret JWT est immuable après le premier démarrage.** Il est généré une fois et
  écrit dans Secret Manager et reste stable lors des redémarrages et des réplicas. La
  rotation de `TOLGEE_AUTHENTICATION_JWT_SECRET` invalide immédiatement toutes les sessions utilisateur
  actives — ne le faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Connexion au premier démarrage.** Après le déploiement, connectez-vous en tant que
  propriétaire initial : `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (par défaut `admin@techequity.cloud`) avec le mot de
  passe généré à partir de Secret Manager. Changez le mot de passe et configurez des
  fournisseurs d'authentification supplémentaires (Google/OAuth2/SSO) depuis l'interface
  utilisateur de Tolgee avant de passer en production.
- **Chemin de santé.** Les sondes de vivacité/démarrage/disponibilité ciblent
  **`/actuator/health`**, qui renvoie un `200` non authentifié
  seulement après la fin des migrations Liquibase. Prévoyez plusieurs minutes au premier
  démarrage (délai initial de 60 secondes plus une large fenêtre d'échec) — Spring Boot +
  les migrations au premier démarrage démarrent plus lentement qu'une application Node
  typique.
- **Écriture unique par conception.** Tolgee n'a pas de couche de file d'attente/coordination ;
  la mise à l'échelle au-delà d'un pod exécute des rédacteurs concurrents contre la même
  base de données et le même volume de montage NFS. Maintenez un seul réplica, sauf si
  vous avez validé la sécurité des rédacteurs concurrents pour votre charge de travail.
- **Inspectez le câblage de la base de données injecté dans le pod en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'SPRING_DATASOURCE|SERVER_PORT'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Tolgee sont listés ;
chaque autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tolgee` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image Tolgee utilisé comme `FROM tolgee/tolgee:<tag>` pour le build de l'enveloppe personnalisée mince. Épinglez à une version (par exemple `v3.130.4`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | Tolgee nécessite **au moins 2 GiB** de mémoire pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE nécessite ≥ 1 (pas de mise à l'échelle à zéro). |
| `max_instance_count` | `5` | Réplicas maximum. Maintenez à `1` sauf si la sécurité des rédacteurs concurrents est validée. |
| `container_port` | `8080` | `SERVER_PORT` de Spring Boot de Tolgee. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis ; Tolgee se connecte au proxy sur `127.0.0.1` via TCP. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant pour que les sessions UI reviennent au même pod. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (Deployment) | Tolgee stocke tout l'état dans PostgreSQL/NFS, donc un StatefulSet avec des PVC par pod n'est pas nécessaire. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Cloud Filestore NFS pour le stockage optionnel des pièces jointes Tolgee. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse pour le bucket de stockage de fichiers optionnel. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Laissez désactivé — Tolgee stocke tout l'état dans PostgreSQL et ne nécessite pas Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `tolgee` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `tolgee` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes avec un certificat géré par Google pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte servis par l'Ingress. |
| `reserve_static_ip` | `true` | **Valeur par défaut essentielle, pas seulement "peut être réservée".** `App_GKE` calcule le `GKE_SERVICE_URL` injecté (et toute URL auto-référente que Tolgee intègre dans la configuration au démarrage) à partir de l'adresse IP statique *réservée* ; avec `reserve_static_ip = false`, Terraform revient au nom d'hôte `*.svc.cluster.local` interne au cluster si l'adresse IP éphémère du LoadBalancer n'est pas encore connue lorsque les variables d'environnement du déploiement sont rendues — une véritable course, reproductible, pas un cas limite théorique. Tolgee est l'un des modules corrigés en basculant cela sur `true` pendant la campagne de vérification GKE à l'échelle de la flotte ; le laisser `false` risque que le service pointe vers une adresse inaccessible depuis l'extérieur du cluster. |
| `static_ip_name` | `""` | Nom de l'adresse IP statique réservée. Laissez vide pour générer automatiquement. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `gateway_backend_stage` | `"dev"` | Étape Cloud Deploy dont le service est ciblé par le HTTPRoute de la passerelle (ignoré lorsque `enable_cloud_deploy = false`). |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Tolgee. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et les
> combinaisons* au moment de la planification — un `redis_port`/`backup_retention_days` hors
> de portée, IAP sans identités autorisées, un runtime `gen1` avec des montages
> NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, une
> mémoire ResourceQuota sans suffixe d'unité binaire. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt
> qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `TOLGEE_AUTHENTICATION_JWT_SECRET` (auto-généré) | Ne faire pivoter que pendant une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate pour tout le monde. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy est requis pour la connexion JDBC TCP de Tolgee ; le désactiver supprime le point de terminaison `127.0.0.1` et interrompt la connexion à la base de données. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous de ~2 GiB, la JVM Spring Boot OOM (Out Of Memory) pendant les migrations Liquibase au premier démarrage. |
| `max_instance_count` | `1` sauf si validé | Élevé | Tolgee n'a pas de couche de coordination ; plusieurs rédacteurs concurrents sur un seul volume DB/NFS peuvent entrer en conflit. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions UI rebondissent entre les pods et les utilisateurs sont déconnectés de manière inattendue. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette `0`. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `application_version` | Épinglez en production | Élevé | `latest` peut tirer une nouvelle version majeure avec des migrations incompatibles lors du redéploiement. |
| `startup_probe` (`/actuator/health`) | Gardez la large fenêtre de premier démarrage | Moyen | Une fenêtre trop étroite fait échouer le pod pendant que les migrations Liquibase sont toujours en cours sur une base de données fraîche. |
| `enable_redis` | `false` | Moyen | Redis est inutilisé ; l'activer ajoute des coûts sans avantage. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Tolgee partagée avec la variante Cloud Run est
décrite dans **[Tolgee_Common](Tolgee_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Tolgee sur GKE Autopilot](../labs/Tolgee_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Tolgee sur Google Cloud Run](Tolgee_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Tolgee Common — Configuration d'application partagée](Tolgee_Common.md) — la configuration partagée par les deux cibles de déploiement.
