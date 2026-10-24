---
title: "OpenProject sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'OpenProject sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenProject_GKE.md @ 1665a43e sha256:d32a0f78f11b -->

# OpenProject sur GKE Autopilot {#openproject-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_GKE.png" alt="OpenProject sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject est une suite open-source de gestion de projet et de collaboration
d'équipe sous licence GPLv3 — paquets de travail, diagrammes de Gantt, tableaux
agiles, wikis, suivi du temps et budgets. Ce module déploie OpenProject sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'OpenProject utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte OpenProject sur RAD, et comment cela se compare {#what-openproject-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, le module OpenProject sur GKE Autopilot de RAD coûte environ 150 $ US par mois sans licence par utilisateur.** GKE convient aux projets OpenProject qui doivent rester opérationnels, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes. Pour le coût le plus bas, le [module Cloud Run](OpenProject_CloudRun.md) exécute le même OpenProject pour environ 181 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ces 150 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 crédits par mois (environ 333 $ US au prix de la recharge, 266 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 150 $ US**, ou environ 223 $ US sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, il ne s'applique donc que si c'est votre seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1 (Johannesburg) ; le pod et la VM y coûtent environ 10 % de plus.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod OpenProject est toujours en cours d'exécution, de sorte que le coût ci-dessus est le même, que quelqu'un l'utilise ou non ; des pods supplémentaires ne sont ajoutés qu'en cas de charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- **L'édition Cloud hébergée d'OpenProject n'a pas de prix clair pour dix utilisateurs.** Chaque plan payant (à partir de 5,95 €/utilisateur/mois) exige un minimum de 25 utilisateurs (openproject.org/pricing, 8 octobre 2026) ; le seul plan qui convient réellement à une équipe de dix personnes est le plan communautaire gratuit — la même édition que RAD déploie.
- Un VPS nu dimensionné près de l'empreinte 2 vCPU / 4 GiB d'OpenProject — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois — est moins cher en espèces que l'un ou l'autre des chiffres RAD ci-dessus.
- La différence est le temps d'administration : les sauvegardes Cloud SQL et la récupération à un point dans le temps, Secret Manager et la surveillance Google Cloud sont inclus sur RAD. Sur un VPS nu, PostgreSQL, les sauvegardes, les correctifs et les mises à niveau sont votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenProject s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, un environnement de démonstration, une activité saisonnière — que l'exécution continue d'OpenProject.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, aucune VM ou le cluster GKE un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les 180 crédits (18 $ US) que coûte un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 150 $ US.** Déployez OpenProject, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds et le temps pendant lequel OpenProject a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que RAD gère uniquement pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes d'OpenProject sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à OpenProject que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne s'adapte pas à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US), car RAD recrée le projet et les services partagés avant OpenProject. La suppression permet d'économiser de l'argent seulement si OpenProject resterait inutilisé pendant environ 4 jours ou plus, à la fois dans votre propre projet (environ 4,99 $ US par jour) et dans un projet géré par RAD (111 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'OpenProject alors que quelque chose d'autre partage le projet n'économise que la partie calcul d'OpenProject.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; [Tarification OpenProject](https://www.openproject.org/pricing/).

---

## 1. Vue d'ensemble {#1-overview}

OpenProject s'exécute comme une charge de travail web Ruby on Rails (Puma). Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma, 2 vCPU / 4 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — OpenProject ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage des pièces jointes | Cloud Filestore (NFS) | Stockage durable des pièces jointes des paquets de travail, monté à `/opt/openproject/storage` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |
| Tâches de fond | good_job (en-processus, sur PostgreSQL) | Pas de Redis — la file d'attente des tâches réside dans PostgreSQL |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée ; la sélection de tout autre moteur interrompt le démarrage.
- **Sidecar Cloud SQL Auth Proxy.** `enable_cloudsql_volume = true` sur GKE. Le proxy écoute sur `127.0.0.1` et la branche de bouclage du point d'entrée compose `DATABASE_URL` sans SSL (le proxy termine TLS).
- **Pas de Redis.** Les tâches de fond s'exécutent via `good_job` avec la file d'attente dans PostgreSQL (`GOOD_JOB_EXECUTION_MODE = async`) ; `enable_redis` est transféré comme `false`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il ne doit jamais être renouvelé après le premier démarrage — le renouveler rend toutes les sessions existantes et toutes les colonnes de base de données chiffrées illisibles.
- **Les migrations s'exécutent dans un job `db-migrate`, pas au démarrage.** La charge de travail s'exécute en mode web uniquement (`./docker/prod/web`) ; un job dédié au moment de l'application exécute `rake db:migrate db:seed` en premier, de sorte que les pods démarrent rapidement avec un schéma migré.
- **Les deux sondes de santé sont TCP.** L'autorisation d'hôte Rails 8 `400` toute sonde HTTP dont l'en-tête `Host` est l'IP du pod, donc une sonde TCP (écoute de port Puma) est utilisée pour le démarrage et la vivacité. GKE prend en charge une sonde de vivacité TCP, elle reste donc activée (contrairement à Cloud Run).
- **L'affinité de session est `ClientIP`** et un minimum de 1 réplica est maintenu (GKE n'a pas de mise à l'échelle à zéro) ; un PodDisruptionBudget maintient les pods en service pendant les mises à niveau de nœuds.
- **Les déploiements basés sur NFS utilisent la stratégie `Recreate`** pour éviter que deux pods n'écrivent le même volume de pièces jointes pendant une mise à jour.
- **La première connexion est `admin` / `admin`.** OpenProject force un changement de mot de passe lors de la première connexion — faites-le immédiatement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenProject {#a-gke-autopilot--the-openproject-workload}

Les pods OpenProject sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail OpenProject pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OpenProject stocke toutes les données d'application (projets, paquets de travail, wikis, utilisateurs) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur la boucle de retour `127.0.0.1` ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données et l'utilisateur, et le job `db-migrate` exécute `rake db:migrate db:seed`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Filestore (stockage NFS des pièces jointes) {#c-cloud-filestore-nfs-attachment-storage}

Les pièces jointes des paquets de travail sont stockées sur un partage NFS **Cloud Filestore** monté à `/opt/openproject/storage` (`enable_nfs = true` par défaut) ; le module pointe OpenProject vers celui-ci en définissant `OPENPROJECT_ATTACHMENTS__STORAGE__PATH` sur `nfs_mount_path` chaque fois que NFS est activé. Cela permet de conserver les pièces jointes durables et partagées entre les pods.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `SECRET_KEY_BASE` (signature de session/cookie Rails et dérivation de clé de colonne chiffrée). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements. OpenProject construit des URL absolues à partir de `OPENPROJECT_HOST__NAME` et `OPENPROJECT_HTTPS`, où `OPENPROJECT_HTTPS` n'est **pas** codé en dur sur GKE — `main.tf` définit `https_enabled = var.enable_custom_domain`, donc ce n'est que `true` une fois qu'un domaine personnalisé + certificat géré est configuré. Sans domaine personnalisé, l'IP brute du LoadBalancer est uniquement HTTP ; forcer HTTPS dans cet état forcerait la redirection de chaque requête vers une adresse `https://` qui ne répond jamais (une panne totale et silencieuse). C'est l'opposé de `OpenProject_CloudRun`, qui passe toujours `https_enabled = true` car une URL `*.run.app` Cloud Run est toujours HTTPS.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenProject {#3-openproject-application-behaviour}

- **Configuration de la base de données en deux phases lors du premier déploiement.** Le job `db-init` (`postgres:15-alpine`) crée le rôle et la base de données ; le job `db-migrate` exécute ensuite l'image de l'application avec `rake db:migrate db:seed`. Le job de migration supprime toutes les tables partielles d'une tentative précédente interrompue (`DROP OWNED BY CURRENT_USER CASCADE`) avant de migrer, et crée l'extension `pg_trgm` nécessaire aux index trigrammes d'OpenProject.
- **Les migrations ne s'exécutent pas au démarrage.** La charge de travail s'exécute en mode web uniquement (`./docker/prod/web`), ce qui ignore le seeder tout-en-un. Rails (production) refuse de démarrer Puma tant que des migrations sont en attente, donc si `db-migrate` échoue, l'application échoue bruyamment sur le garde-fou des migrations en attente — il n'y a pas de déploiement silencieux de base de données vide.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une fois et stocké dans Secret Manager. Le modifier rend les sessions existantes et toutes les colonnes chiffrées illisibles. Ne le faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Les tâches de fond s'exécutent en interne.** `good_job` exécute son worker et son cron à l'intérieur de chaque pod (`GOOD_JOB_EXECUTION_MODE = async`) avec la file d'attente sur PostgreSQL — pas de Redis.
- **L'autorisation d'hôte gère les sondes de santé.** Rails 8 renvoie `400 Invalid host_name` à toute requête dont l'en-tête `Host` n'est pas `OPENPROJECT_HOST__NAME`, y compris les sondes de santé HTTP du kubelet (qui utilisent l'IP du pod). Les sondes de démarrage et de vivacité sont donc TCP ; la sonde de disponibilité atteint `/health_checks/default`.
- **La première connexion est `admin` / `admin`.** Amorcée par `rake db:seed`. OpenProject force un changement de mot de passe lors de la première connexion.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour OpenProject sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openproject` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenProject` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag d'image OpenProject (`OPENPROJECT_VERSION`). `latest` est épinglé à la version majeure stable `16` ; épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro). |
| `max_instance_count` | `5` | Réplicas maximum (limite supérieure HPA). |
| `container_port` | `8080` | Port de liaison par défaut de Puma ; le module exécute `./docker/prod/web` (Puma directement), contournant le proxy Apache de l'image tout-en-un sur le port 80. |
| `container_resources` | `2000m` / `4Gi` | Limites et requêtes CPU/mémoire. Rails a besoin de marge pour les migrations et les workers. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (connexion en boucle). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image OpenProject dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (remplacements `OPENPROJECT_*`). Ne pas définir `SECRET_KEY_BASE` ou `DATABASE_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (Déploiement) | `Deployment` (par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions UI. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC. Non requis — les pièces jointes utilisent NFS. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(défini)_ | Quota de mémoire de l'espace de noms — doit utiliser des unités binaires (`4Gi`, `8192Mi`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, délai de 30s, fenêtre de 30 × 15s | TCP car l'autorisation d'hôte Rails `400` les sondes HTTP ; vérifie que Puma écoute. |
| `liveness_probe` | **TCP**, délai de 90s | TCP pour qu'un Puma sain reste en vie (GKE prend en charge la vivacité TCP). |
| `startup_probe_config` | _(défini)_ | Sonde d'infrastructure de niveau App_GKE. |
| `uptime_check_config` | désactivé | Vérification de disponibilité facultative de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `db-init` + `db-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec OpenProject. |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Cloud Filestore pour le stockage durable des pièces jointes. |
| `nfs_mount_path` | `/opt/openproject/storage` | Chemin des pièces jointes OpenProject à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste si vous en avez besoin de plus. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images Artifact Registry récentes à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `openproject` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

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
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre OpenProject. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `db-migrate`) et d'importation (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, un entier brut `quota_memory_*`, un `backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend illisibles toutes les sessions existantes et toutes les colonnes de base de données chiffrées. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Le désactiver place les pièces jointes sur le stockage éphémère du pod — elles sont perdues lorsqu'un pod est replanifié. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `startup_probe.type` / `liveness_probe.type` | `TCP` | Élevé | Une sonde HTTP atteint l'autorisation d'hôte Rails (`400 Invalid host_name`, Hôte = IP du pod) et ne passe jamais — un pod sain ne devient jamais Prêt, ou un pod sain TCP redémarre en boucle. |
| `enable_cloudsql_volume` | `true` sur GKE | Élevé | Le sidecar Auth Proxy fournit la connexion PostgreSQL en boucle locale ; sa désactivation est bloquée par une garde de validation au moment de la planification. |
| `memory_limit` (via `container_resources`) | `4Gi` | Élevé | Les migrations et les workers en cours d'exécution OOM en dessous de ~2 GiB. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions de l'interface utilisateur peuvent être acheminées vers différents pods entre les requêtes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance — avec NFS `Recreate`, cela interrompt le service. |
| `application_version` | Épingler une version majeure (`16`) | Moyen | `latest` n'a pas de tag d'image sur Docker Hub ; le module l'épingle à `16`. Épinglez explicitement pour contrôler les mises à niveau. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à OpenProject partagée
avec la variante Cloud Run est décrite dans
**[OpenProject_Common](OpenProject_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : OpenProject sur GKE Autopilot](../labs/OpenProject_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenProject Common — Configuration d'application partagée](OpenProject_Common.md) — la configuration partagée par les deux cibles de déploiement.
