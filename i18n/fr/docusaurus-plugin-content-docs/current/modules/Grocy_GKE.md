---
title: "Grocy sur GKE Autopilot"
description: "Référence de configuration pour déployer Grocy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Grocy_GKE.md @ 3055034 sha256:32683128d39d -->

# Grocy sur GKE Autopilot {#grocy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grocy_GKE.png" alt="Grocy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Grocy](https://grocy.info/) est un ERP domestique et de gestion des courses auto-hébergé : suivi des stocks avec lecture de codes-barres, gestion des corvées et des tâches, listes de courses et planification des repas. Il se distingue du module `Mealie` de ce catalogue, qui couvre uniquement les recettes et la planification des repas — Grocy est l'outil d'ERP domestique plus large. Ce module déploie Grocy sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée ; `Grocy_GKE` est une fine surcouche qui fournit la configuration propre à Grocy (image, port, sondes, câblage du stockage) et transmet tout le reste tel quel.

Ce guide se concentre sur les services cloud utilisés par Grocy et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée et équilibrage de charge, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Grocy s'exécute sous forme d'un conteneur nginx + php-fpm (l'image `grocy` amont de LinuxServer.io, non modifiée) sur GKE Autopilot, en tant que **StatefulSet**. Le déploiement assemble un ensemble restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot (StatefulSet) | 1 vCPU / 1 GiB par défaut, `min=max=1` (pas d'autoscaling — SQLite à écrivain unique) |
| Base de données | Aucune | Grocy utilise une base de données SQLite embarquée — aucune instance Cloud SQL n'est créée |
| État persistant | **PVC de stockage en mode bloc** (`standard-rwo`, 20Gi) | `/config` (base de données SQLite, configuration, téléversements, sauvegardes) est monté sur un véritable périphérique en mode bloc, par pod via `volumeClaimTemplates` — voir §4 |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné mais inutilisé lorsque le PVC est activé (valeur par défaut) |
| Cache | Aucun | `enable_redis` est codé en dur à `false` dans `main.tf` — Grocy n'a aucune dépendance de cache |
| Secrets | Secret Manager | Aucun n'est généré pour Grocy — il n'existe pas d'identifiant administrateur injectable |
| Entrée | Service Kubernetes | `LoadBalancer` par défaut du module ; ce déploiement utilise `ClusterIP` (voir §5) |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge par Grocy.** Confirmé par la lecture du code source amont de Grocy (`services/DatabaseService.php`) — il n'existe aucun embranchement vers un pilote MySQL/Postgres. `database_type` est fixé à `NONE`.
- **Un véritable PVC en mode bloc, ni NFS ni GCS FUSE — par conception, et non comme correctif de bug.** `stateful_pvc_enabled = true` est la valeur par défaut du module, qui résout automatiquement `workload_type` en `"StatefulSet"`. `Grocy_Common` définit `enable_gcs_storage_volume = !stateful_pvc_enabled`, si bien que le volume GCS FUSE est entièrement ignoré dès que le PVC est utilisé (l'état par défaut). Voir §4 pour comprendre pourquoi c'est important et en quoi cela se compare à la variante Cloud Run.
- **Instance unique uniquement.** `min_instance_count = 1`, `max_instance_count = 1`. La base de données SQLite de Grocy est à écrivain unique, sans prise en charge du clustering — et comme le StatefulSet utilise `volumeClaimTemplates`, augmenter le nombre de réplicas donnerait à chaque pod son propre PVC non synchronisé au lieu de partager `/config`.
- **Aucun identifiant administrateur injectable.** L'image amont est livrée avec les identifiants par défaut `admin` / `admin`, modifiés via l'interface web à la première connexion. Aucun secret Secret Manager n'est créé pour Grocy.
- **Les sondes de santé ciblent `/`, pas `/health`.** Grocy n'a pas de point de terminaison de santé dédié ; la page de connexion (`200`, sans authentification) sert à la fois pour la sonde de démarrage et pour la sonde de disponibilité (liveness).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Grocy {#a-gke-autopilot--the-grocy-statefulset}

Grocy s'exécute sous forme d'un **StatefulSet** à réplica unique (et non d'un Deployment) afin que ses `volumeClaimTemplates` puissent lier un PVC en mode bloc stable, propre à chaque pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet.
- **CLI :**
  ```bash
  kubectl get statefulset -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe statefulset <name> -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les mécanismes StatefulSet ou Deployment, la stratégie de déploiement progressif et les requêtes/limites de ressources Autopilot.

### B. Le PVC de stockage en mode bloc `/config` {#b-the-config-block-storage-pvc}

Tout l'état de Grocy — la base de données SQLite embarquée (`grocy.db`), `config.php`, les images et pièces jointes téléversées et les sauvegardes — se trouve sous `/config`, monté sur un véritable volume en mode bloc `standard-rwo` (Balanced PD) via les `volumeClaimTemplates` du StatefulSet. C'est la décision de stockage déterminante de ce module (voir §4) ; perdre ou mal configurer ce PVC fait perdre toutes les données de Grocy.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc <pvc-name> -n "$NAMESPACE"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `storage` dédié est provisionné automatiquement, mais par défaut il n'est **pas** utilisé pour adosser `/config` — ce montage passe par le PVC en mode bloc à la place (voir §4). Il reste disponible pour tout `gcs_volumes` personnalisé qu'un opérateur ajoute.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~grocy"
  ```

### D. Réseau et entrée {#d-networking--ingress}

La valeur par défaut du module est un Service `LoadBalancer` avec un domaine personnalisé facultatif via Gateway API. Le fichier `config/deploy.tfvars` de ce déploiement la remplace par `service_type = "ClusterIP"` avec `reserve_static_ip = false` (une contrainte de quota d'IP statiques par projet) — accédez-y via `kubectl port-forward` ou depuis l'intérieur du cluster.

- **Console :** Kubernetes Engine → Gateways, Services & Ingress.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  ```

Consultez [App_GKE](App_GKE.md) pour Gateway API, les IP statiques et les domaines personnalisés.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Kubernetes à Cloud Monitoring, avec en option des tests de disponibilité et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

---

## 3. Comportement de l'application Grocy {#3-grocy-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Grocy n'a ni base de données externe ni tâche `db-init` — il crée et migre son propre schéma SQLite embarqué sous `/config` au premier démarrage.
- **La durabilité de `/config` dépend du PVC, pas d'une base de données gérée.** Comme tout l'état de Grocy (base de données, configuration, téléversements, sauvegardes) réside dans des fichiers sur `/config`, la fiabilité du PVC en mode bloc *est* la fiabilité du déploiement. Vérifiez que le PVC est lié et accessible en écriture avant de vous fier aux données qui y sont écrites.
- **Aucun identifiant administrateur n'est généré ni injectable.** L'image amont est livrée avec les identifiants par défaut `admin` / `admin`. Connectez-vous avec ceux-ci au premier accès et changez immédiatement le mot de passe via Users → admin → Edit dans l'interface de Grocy — aucune variable d'environnement ni valeur Secret Manager ne le définit à votre place.
- **Chemin de santé.** Les sondes de démarrage et de disponibilité envoient toutes deux une requête HTTP `GET /`, qui renvoie la page de connexion de Grocy (`200`) sans authentification. Ce n'est pas un point de terminaison de santé dédié — Grocy n'en a pas — mais cela indique de façon fiable que la pile nginx + php-fpm répond.
- **La contrainte d'écrivain unique est architecturale, pas un réglage de mise à l'échelle.** Comme la base de données SQLite de Grocy n'a pas d'équivalent MySQL/Postgres ni de prise en charge du clustering, `max_instance_count` doit rester à `1`. Aucune configuration ne permet d'activer sans risque la mise à l'échelle horizontale pour ce module.
- **Vérifié en conditions réelles.** Le pod `grocygkee6a1e84d-0` affichait `1/1 Running`, **0 redémarrage**. Les journaux de démarrage montrent un démarrage s6-overlay/LinuxServer propre — migrations réussies, clés TLS autosignées générées sous `/config/keys` sans erreur de permission, `[ls.io-init] done.`. Un `kubectl exec ... curl` sur `GET /` a renvoyé `302` → `Location: /stockoverview` → suivi jusqu'à `GET /login` → `200`, avec un corps contenant `<title>Login | Grocy</title>` (10 102 octets) — correspondant exactement à la page de connexion vérifiée sur Cloud Run.

---

## 4. Pourquoi ce module utilise un PVC en mode bloc — une conception repartie de zéro, pas un correctif de bug {#4-why-this-module-uses-a-block-pvc--a-clean-slate-design-not-a-bug-fix}

Le câblage du stockage persistant de ce module se comprend mieux par contraste avec son module frère, `Grocy_CloudRun`.

Sur Cloud Run, Grocy montait à l'origine `/config` sur un bucket adossé à GCS FUSE — le modèle habituel de ce catalogue pour la configuration persistante des applications — et il a tourné en boucle de plantages en production. Grocy écrit dans `data/grocy.db-journal` à chaque transaction de base de données (environ toutes les 1 à 2 secondes en usage léger), et la couche de traduction vers le stockage d'objets de GCS FUSE, fondée sur une cohérence à terme et une sémantique d'objet entier, ne pouvait pas soutenir cette fréquence d'écriture. Le correctif sur Cloud Run a consisté à faire passer `/config` sur un montage Cloud Filestore (NFS) — consultez le [guide Grocy_CloudRun, §4](Grocy_CloudRun.md#4-why-config-uses-nfs-instead-of-gcs-fuse--the-real-story) pour l'histoire complète.

`Grocy_GKE` n'a jamais eu ce problème à corriger, car il a été conçu dès le départ avec une primitive de stockage différente : `stateful_pvc_enabled = true` est la valeur par défaut propre au module, qui exécute Grocy en tant que StatefulSet avec un véritable **périphérique en mode bloc** (`standard-rwo`, un Balanced Persistent Disk) monté par pod sur `/config`. Un PVC en mode bloc n'est ni un système de fichiers réseau ni une couche de traduction vers le stockage d'objets — du point de vue du conteneur, il se comporte exactement comme un disque local, avec une vraie sémantique POSIX (rename, fsync, verrous sur plages d'octets) et aucune couche FUSE entre le moteur SQLite et les octets sur le disque. Rien ici ne peut être submergé par un fichier journal écrit à haute fréquence.

`Grocy_Common` encode directement cette relation : `enable_gcs_storage_volume = !stateful_pvc_enabled` — ainsi, dès que le PVC est activé (valeur par défaut), le volume GCS FUSE à l'origine du bug sur Cloud Run n'est même jamais câblé. Cela signifie aussi que le bug **distinct**, propre à GKE, de permissions de montage UID/GID de gcsfuse rencontré ailleurs dans ce catalogue (confirmé sur des modules comme PeerTube_GKE, où un conteneur non root ne peut pas écrire sur un montage gcsfuse sans options de montage `uid`/`gid` explicites) ne s'applique pas non plus ici — il n'y a aucun montage gcsfuse à mal configurer.

`stateful_fs_group = 1000` correspond aux vrais PUID/PGID de l'image LinuxServer.io (1000/1000), si bien que le PVC en mode bloc est accessible en écriture par le groupe du processus réel du conteneur — confirmé en conditions réelles : le journal de démarrage du pod montre des clés TLS autosignées générées sous `/config/keys` sans aucune erreur de permission.

**Résultat : ce module a été déployé et vérifié sans qu'aucun bug ne soit trouvé ni corrigé.** Là où l'histoire de `Grocy_CloudRun` est « la mauvaise primitive de stockage a cassé SQLite, et voici le correctif », celle de `Grocy_GKE` est plus simple — la bonne primitive de stockage pour une charge de travail SQLite à écrivain unique a été choisie dès le départ, et rien n'a cassé.

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Grocy ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grocy` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Grocy` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image LinuxServer. `"latest"` se résout en `v4.6.0-ls333` épinglé (l'ARG de build `GROCY_VERSION`, et non l'`APP_VERSION` générique). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Grocy est léger ; la mémoire par défaut laisse de la marge pour les téléversements d'images et de pièces jointes. |
| `min_instance_count` | `1` | Maintient le pod actif — évite les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`.** La base de données SQLite de Grocy est à écrivain unique, sans prise en charge du clustering, et les `volumeClaimTemplates` d'un StatefulSet donnent à chaque réplica supplémentaire son propre PVC non synchronisé. |
| `container_port` | `80` | Port HTTP par défaut de Grocy. |
| `enable_cloudsql_volume` | `false` | Grocy n'a pas de Cloud SQL — conservez `false`. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` | Se résout automatiquement en `"StatefulSet"` car `stateful_pvc_enabled = true` par défaut. |
| `service_type` | `LoadBalancer` | Valeur par défaut du module pour une application accessible depuis un navigateur. Ce déploiement la remplace par `ClusterIP` via `config/deploy.tfvars` (contrainte de quota d'IP statiques par projet). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **La décision de conception centrale de ce module** — voir §4. Un véritable PVC de stockage en mode bloc, ni système de fichiers réseau ni GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Dimensionné pour contenir la base de données SQLite, les images et pièces jointes et les sauvegardes sous `/config`. |
| `stateful_pvc_mount_path` | `/config` | Grocy conserve tout son état (base de données, configuration, téléversements, sauvegardes) ici. Ne le modifiez pas, sauf si le chemin de données de l'image amont change. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced Persistent Disk — un véritable périphérique en mode bloc, sans couche de traduction FUSE. |
| `stateful_fs_group` | `1000` | Correspond aux vrais PUID/PGID de Grocy (1000/1000) — confirmé en conditions réelles par la génération réussie des clés TLS sous `/config/keys`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | **Non utilisé sur GKE**, contrairement à `Grocy_CloudRun` qui repose sur NFS. Le PVC en mode bloc remplit ce rôle ici. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) | **Remplacé inconditionnellement par `false` dans `main.tf`** quelle que soit la valeur de cette variable — Grocy n'a aucune dépendance de cache. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Grocy n'a aucune base de données SQL. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucune tâche d'initialisation par défaut — Grocy initialise son propre schéma SQLite au premier démarrage. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 15 s, 10 tentatives | Page de connexion de Grocy — il n'existe pas de point de terminaison de santé dédié. |
| `liveness_probe` | HTTP `/`, délai de 30 s, 3 tentatives | Même point de terminaison que la sonde de démarrage. |

Toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement standard.

---

## 6. Sorties {#6-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `namespace` / `service_cluster_ip` | Identité du Service Kubernetes. |
| `service_external_ip` / `service_url` | Adresse externe (si un `LoadBalancer` et une IP statique sont utilisés). |
| `statefulset_name` | Nom du StatefulSet qui exécute Grocy. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, inutilisé pour `/config` lorsque le PVC est activé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des tâches d'initialisation créées (vide par défaut). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources Kubernetes sont déployées. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut raisonnables {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration
> par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs
> *et leurs combinaisons* au moment du plan. La plupart des entrées hors limites ou
> contradictoires sont détectées avant la création de toute ressource.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver sans montage `gcs_volumes` correspondant ramène `/config` sur GCS FUSE, ce qui reproduit le risque de corruption lié à la fréquence d'écriture confirmé sur `Grocy_CloudRun` — une couche de traduction réseau/stockage d'objets ne peut pas soutenir le schéma d'écriture de `grocy.db-journal` de Grocy. |
| `stateful_pvc_mount_path` | `/config` | Critical | Grocy code en dur son chemin de données sur `/config`. Modifier le chemin de montage sans modification correspondante de l'image fait perdre l'accès à la base de données, à la configuration et aux téléversements. |
| `max_instance_count` | `1` | Critical | La base de données SQLite de Grocy est à écrivain unique, sans prise en charge du clustering. Comme le StatefulSet utilise `volumeClaimTemplates`, toute valeur supérieure à `1` ne partage même pas le stockage entre réplicas — chaque pod obtient sa propre copie déconnectée des données. |
| `stateful_fs_group` | `1000` | High | Grocy s'exécute en UID 1000 / GID 1000 (PUID/PGID LinuxServer). Un `fsGroup` ne correspondant pas laisse le PVC inaccessible en écriture au processus réel du conteneur, ce qui provoque des erreurs de permission au premier démarrage. |
| `enable_redis` | Toute valeur — ignorée | Low | `main.tf` code en dur `enable_redis = false` quelle que soit cette variable ; la définir à `true` n'a donc aucun effet. Ce n'est pas un risque, simplement une opération sans effet qu'il vaut mieux connaître. |
| `database_type` | `NONE` | Medium | Grocy l'ignore totalement (aucun chemin de code ne le lit), mais toute autre valeur provisionne une instance Cloud SQL inutilisée et facturée. |
| Mot de passe administrateur | À changer à la première connexion | High | Les identifiants par défaut `admin` / `admin` de l'image amont sont documentés publiquement ; les laisser inchangés sur un déploiement exposé par un `LoadBalancer` constitue une réelle exposition. |
| `min_instance_count` | `1` | Low | Le définir à `0` réduit les coûts mais réintroduit des démarrages à froid sur la pile nginx + php-fpm de Grocy. |

---

Pour le comportement du socle mentionné tout au long de ce guide — Workload Identity, entrée et équilibrage de charge, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Grocy partagée avec la variante Cloud Run est décrite dans **[Grocy_Common](Grocy_Common.md)**. Pour le bug de corruption du stockage que ce module a évité par conception, consultez **[Grocy_CloudRun](Grocy_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Grocy sur GKE Autopilot](../labs/Grocy_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Grocy sur Google Cloud Run](Grocy_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grocy Common — Configuration applicative partagée](Grocy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Home & Life Management**.
