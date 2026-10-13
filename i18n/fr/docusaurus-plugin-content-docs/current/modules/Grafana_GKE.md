---
title: "Grafana sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Grafana sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Grafana_GKE.md @ e69407af sha256:a14f46a60fa5 -->

# Grafana sur GKE Autopilot {#grafana-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grafana_GKE.png" alt="Grafana sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana est la première plateforme open source d'observabilité et d'analyse au
monde, utilisée par plus de 10 millions d'utilisateurs dans des organisations
telles que la NASA, le CERN et Goldman Sachs. Elle fournit des tableaux de bord
unifiés, des alertes et des visualisations pour les métriques, les logs et les
traces provenant de plus de 100 sources de données. Ce module déploie Grafana
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Grafana et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Grafana sur RAD, et comment cela se compare {#what-grafana-costs-on-rad-and-how-that-compares}

**L'exécution d'un pod Grafana sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 96,70 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une seule fois au moment du déploiement. Grafana est inhabituel dans cette liste car il dispose de son propre SaaS hébergé officiel, géré par Grafana Labs, ce qui permet une comparaison directe plutôt qu'une comparaison générique. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Grafana_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 96,70 $/mois, facturé par Google au prix catalogue | ~91 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 GiB | 39,68 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **96,70 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- **Le niveau gratuit de Grafana Cloud est de 0 $/mois** (limité en utilisation, rétention de 14 jours), et son niveau payant le plus bas, **Pro, commence à 19 $/mois en tant que frais de plateforme** plus des frais basés sur l'utilisation (par exemple, les métriques facturées à partir de 6,50 $ par 1 000 séries au-delà de l'allocation incluse) — vérifié sur la page de tarification de Grafana, le 8 octobre 2026.
- Le coût d'exécution de RAD dans son propre projet ici est celui des tableaux de bord plus une base de données Postgres dédiée pour l'état propre de Grafana, que les niveaux hébergés de Grafana Cloud intègrent dans leur tarification d'utilisation au lieu de facturer comme une instance Cloud SQL distincte.
- Une alternative VPS auto-gérée, dimensionnée à ce module : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go est le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est environ 49 $/mois — moins cher que le niveau Pro de Grafana Cloud ou la pile gérée de RAD en prix affiché, mais sans sauvegardes ni correctifs gérés inclus.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, une VM ou la ressource de calcul un par un : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une
chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Grafana et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
extérieur au projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et le retour de Grafana signifie un redéploiement à partir de
zéro. Cela coûte environ 78-81 crédits (les frais de module de 75 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Grafana reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Grafana, c'est environ 3 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [https://grafana.com/pricing/](https://grafana.com/pricing/) pour les chiffres de Grafana Cloud cités ci-dessus, vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Grafana s'exécute comme une charge de travail web Go. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 1 vCPU / 2 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Grafana nécessite une base de données relationnelle ; SQLite est dangereux pour les déploiements multi-pods |
| Stockage d'objets | Cloud Storage | Un bucket `grafana-data` provisionné automatiquement |
| Stockage partagé optionnel | Filestore (NFS) | Désactivé par défaut ; activer pour partager des tableaux de bord ou des plugins entre les réplicas |
| Cache optionnel | Redis | Désactivé par défaut ; peut être activé pour le stockage de session |
| Secrets | Secret Manager | Mot de passe de la base de données géré par le socle ; identifiants d'administration injectés via une variable d'environnement |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, nom de domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Grafana persiste les tableaux de bord, les
  utilisateurs, les alertes et l'état des plugins dans une base de données
  relationnelle. SQLite utilise un verrouillage de fichiers qui ne fonctionne
  pas avec des écritures multi-pods concurrentes ; le module force PostgreSQL.
- **`GF_DATABASE_TYPE=postgres` est injecté automatiquement.** Sans cela, Grafana
  revient à SQLite même lorsque toutes les autres variables `GF_DATABASE_*` sont
  présentes.
- **Aucun job d'initialisation de base de données n'est nécessaire.** Grafana
  migre automatiquement son schéma au premier démarrage, donc aucun job
  Kubernetes `db-init` n'est requis.
- **`stateful_fs_group = 472`.** Grafana s'exécute en tant que UID/GID 472 ; cela
  garantit que le conteneur peut écrire sur les montages PVC de StatefulSet
  sans erreurs de permission.
- **NFS est désactivé par défaut.** Activez-le lorsque plusieurs réplicas
  doivent partager des plugins Grafana ou des tableaux de bord personnalisés sur
  un système de fichiers partagé.
- **Redis est désactivé par défaut.** Grafana ne nécessite pas Redis pour sa
  fonctionnalité principale ; activez-le uniquement lorsque la cohérence du
  stockage de session sur de nombreux réplicas est requise.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Grafana {#a-gke-autopilot--the-grafana-workload}

Les pods Grafana sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Grafana pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Grafana stocke toutes les données d'application (tableaux de bord, utilisateurs, organisations, règles d'alerte,
état des plugins) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune
adresse IP publique n'est exposée. Grafana migre automatiquement son schéma au démarrage — aucun
job d'initialisation séparé n'est requis.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `grafana-data` dédié est provisionné automatiquement par
Grafana_Common. Le compte de service de la charge de travail se voit accorder l'accès. Des buckets GCS
supplémentaires peuvent être déclarés via `storage_buckets`, et des volumes GCS Fuse peuvent être montés
dans les pods via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<grafana-data-bucket>/    # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options GCS Fuse, CMEK et les politiques de cycle de vie.

### D. Filestore (NFS) — optionnel {#d-filestore-nfs--optional}

Lorsque `enable_nfs = true`, un partage NFS **Filestore** est provisionné et monté dans
les pods. Ceci est utile lorsque plusieurs réplicas doivent partager des plugins Grafana ou des
modèles de tableau de bord personnalisés sur un système de fichiers partagé. NFS est désactivé par défaut car
l'état persistant de Grafana réside dans PostgreSQL, et non sur le système de fichiers local.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager et injecté dans les pods au
moment de l'exécution. Le mot de passe administrateur de Grafana n'est pas généré automatiquement par ce module — il doit être
injecté via `secret_environment_variables` (voir §3 ci-dessous).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

La charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. `enable_custom_domain`
par défaut à `true`, provisionnant un Ingress Kubernetes avec un certificat géré par Google pour
les noms d'hôte dans `application_domains` ; une adresse IP statique est réservée par défaut afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Grafana expose `/api/health` comme point de terminaison de santé, ciblé par les sondes de démarrage et de vivacité, et éventuellement par un contrôle de disponibilité Cloud Monitoring.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Grafana {#3-grafana-application-behaviour}

- **Migration de schéma au démarrage.** Grafana se connecte à PostgreSQL et applique toutes les
  migrations de schéma en attente au premier démarrage. Aucun job d'initialisation de base de données séparé
  n'est nécessaire. La sonde de démarrage permet une tolérance totale d'environ 150 secondes pour les migrations au premier démarrage
  (`initial_delay_seconds=30`, `failure_threshold=12`, `period_seconds=10`).
- **Identifiant administrateur.** Grafana est livré avec des identifiants par défaut `admin`/`admin`. Le
  module NE génère PAS automatiquement ni ne fait tourner le mot de passe administrateur. Vous devez injecter un
  mot de passe fort via `secret_environment_variables` :
  ```bash
  # Create a secret for the admin password:
  gcloud secrets create grafana-admin-password \
    --replication-policy="automatic" --project "$PROJECT"
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  # Then set in your deployment config:
  # secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }
  ```
  Récupérez le mot de passe actuel :
  ```bash
  gcloud secrets versions access latest --secret=grafana-admin-password --project "$PROJECT"
  ```
- **`GF_DATABASE_TYPE` est injecté automatiquement.** Le module force
  `GF_DATABASE_TYPE=postgres` dans l'environnement. Ne le remplacez pas dans
  `environment_variables`.
- **PVC StatefulSet.** Lorsque `stateful_pvc_enabled = true`, chaque pod obtient un
  PVC dédié monté à `/var/lib/grafana`. `stateful_fs_group = 472` garantit
  que Grafana (UID/GID 472) peut écrire sur ce chemin. Inspectez l'état du PVC :
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  ```
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, qui
  renvoie HTTP 200 lorsque Grafana et sa connexion à la base de données sont sains.
- **Aucun job planifié requis.** Contrairement aux applications axées sur les campagnes, Grafana n'a
  pas de CronJobs obligatoires. Des jobs cron optionnels (par exemple, exportation de snapshots, nettoyage) peuvent être
  ajoutés via `cron_jobs`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Grafana sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grafana` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Grafana Dashboards` | Nom convivial affiché dans la console. |
| `application_description` | `Grafana observability platform on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `11.4.0` | Tag de version de l'image Grafana ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="2Gi" }` | Limites de CPU/mémoire et requêtes optionnelles pour le conteneur Grafana. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour éviter les démarrages à froid pour l'évaluation des alertes. |
| `max_instance_count` | `5` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `3000` | Grafana écoute sur le port 3000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Grafana dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GF_*` supplémentaires non secrets. `GF_DATABASE_TYPE=postgres` est injecté automatiquement — ne pas remplacer. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utiliser pour injecter `GF_SECURITY_ADMIN_PASSWORD`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le Service est exposé. |
| `session_affinity` | `None` | Round-robin par défaut — Grafana est sans état avec PostgreSQL. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS si NFS est activé. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC pour la persistance des données locales. La définition de `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/var/lib/grafana` | Répertoire de données par défaut de Grafana — monter les PVC ici. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_fs_group` | `472` | `fsGroup` au niveau du pod — doit être `472` pour que Grafana (UID/GID 472) puisse écrire sur les montages PVC. |
| `stateful_headless_service` | `null` | Créer un Service sans tête pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones pour une haute disponibilité. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/health`, 15s de délai, 12 échecs | Sonde HTTP vers le point de terminaison de santé de Grafana. |
| `health_check_config` | `/api/health`, 30s de délai, 3 échecs | Sonde de vivacité Kubernetes. |
| `uptime_check_config` | désactivé | Contrôle de disponibilité Cloud Monitoring optionnel ciblant `/api/health`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide — Grafana migre automatiquement son schéma au démarrage. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés optionnels (par exemple, exportation de snapshots). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés à côté de Grafana. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume Filestore partagé — activer lorsque plusieurs réplicas doivent partager des plugins ou des modèles de tableau de bord. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner (le bucket `grafana-data` est toujours créé par Grafana_Common). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage de session. Désactivé par défaut — non requis pour la fonction principale de Grafana. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'adresse IP du serveur NFS lorsque NFS est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier ; PostgreSQL est requis. |
| `application_database_name` | `grafana` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `grafana` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Activer l'installation des extensions PostgreSQL. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par exemple `['pg_trgm']`). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Grafana. Fortement recommandé pour les déploiements internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés avec accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Grafana. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `grafana-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `GF_SECURITY_ADMIN_PASSWORD` (via `secret_environment_variables`) | secret fort | Critique | Grafana est livré avec des identifiants par défaut `admin`/`admin`. Ne pas définir un mot de passe fort expose l'interface d'administration. |
| `GF_AUTH_ANONYMOUS_ENABLED` (via `environment_variables`) | `false` (par défaut) | Critique | Le fait de le définir sur `"true"` expose tous les tableaux de bord sans authentification. |
| `database_type` | `POSTGRES_15` | Critique | PostgreSQL est requis ; le remplacement par SQLite entraîne une perte de données à chaque redémarrage de pod. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `GF_SERVER_ROOT_URL` (via `environment_variables`) | URL publique | Élevé | Sans cela, les redirections OAuth, les liens e-mail et les iframes pointent vers la mauvaise origine. |
| `enable_iap` | `true` pour interne | Élevé | Sans IAP, la page de connexion Grafana est publiquement accessible depuis Internet. |
| `stateful_fs_group` | `472` | Élevé | Toute autre valeur empêche Grafana d'écrire sur les montages PVC, ce qui entraîne des échecs de démarrage. |
| `memory_limit` (dans `container_resources`) | `2Gi` | Élevé | En dessous de 512 Mo, Grafana OOM sur le démarrage avec de grands ensembles de tableaux de bord. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro provoque des lacunes dans l'évaluation des alertes pendant les démarrages à froid. |
| `max_instance_count` | `1`–`3` | Moyen | Plusieurs réplicas partagent PostgreSQL mais pas l'état d'alerte en mémoire — les alertes peuvent se déclencher en double. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `enable_redis` | `false` (par défaut) | Faible | L'activation sans un `redis_host` valide déclenche une erreur de validation au moment de la planification. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Grafana partagée avec la
variante Cloud Run est décrite dans **[Grafana_Common](Grafana_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Grafana sur GKE Autopilot](../labs/Grafana_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Grafana sur Google Cloud Run](Grafana_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grafana Common — Configuration d'application partagée](Grafana_Common.md) — la configuration partagée par les deux cibles de déploiement.
