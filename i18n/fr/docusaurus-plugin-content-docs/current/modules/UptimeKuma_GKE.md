---
title: "Uptime Kuma sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Uptime Kuma sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/UptimeKuma_GKE.md @ e69407af sha256:aefb19a87d99 -->

# Uptime Kuma sur GKE Autopilot {#uptime-kuma-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_GKE.png" alt="Uptime Kuma sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma est un outil auto-hébergé de surveillance de la disponibilité pour les sites web, les API, les ports TCP, les enregistrements DNS, et plus encore, avec un tableau de bord clair, des pages de statut publiques et plus de 90 canaux de notification. Ce module déploie Uptime Kuma sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Uptime Kuma v1 est inhabituel parmi les applications de ce dépôt : il stocke **tout l'état dans une base de données SQLite embarquée** sous `/app/data` — il n'y a pas de base de données externe, pas de cache Redis, et pas de secret d'application à gérer.

Ce guide se concentre sur les services cloud qu'Uptime Kuma utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Uptime Kuma sur RAD, et comment cela se compare {#what-uptime-kuma-costs-on-rad-and-how-that-compares}

**L'exécution d'Uptime Kuma sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 53,72 US$/mois en frais Google Cloud** (environ 126,72 US$ si ce n'est pas votre seul cluster Autopilot), en plus d'un frais de module RAD unique de 75 crédits (7,50 US$) — plus élevé que les frais du module Cloud Run car cette variante n'exécute pas de volume NFS partagé en plus du pod GKE lui-même. GKE Autopilot convient à Uptime Kuma qui doit fonctionner à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, consultez plutôt le [guide Cloud Run](UptimeKuma_CloudRun.md). Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 53,72 US$/mois, facturé par Google au prix catalogue | ~69 crédits/jour (environ 2070/mois, 207 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **53,72 US$** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Uptime Kuma n'a pas de version cloud hébergée officielle — il est distribué uniquement en tant que logiciel auto-hébergé, il n'y a donc pas de plan SaaS de fournisseur à comparer.
- Une comparaison VPS auto-gérée, dimensionnée aux valeurs par défaut d'Uptime Kuma de 1 vCPU / 0,5 GiB : un Hetzner CPX11 ou DigitalOcean 1 vCPU/2GB Droplet coûte environ 6-12 $/mois — plus votre propre temps pour les sauvegardes et les correctifs, et aucun plan de contrôle Kubernetes à exécuter.
- La majeure partie du coût de ce module est le pod GKE Autopilot et sa part des frais de gestion de cluster ; la [variante Cloud Run](UptimeKuma_CloudRun.md) exécute la même charge de travail toujours active pour moins cher.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et cela ne coûte rien pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne démantèle **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google affirme que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Uptime Kuma et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les ressources définitivement, et ramener Uptime Kuma signifie redéployer à partir de zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou environ 70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Uptime Kuma restait inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 4 jours ou plus dans votre propre projet (environ 1,79 US$ par jour), ou environ 1 jour ou plus dans un projet géré par RAD (69 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est mise en pause et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Uptime Kuma s'exécute comme une seule charge de travail web Node.js tirée directement de l'image officielle de Docker Hub. Le déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods personnalisés basés sur `louislam/uptime-kuma` sur le port 3001, 1 vCPU / 512 Mio par défaut |
| Base de données | Aucune (SQLite embarquée) | `database_type = "NONE"` — aucune instance Cloud SQL n'est provisionnée |
| Persistance des fichiers | Cloud Filestore (NFS) | La base de données SQLite et les téléchargements persistent sous `/app/data`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Aucun provisionné par défaut — `storage_buckets = []` |
| Secrets | Secret Manager | Aucun — Uptime Kuma n'a pas de secret d'application ; les identifiants d'administrateur résident dans sa propre base de données SQLite |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe avec une IP statique réservée ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type = "NONE"` est fixé par `UptimeKuma_Common` ; `enable_cloudsql_volume = false` et aucun job `db-init` ne s'exécute. Uptime Kuma crée son schéma SQLite au premier démarrage.
- **NFS est obligatoire pour la persistance.** `enable_nfs = true`, monté à `/app/data` (le chemin du conteneur est fixe — ne le changez pas). Sans le volume NFS, la base de données SQLite et tout l'historique des moniteurs sont éphémères et perdus lors de la recréation du pod. Alternativement, `stateful_pvc_enabled = true` (désactivé par défaut) déplace le même chemin `/app/data` sur un PVC de bloc par pod, le support plus robuste pour SQLite ; le montage NFS est alors abandonné, car un chemin ne peut pas avoir deux montages de volume.
- **Pas de Redis, pas de secrets d'application.** `UptimeKuma_Common` produit `secret_ids = {}` ; il n'y a rien à injecter depuis Secret Manager.
- **La build personnalisée corrige SQLite pour la sécurité NFS.** `container_image_source =
  "custom"` construit une image légère `FROM louislam/uptime-kuma:<application_version>` (tag par défaut `1`, la ligne stable v1/SQLite) via Cloud Build. Uptime Kuma définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans `server/database.js`, non configurable via une variable d'environnement) ; WAL repose sur le verrouillage d'octets en mémoire partagée entre le fichier DB et son sidecar `-wal`, ce que le volume `/app/data` basé sur NFS ne fournit pas de manière fiable et a produit des erreurs `SQLITE_CORRUPT` observées. La build corrige ce PRAGMA en mode `DELETE`, qui ne nécessite qu'un verrouillage de fichier entier standard que NFS gère correctement. L'image construite est ensuite mise en miroir dans Artifact Registry par défaut (`enable_image_mirroring = true`) pour éviter les limites de débit de Docker Hub.
- **`container_port = 3001`** — le port natif d'Uptime Kuma.
- **Réplica unique par défaut et requis.** `min_instance_count = 1`, `max_instance_count = 1`. SQLite est une base de données à écrivain unique ; ne pas dépasser 1 réplica partageant le même fichier de base de données monté sur NFS.
- **`tenant_id` reçoit un suffixe `-gke`** lorsque la variante appelle `UptimeKuma_Common`, de sorte qu'une variante CloudRun et GKE sur le même `tenant_id` ne se heurtent pas sur la dénomination commune.
- **La configuration initiale est entièrement intégrée à l'application.** Il n'y a pas de compte administrateur par défaut — Uptime Kuma vous invite à en créer un lors du premier accès.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Uptime Kuma {#a-gke-autopilot--the-uptime-kuma-workload}

Les pods Uptime Kuma sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. La charge de travail se déploie en tant que `Deployment` (`workload_type` par défaut à `Deployment` ; un `StatefulSet` fonctionne également avec le volume NFS si sélectionné).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Uptime Kuma pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud Filestore (NFS) — la seule couche de persistance {#b-cloud-filestore-nfs--the-only-persistence-layer}

Puisqu'Uptime Kuma n'a pas de base de données externe, **tout l'état durable** — moniteurs, historique des vérifications, configuration des notifications, pages de statut et compte administrateur — réside dans un seul fichier SQLite sur le volume NFS monté à `/app/data`. Cela fait du montage NFS la ressource la plus importante à protéger pour ce module : le perdre, c'est tout perdre.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, la découverte et le modèle de VM NFS partagé vs. intégré.

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket GCS n'est provisionné pour Uptime Kuma par défaut (`storage_buckets = []` dans `UptimeKuma_Common`) ; toute la persistance est sur NFS. Définissez `create_cloud_storage`/`storage_buckets` explicitement si vous avez besoin d'un bucket pour les sauvegardes exportées ou l'automatisation.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### D. Secret Manager {#d-secret-manager}

Uptime Kuma ne nécessite **aucun secret d'application** — `secret_ids = {}`. La sortie du mot de passe de la base de données fournie par la Fondation est inutilisée (il n'y a pas d'instance Cloud SQL). Seuls les secrets de niveau Fondation que vous ajoutez explicitement via `secret_environment_variables` apparaîtront ici.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être activé via `enable_custom_domain`/`application_domains`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques. Confirmez également que le chemin de sortie GKE permet au pod d'atteindre tous les points de terminaison externes que vous configurez Uptime Kuma pour surveiller.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard et d'erreur des pods sont acheminées vers Cloud Logging. Des tests de disponibilité Cloud Monitoring optionnels et des stratégies d'alerte sont disponibles (`uptime_check_config.enabled =
false` par défaut) — notez qu'il s'agit d'un test de disponibilité Google Cloud *sur le service Uptime Kuma lui-même*, distinct des moniteurs que vous configurez dans Uptime Kuma.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Uptime Kuma {#3-uptime-kuma-application-behaviour}

- **Pas de job d'initialisation.** `initialization_jobs` est vide par défaut — Uptime Kuma crée son schéma SQLite lui-même au premier démarrage sur le volume `/app/data` vide. Les jobs fournis par l'utilisateur sont toujours honorés s'ils sont fournis.
- **La configuration initiale est manuelle et intégrée à l'application.** Lors du premier accès à l'URL du service, Uptime Kuma affiche son assistant de configuration pour créer le compte administrateur initial — il n'y a pas d'identifiants par défaut ou auto-générés à récupérer depuis Secret Manager.
- **Chemin de santé.** Les sondes de démarrage et de vivacité par défaut sont toutes deux **HTTP** `GET /api/entry-page` sur le port `3001` — `/` est toujours un 302, que la vérification de santé de la passerelle considère comme non saine (démarrage : délai initial de 30 s, période de 10 s, seuil d'échec 30 ; vivacité : délai initial de 30 s, période de 30 s, seuil d'échec 3). La vérification de disponibilité Cloud Monitoring facultative cible également `GET /`.
- **SQLite à écrivain unique sur NFS.** L'exécution de plus d'un réplica sur le même fichier SQLite `/app/data` risque des conflits de verrouillage de base de données ou une corruption ; conservez `min_instance_count = max_instance_count = 1` à moins que le comportement de verrouillage de fichiers du serveur NFS sous des écrivains SQLite concurrents n'ait été vérifié séparément.
- **Inspecter la configuration en cours d'exécution et le volume de données :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i uptime
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Uptime Kuma sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 2 — Identité de l'application et de la base de données {#group-2--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `1` | Tag d'image `louislam/uptime-kuma` ; `"1"` est la ligne stable v1 (SQLite embarqué). |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une image personnalisée légère via Cloud Build qui corrige le `journal_mode` codé en dur de SQLite de `WAL` à `DELETE` pour la sécurité NFS (voir Vue d'ensemble). Conserver `custom`. |
| `container_port` | `3001` | Port natif d'Uptime Kuma. |
| `enable_cloudsql_volume` | `false` | Inutilisé — Uptime Kuma n'a pas de base de données externe. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Maintenir les deux à `1` — écrivain SQLite unique. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Limites CPU/mémoire par pod. |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour le tableau de bord Uptime Kuma. |
| `workload_type` | `null` → `Deployment` | Déploiement ; `StatefulSet` fonctionne également avec le volume NFS si explicitement sélectionné. |
| `session_affinity` | (Par défaut de la Fondation) | Pas de remplacement spécifique à l'application ; Uptime Kuma n'a pas d'état de serveur par session au-delà de la base de données SQLite. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/api/entry-page" }` (HTTP, port 3001) | Sonde de démarrage. |
| `health_check_config` | `{ enabled=true, path="/api/entry-page" }` (HTTP, port 3001) | Sonde de vivacité. Doit retourner un 200 littéral — elle est mise en miroir dans la vérification de santé de la passerelle. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring sur le service lui-même (pas un moniteur Uptime Kuma). |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Requis.** Le seul mécanisme de persistance pour la base de données SQLite embarquée. |
| `nfs_mount_path` | `/app/data` | Fixé par la disposition de stockage de l'application — ne pas modifier. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `"NONE"` | Fixé par `UptimeKuma_Common`. Aucune instance Cloud SQL n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à la phase. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Uptime Kuma. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Présent pour la parité de sortie avec d'autres modules ; **non significatif pour Uptime Kuma** — aucune instance Cloud SQL n'est provisionnée (`database_type = "NONE"`). |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs d'initialisation créés (vides par défaut) et job d'importation facultatif. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Le désactiver supprime la seule couche de persistance — la base de données SQLite embarquée (tous les moniteurs, l'historique et le compte administrateur) est éphémère et perdue à chaque recréation de pod. |
| `nfs_mount_path` | `/app/data` | Critique | Le modifier éloigne le chemin de données codé en dur d'Uptime Kuma du volume persistant ; l'application écrit SQLite vers un chemin qui n'est pas réellement le partage NFS monté. |
| `max_instance_count` | `1` | Élevé | SQLite est à écrivain unique ; l'exécution de plus d'un réplica sur le même fichier de base de données monté sur NFS risque des conflits de verrouillage ou une corruption. |
| `database_type` | `"NONE"` | Faible | Uptime Kuma l'ignore — il ne se connecte jamais à Cloud SQL — mais le modifier provisionnera tout de même une instance Cloud SQL inutilisée et facturée via la Fondation. |
| `container_port` | `3001` | Élevé | Uptime Kuma écoute sur le port 3001 ; pointer le Service/les sondes vers un autre port rend la charge de travail inaccessible et les sondes échouent. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS, les favoris et tout intégration de page de statut externe. |
| Configuration admin initiale | Terminer immédiatement après le déploiement | Moyen | L'assistant de configuration est accessible à quiconque trouve l'URL avant la création d'un compte admin — ne laissez pas une instance fraîchement déployée avec une IP publique non configurée pendant longtemps. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | S'applique aux sauvegardes gérées par la Fondation ; puisque l'état réel d'Uptime Kuma est le fichier SQLite hébergé sur NFS, vérifiez la couverture de sauvegarde NFS/Filestore séparément plutôt que de vous fier uniquement à ce paramètre. |
| `container_image_source` | `custom` (par défaut) | Critique | Définir `"prebuilt"` ignore l'étape Cloud Build et déploie l'image amont non patchée — Uptime Kuma écrit alors SQLite en mode WAL sur NFS, ce qui a produit une corruption de base de données `SQLITE_CORRUPT` observée. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Uptime Kuma partagée avec la variante Cloud Run est décrite dans **[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Uptime Kuma sur GKE Autopilot](../labs/UptimeKuma_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Uptime Kuma Common — Configuration d'application partagée](UptimeKuma_Common.md) — la configuration partagée par les deux cibles de déploiement.
