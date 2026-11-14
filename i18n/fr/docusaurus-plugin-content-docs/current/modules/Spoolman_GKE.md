---
title: "Spoolman sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Spoolman sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Spoolman_GKE.md @ 40c83c3f sha256:969d60406a76 -->

# Spoolman sur GKE Autopilot {#spoolman-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Spoolman_GKE.png" alt="Spoolman sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Spoolman est un outil gratuit et open source de suivi des stocks et de
l'utilisation des bobines de filament pour l'impression 3D — fournisseurs,
matériaux, poids restant, coût par bobine et consommation par impression. Il
est livré sous la forme d'un backend Python/FastAPI à processus unique avec
un frontend Vue/Quasar statique intégré. Ce module déploie Spoolman sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Spoolman et sur la
manière de les explorer et de les exploiter à partir de la Google Cloud
Console et de la ligne de commande. Pour les mécanismes communs à chaque
application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie
du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Spoolman sur RAD, et comment cela se compare {#what-spoolman-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Spoolman sur RAD coûte environ 91,31 $ US par mois dans un projet Google Cloud que vous possédez, les frais de module étant facturés une fois en crédits RAD.** GKE convient à Spoolman qui doit être placé à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Spoolman_CloudRun.md) exécute le même Spoolman pour environ 67,80 $ US par mois. Si vous n'avez besoin de Spoolman qu'occasionnellement — entre les travaux d'impression, ou pendant que vous l'essayez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites, puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **91,31 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **117 crédits par jour**, soit environ 3 510 par mois (environ 351 $ US au prix de la recharge ; estimé à partir des prix catalogue de Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre du projet propre suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore suffisamment d'historique GKE géré par RAD pour le mesurer, de sorte que la confirmation de déploiement ne le cite pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant des frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 Gio | 34,29 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **91,31 $ US** |

### Comment cela se compare {#how-it-compares}

- Spoolman n'a pas de SaaS commercial hébergé propre — il est distribué uniquement en tant que logiciel open source auto-hébergé, Docker-first, pour que les ateliers d'impression 3D puissent le gérer eux-mêmes.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — toutes ces machines sont considérablement plus puissantes que ce dont Spoolman a besoin (1 vCPU / 0,5 Gio) ; une micro-instance à vCPU partagé de 5 à 6 $/mois de l'un de ces mêmes fournisseurs l'exécuterait confortablement, plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- La majeure partie du coût d'exécution du projet propre de RAD ici est l'instance PostgreSQL gérée et les frais de gestion du cluster GKE partagé, et non le propre pod de Spoolman — la base de données serait également nécessaire sur un VPS nu, mais non gérée là-bas.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Spoolman s'exécute dans un projet que RAD gère pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, le cluster ou la ressource de calcul un par un : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), de sorte qu'une restauration ne coûte normalement aucun crédit.

Ce qu'il faut : vous devez posséder le projet (pas un projet que RAD ne gère que pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données de Spoolman et que vous souhaitez les conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Spoolman purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) — 40 crédits (4,00 $ US) dans votre propre projet, ou 36 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Spoolman reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 3,04 $ US par jour), cela représente environ 2 jours ou plus, ou environ 1 jour ou plus dans un projet géré par RAD (117 crédits par jour). La majeure partie du coût d'exécution ici est la base de données et les frais de cluster partagés ; ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Spoolman pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Aucun SaaS commercial hébergé actuellement vérifié n'existe pour Spoolman, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

Spoolman s'exécute en tant que pod Python/FastAPI unique — il n'y a pas de
charge de travail frontend séparée ; l'interface utilisateur Vue/Quasar est
intégrée et servie à partir du même processus. Le déploiement relie un
ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Image `ghcr.io/donkie/spoolman` pré-construite, 1 vCPU / 512 Mio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — ce module standardise sur Postgres (Spoolman prend également en charge MySQL/SQLite/CockroachDB en amont) |
| Stockage d'objets | Aucun | Spoolman conserve tout l'état dans Postgres ; aucun bucket GCS n'est provisionné |
| Cache | Aucun | Spoolman n'a pas d'intégration Redis/cache |
| Secrets | Secret Manager | Seul le mot de passe de la base de données auto-généré — Spoolman n'a pas de secret d'amorçage admin/clé API propre |
| Ingress | Cloud Load Balancing | External LoadBalancer par défaut |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est le seul moteur pris en charge dans ce module.** `database_type`
  est fixé par `Spoolman_Common` ; Spoolman en amont prend également en charge MySQL et
  CockroachDB via des variables d'environnement, mais ce module n'expose pas ce choix.
- **Pas de build personnalisé.** `container_image_source = "prebuilt"` déploie
  `ghcr.io/donkie/spoolman` directement — il n'y a pas de Dockerfile, pas d'étape Cloud Build.
- **Pas de job d'initialisation.** La fondation crée automatiquement le rôle et la base de données Postgres ;
  Spoolman exécute ses propres migrations Alembic automatiquement à chaque démarrage du conteneur.
- **Pas de secrets d'application.** Spoolman est livré **sans aucune authentification** —
  quiconque peut atteindre le service a un accès complet en lecture/écriture à l'inventaire.
  Il n'y a pas de portail de connexion à amorcer et rien n'est généré dans Secret Manager
  au-delà du mot de passe de la base de données. Si cela n'est pas acceptable, placez le service
  derrière IAP (`enable_iap = true`) ou une liste d'autorisation IP Cloud Armor.
- **`service_type = "LoadBalancer"` par défaut.** Spoolman est une interface utilisateur web pilotée par navigateur,
  donc le service est accessible de l'extérieur dès la sortie de la boîte.
- **`reserve_static_ip = false` par défaut.** Spoolman n'intègre pas
  d'URL auto-référencée dans la configuration au démarrage (seul `SPOOLMAN_CORS_ORIGIN`
  importe, et seulement pour l'accès inter-domaines), donc ce module conserve le
  quota d'adresses IP statiques souvent limité du projet en n'en réservant pas.
- **Les connexions utilisent la boucle locale du sidecar cloud-sql-proxy, pas TCP.**
  La couche SQLAlchemy de Spoolman construit sa connexion via `URL.create()` (un
  objet structuré, pas une concaténation de chaînes), donc `127.0.0.1` passe
  proprement sans problème d'analyse d'URL et sans configuration TLS/`sslmode` nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Spoolman {#a-gke-autopilot--the-spoolman-workload}

Spoolman s'exécute en tant que déploiement/pod unique sur Autopilot, qui facture le
CPU/la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Spoolman pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot et de la mise à l'échelle.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Spoolman stocke toutes les données d'inventaire (bobines, filaments, fournisseurs, historique d'utilisation)
dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le pod y accède en privé
via le sidecar **Cloud SQL Auth Proxy** en boucle locale ; aucune IP publique n'est
exposée. Il n'y a pas de job d'initialisation — Spoolman applique ses propres migrations de schéma
à chaque démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le mot de passe de la base de données auto-généré réside dans Secret Manager — Spoolman
n'a pas de compte administrateur ou de clé API propre à amorcer.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
  gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son adresse IP externe LoadBalancer par défaut
(`service_type = "LoadBalancer"`, `reserve_static_ip = false`, donc l'adresse IP est
éphémère sauf modification).

- **Console :** Kubernetes Engine → Services et Ingress.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, le CDN et Cloud Armor.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

---

## 3. Comportement de l'application Spoolman {#3-spoolman-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.** Contrairement à la plupart des modules d'application de ce catalogue, Spoolman n'a pas besoin de job `db-init` — la fondation crée le rôle et la base de données Postgres, et les propres migrations Alembic de Spoolman s'exécutent automatiquement à chaque démarrage du conteneur (y compris le tout premier démarrage).
- **Pas d'authentification.** Il n'y a pas de page de connexion, pas de compte administrateur et pas de clé API. Quiconque peut atteindre le service peut consulter et modifier l'intégralité de l'inventaire. Décidez de votre approche de contrôle d'accès (IAP, liste d'autorisation Cloud Armor, ou accepter la lecture/écriture publique) avant d'exposer l'adresse IP du LoadBalancer.
- **Chemin de santé.** `/api/health` est public et non authentifié, renvoyant un statut JSON 200/OK une fois que le serveur (et sa connexion DB) est opérationnel. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.
- **Moteur de base de données verrouillé sur Postgres.** La propre variable d'environnement `SPOOLMAN_DB_TYPE` de Spoolman sélectionne le moteur ; ce module la définit toujours sur `postgres`. Ne la désactivez jamais via `environment_variables` — sans elle, Spoolman revient silencieusement à un fichier SQLite local au conteneur jetable sans aucune erreur.
- **Inspecter la connectivité Cloud SQL :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i spoolman_db
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Spoolman sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `spoolman` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Spoolman` | Nom lisible par l'homme. |
| `application_version` | `latest` | Tag d'image extrait de `ghcr.io/donkie/spoolman`. Véritablement pré-construit — pas de problèmes d'épinglage Dockerfile/build-arg. |

### Groupe 4 — Conteneur et mise à l'échelle {#group-4--container--scale}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Transmis à la fondation — requis, sinon la valeur par défaut `"custom"` déclenche silencieusement une tentative de build Kaniko sans Dockerfile. |
| `container_port` | `8000` | Port d'écoute par défaut de Spoolman. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Amplement suffisant pour un suivi de filament mono-locataire. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | La mise à l'échelle à zéro est sûre — Spoolman n'a pas de travail en arrière-plan. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_host_env_var_name` | `SPOOLMAN_DB_HOST` | Alias de `DB_HOST` de la fondation (`127.0.0.1` via le sidecar cloud-sql-proxy sur GKE). |
| `db_user_env_var_name` | `SPOOLMAN_DB_USERNAME` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `SPOOLMAN_DB_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `SPOOLMAN_DB_NAME` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `SPOOLMAN_DB_PORT` | Alias de `DB_PORT`. |
| `application_database_name` / `application_database_user` | `spoolman` / `spoolman` | Immuable après le premier déploiement. |

### Groupe 14 — Stockage et système de fichiers {#group-14--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Aucun bucket GCS n'est nécessaire — tout l'état réside dans Cloud SQL. |
| `enable_nfs` | `false` | Aucun système de fichiers partagé n'est nécessaire. |

### Groupe 19 — Réseau {#group-19--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Spoolman est une interface utilisateur web pilotée par navigateur, exposée en externe par défaut. |
| `reserve_static_ip` | `false` | Conserve le quota d'adresses IP statiques du projet ; Spoolman n'intègre aucune URL auto-référencée dans la configuration au démarrage. |

### Groupe 10 — Sondes et cycle de vie {#group-10--probes--lifecycle}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health`, délai de 10s | Public, non authentifié. |
| `health_check_config` | HTTP `/api/health`, période de 30s | Public, non authentifié. |

Toutes les autres entrées (CI/CD, sauvegardes, VPC-SC, Cloud Armor, IAP, Redis, PVCs avec état) sont héritées de [App_GKE](App_GKE.md) avec un comportement standard — Spoolman n'en utilise aucune par défaut.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP interne. |
| `service_external_ip` | Adresse IP externe du LoadBalancer. |
| `service_url` | URL complète de la charge de travail déployée. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — Spoolman n'a pas besoin de bucket GCS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry (lorsque la mise en miroir est activée). |
| `monitoring_enabled` | Statut de la surveillance. |
| `initialization_jobs` | Toujours vide — Spoolman n'a pas besoin de job d'initialisation. |
| `kubernetes_ready` | Indique si la charge de travail est prête. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Pas d'authentification (intégrée) | Protéger avec IAP ou Cloud Armor si nécessaire | Critique | Quiconque peut atteindre le service peut lire et modifier l'inventaire complet des filaments — il n'y a pas de portail de connexion à désactiver. |
| `SPOOLMAN_DB_TYPE` (auto-injecté `postgres`) | Ne jamais désactiver via `environment_variables` | Critique | Le désactiver revient silencieusement à un fichier SQLite local au conteneur jetable — aucune erreur, et toutes les données sont perdues à chaque redémarrage du pod. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (ne pas remplacer par `custom`) | Critique | Définir `"custom"` déclenche une tentative de build Kaniko contre un module sans Dockerfile — le build échoue purement et simplement. |
| `service_type` | `LoadBalancer` (par défaut) | Élevé | Passer à `ClusterIP` rend le service inaccessible depuis un navigateur sans `kubectl port-forward` ou un ingress séparé. |
| `SPOOLMAN_DB_QUERY` | Laisser vide sauf en cas de dépannage | Moyen | Solution de secours pour un TCP + `sslmode` — nécessaire uniquement si le chemin de connexion en boucle locale s'avère un jour peu fiable ; non requis pour un fonctionnement normal. |
| `reserve_static_ip` | `false` (par défaut) | Faible | Définir `true` uniquement si vous avez besoin d'une adresse IP stable pour la liste d'autorisation DNS/pare-feu — le quota d'adresses IP statiques du projet est limité et partagé entre les locataires. |
| `min_instance_count` | `0` (par défaut) | Faible | Spoolman n'a pas de travail en arrière-plan, donc la mise à l'échelle à zéro est sûre. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
mise à l'échelle, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Spoolman
partagée avec la variante Cloud Run est décrite dans
**[Spoolman_Common](Spoolman_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Spoolman sur GKE Autopilot](../labs/Spoolman_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Spoolman sur Google Cloud Run](Spoolman_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Spoolman Common — Configuration d'application partagée](Spoolman_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) dans la solution **Gestion de la maison et de la vie**.
