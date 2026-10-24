---
title: "Jellystat sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Jellystat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Jellystat_GKE.md @ e69407af sha256:b3752add2ae3 -->

# Jellystat sur GKE Autopilot {#jellystat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellystat_GKE.png" alt="Jellystat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Jellystat](https://github.com/CyferShepard/Jellystat) est un tableau de bord
open source de statistiques et d'analyse pour les serveurs multimédias
[Jellyfin](https://jellyfin.org/), qui suit l'historique de lecture, les
sessions actives, l'activité des utilisateurs, la croissance de la bibliothèque
et les tendances de visionnage. Ce module déploie Jellystat sur **GKE
Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Jellystat et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte Jellystat sur RAD, et comment cela se compare {#what-jellystat-costs-on-rad-and-how-that-compares}

**Jellystat sur le module GKE de RAD coûte environ 93 $ US par mois dans votre propre projet, plus des frais de module de 40 crédits (4 $ US) une fois par déploiement.** Si vous n'en avez besoin que lorsque vous ajustez activement votre serveur multimédia, consultez la section "Mettre en pause gratuitement" ci-dessous pour arrêter de payer sans perdre cet historique. Jellystat est également disponible en tant que module Cloud Run, qui est l'option la moins chère ici (environ 68 $ US/mois) — consultez le guide Cloud Run, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **93,10 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **91 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 93,10 $ US** |

### Comment cela se compare {#how-it-compares}

- Jellystat est un tableau de bord d'analyse complémentaire pour un serveur Jellyfin que vous exécutez déjà, et non un produit avec son propre plan hébergé, il n'y a donc rien à comparer directement.
- Son empreinte est légère (1 vCPU, 0,5 à 1 GiB), donc un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (environ 24 $/mois) est plus que suffisant à lui seul — la majeure partie du coût de ce module est en fait la base de données PostgreSQL dont il a besoin pour conserver l'historique de lecture, qu'un VPS nu vous obligerait également à exécuter et à sauvegarder vous-même.
- Parce que Jellystat est généralement déployé aux côtés de Jellyfin dans le même projet, la base de données ici peut être le seul coût réellement nouveau de son ajout — il vaut la peine de vérifier si votre déploiement Jellyfin a déjà une base de données vers laquelle vous pourriez pointer cela au lieu d'en provisionner une seconde.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Jellystat s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou simplement ne sachant pas encore si vous en aurez besoin le mois prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression de Jellystat en tant que module unique, cela ne supprime pas le service Cloud Run/GKE, la base de données Cloud SQL et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de sa base de données par Jellystat est conservée dans ce bucket ; pour une installation par défaut, c'est la seule copie de vos données d'historique de visionnage qui vaille la peine d'être conservée.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli consiste à supprimer Jellystat purement et simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Jellystat devait rester inutilisé pendant environ 2 jours ou plus dans votre propre projet (moins d'un jour dans un projet géré par RAD). La base de données PostgreSQL et les frais de gestion du cluster GKE représentent la majeure partie du coût d'exécution ici, donc la suppression de Jellystat seul n'économise que sa propre part si la base de données ou le cluster est partagé avec d'autres applications.
- **Conserver les données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Jellystat s'exécute comme un seul déploiement Node.js/Express (avec un frontend
React intégré), précédé d'un service Kubernetes. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 GiB par défaut, autoscalé horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — noms de variables d'environnement non standard `POSTGRES_*` |
| Stockage d'objets | Cloud Storage | Un petit bucket optionnel `backups` pour les archives d'exportation de base de données |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut, domaine personnalisé optionnel |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée.
- **Noms de variables d'environnement de base de données non standard.**
  Jellystat lit `POSTGRES_IP`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, et
  `POSTGRES_DATABASE` — pas les noms génériques de la plateforme `DB_*`, et
  spécifiquement pas `POSTGRES_DB`. Les deux ensembles sont injectés côte à côte.
  Sur GKE, les noms standard sont résolus via la boucle de rappel `127.0.0.1`
  du sidecar cloud-sql-proxy (`enable_cloudsql_volume = true`).
- **`container_port = 3000` est fixe.** Le serveur de Jellystat code en dur ce port ; il n'est
  pas configurable via une variable d'environnement.
- **`service_type = "LoadBalancer"` par défaut.** Jellystat est un tableau de bord accessible via un
  navigateur.
- **`reserve_static_ip = false` par défaut.** Jellystat n'a pas d'URL auto-référente intégrée à sa
  configuration de démarrage, donc une IP réservée est inutile — cela permet
  également de conserver le quota limité d'IP statiques du projet.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager.
- **Pas de support Redis.** Jellystat n'a pas d'intégration Redis native.
- **Aucune variable d'environnement ne couple Jellystat avec un serveur
  Jellyfin.** La connexion Jellyfin (URL du serveur + clé API) est entièrement
  saisie via l'interface utilisateur web de Jellystat après le premier
  démarrage — voir §3 ci-dessous.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Jellystat {#a-gke-autopilot--the-jellystat-workload}

Le pod de Jellystat est planifié sur Autopilot, qui facture le CPU/la mémoire
que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Jellystat pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la mise à l'échelle d'Autopilot et le cycle de
vie de la charge de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Jellystat stocke toutes les données de lecture/analyse dans une instance Cloud
SQL pour PostgreSQL 15 gérée, accessible via le sidecar cloud-sql-proxy sur
`127.0.0.1`. Lors du premier déploiement, un Job d'initialisation crée la base de
données et l'utilisateur de l'application ; Jellystat applique ensuite ses
propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un petit bucket **Cloud Storage** optionnel (`backups`) est provisionné pour la
fonctionnalité d'archivage d'exportation/sauvegarde de base de données de
Jellystat.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement : `JWT_SECRET`, utilisé pour
signer les jetons de session/authentification de Jellystat. Le mot de passe de
la base de données est géré séparément par le socle.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service Kubernetes utilise par défaut `LoadBalancer`, donnant directement à Jellystat
une IP externe. Un domaine personnalisé via Gateway HTTPRoute, Cloud Armor et
Cloud CDN peut être ajouté en couche.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Jellystat {#3-jellystat-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`, créant le rôle et la
  base de données de l'application. Le job peut être réexécuté en toute
  sécurité.
- **Migrations de base de données au démarrage.** Jellystat applique
  automatiquement ses propres migrations de schéma à chaque démarrage.
- **`JWT_SECRET` est généré une fois et stocké dans Secret Manager.** Sa rotation
  invalide toutes les sessions actives mais ne cause aucune perte de données.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `GET /auth/isConfigured` — un point de terminaison public et non authentifié.
- **Le couplage manuel de Jellyfin est requis après le premier démarrage — cela
  ne peut pas être automatisé par Terraform.** Jellystat n'a pas de variable
  d'environnement pour l'URL ou la clé API du serveur Jellyfin compagnon ; le
  couplage est entièrement piloté par l'interface utilisateur :
  1. Ouvrez l'URL Jellystat déployée (l'IP externe du service, ou votre
     domaine personnalisé) et créez le premier compte administrateur.
  2. Dans le tableau de bord de votre serveur Jellyfin → Clés API, générez une
     nouvelle clé API pour Jellystat.
  3. Dans les paramètres de Jellystat, entrez l'URL de votre serveur Jellyfin
     et collez cette clé API.
  Si vous n'avez pas encore de serveur Jellyfin déployé, déployez-en un
  d'abord avec le module frère **Jellyfin_GKE** (ou
  **Jellyfin_CloudRun**).
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Jellystat sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `jellystat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image du conteneur. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `cyfershepard/jellystat`. |
| `container_port` | `3000` | Fixe — correspond au port interne codé en dur de Jellystat. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Ressources du conteneur. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Limites d'autoscaling des réplicas. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (connexion en boucle). |

### Groupe 6 — Réseau et service Kubernetes {#group-6--networking--kubernetes-service}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Jellystat a une interface utilisateur — accessible de l'extérieur par défaut. |
| `service_port` | `80` | Port du service Kubernetes auquel les clients se connectent. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé — Jellystat n'a pas besoin de stockage de fichiers partagés. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le petit bucket `backups`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` (résolu en `POSTGRES_15` par `Jellystat_Common`) | Moteur fixe. |
| `application_database_name` | `jellystat_db` | Injecté à la fois comme `DB_NAME` et `POSTGRES_DATABASE`. Immuable après le premier déploiement. |
| `application_database_user` | `jellystat_user` | Injecté à la fois comme `DB_USER` et `POSTGRES_USER`. |

### Groupe 15 — Redis (non consommé) {#group-15--redis-not-consumed}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | désactivé / vide | **Non consommé.** Jellystat n'a pas d'intégration Redis native. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `false` | Jellystat n'a pas d'URL auto-référente — conserve le quota d'IP statiques du projet. |

Toutes les autres entrées sont héritées de [App_GKE.md](App_GKE.md) avec un
comportement standard.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP du service Kubernetes. |
| `service_external_ip` | IP du LoadBalancer externe. |
| `service_url` | URL du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` | Hôte de la base de données (`127.0.0.1` via le sidecar Cloud SQL Auth Proxy). |
| `storage_buckets` | Buckets de stockage créés (`backups`). |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `kubernetes_ready` | Indique si la connexion au fournisseur Kubernetes a réussi. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `JWT_SECRET` (généré automatiquement) | Ne faire tourner que délibérément | Moyen | Sa rotation invalide toutes les sessions actives mais ne cause aucune perte de données. |
| `container_port` | `3000` (informatif) | Faible | Le serveur de Jellystat code en dur le port 3000 quelle que soit la valeur de cette variable. |
| Couplage URL/clé API Jellyfin | Manuel, post-déploiement | Élevé | Il n'y a pas de variable d'environnement pour cela — ignorer l'étape manuelle de l'interface utilisateur fait que Jellystat n'affiche aucune donnée même si le déploiement est sain. |
| `service_type` | `LoadBalancer` | Moyen | La surcharge à `ClusterIP` rend l'interface utilisateur du navigateur inaccessible sans un chemin d'entrée séparé. |
| Chemin `startup_probe_config`/`health_check_config` | `/auth/isConfigured` | Élevé | Pointer les sondes vers un point de terminaison authentifié provoque des 401/403 et le pod ne devient jamais Prêt. |
| `enable_redis` | laisser `false` | Faible | Jellystat n'a pas d'intégration Redis ; la définition de `true` n'a aucun effet. |

---

Pour le comportement du socle référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Jellystat partagée avec la variante
Cloud Run est décrite dans **[Jellystat_Common](Jellystat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellystat sur GKE Autopilot](../labs/Jellystat_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Jellystat sur Google Cloud Run](Jellystat_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellystat Common — Configuration d'application partagée](Jellystat_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md), [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Media Server**.
