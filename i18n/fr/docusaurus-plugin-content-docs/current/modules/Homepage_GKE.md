---
title: "Homepage sur GKE Autopilot"
description: "Référence de configuration pour déployer Homepage sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Homepage_GKE.md @ 3055034 sha256:3504352f2a30 -->

# Homepage sur GKE Autopilot {#homepage-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homepage_GKE.png" alt="Homepage sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Homepage](https://gethomepage.dev/) (gethomepage/homepage) est un tableau de
bord / lanceur de services auto-hébergé et hautement personnalisable — une
application Next.js 16 / Node 22 dont toute la configuration (services, favoris,
widgets, mise en page) tient dans une poignée de fichiers YAML, avec des widgets
facultatifs d'état et de statistiques en direct pour les autres applications
auto-hébergées que vous exploitez. Ce module déploie Homepage sur **GKE
Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Homepage et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Homepage s'exécute sous la forme d'un unique pod Node.js/Next.js sur GKE
Autopilot. Comme la variante Cloud Run, il n'a **ni base de données ni cache** —
tout son état est un répertoire de fichiers YAML. Ce qui diffère sur GKE, c'est
la couche de stockage elle-même : Cloud Run n'a pas de notion de PVC, si bien que
`Homepage_CloudRun` utilise toujours un volume GCS FUSE ; `Homepage_GKE` adopte
par défaut la même approche GCS FUSE, mais propose en plus un véritable PVC de
stockage en mode bloc, sur activation explicite.

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js unique, `1000m` de CPU / `1Gi` de mémoire par défaut |
| Base de données | aucune | Homepage n'a aucune base de données ; `database_type = "NONE"` |
| Stockage objet | Cloud Storage (par défaut) **ou** un PVC en mode bloc | Par défaut : un bucket `storage` monté sur `/app/config` via le pilote CSI GCS FUSE. Avec `stateful_pvc_enabled = true` : un PVC `standard-rwo` par pod (`5Gi` par défaut) sur le même chemin à la place, et la charge de travail devient un `StatefulSet` |
| Cache et file d'attente | aucun | `enable_redis = false` est codé en dur dans `main.tf`, remplaçant la valeur par défaut `true` de la fondation |
| Secrets | aucun | Aucun secret n'est généré — Homepage n'a besoin d'aucun identifiant propre |
| Entrée | Cloud Load Balancing | Service `LoadBalancer` par défaut, avec domaine personnalisé + certificat géré facultatifs ; `ClusterIP` est disponible pour les déploiements internes uniquement ou soumis à des contraintes de quota |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Réellement préconstruit — pas d'image personnalisée, pas de Cloud Build pour
  l'application.** `Homepage_Common` définit `image_source = "prebuilt"` et
  `container_build_config.enabled = false` ; `ghcr.io/gethomepage/homepage` est
  déployée directement. `enable_image_mirroring = true` la copie tout de même dans
  Artifact Registry (pour éviter les limites de débit de GHCR), mais il s'agit d'un
  miroir, pas d'un build.
- **Port 3000, chemin de santé `/api/healthcheck`.** Confirmé sur un déploiement
  réel : `GET /api/healthcheck` renvoie un `200 "up"` non authentifié dès que
  l'application est prête (adossé à la directive `HEALTHCHECK` de l'image
  elle-même). `GET /` renvoie le véritable HTML du tableau de bord (confirmé :
  `<title>Homepage</title>`).
- **Deux dispositions de stockage, choisies par `stateful_pvc_enabled`.** La
  valeur par défaut (`false`) exécute un `Deployment` sans état avec le bucket GCS
  `storage` monté sur `/app/config` — de forme identique à `Homepage_CloudRun`. La
  définir à `true` bascule vers un `StatefulSet` avec un véritable PVC de stockage
  en mode bloc sur le même chemin (le volume GCS est alors automatiquement
  désactivé pour éviter un double montage). Il s'agit d'une différence réelle et
  délibérée, dictée par la plateforme — GKE dispose de PVC, Cloud Run non — et non
  d'une incohérence entre les deux variantes. **C'est le mode PVC en bloc qui a été
  vérifié en conditions réelles pour ce module** (voir §3).
- **Ni base de données ni Redis — architecture inhabituelle pour ce catalogue.**
  Presque tous les autres modules applicatifs raccordent une instance Cloud SQL
  et/ou Redis via la fondation ; Homepage n'a besoin ni de l'une ni de l'autre.
  Cela signifie aussi qu'il échappe aux catégories de bugs habituelles —
  raccordement du DSN, socket ou TCP, encodage d'URL du mot de passe — documentées
  ailleurs dans ce dépôt : il n'y a tout simplement aucune connexion à une base de
  données à mal configurer.
- **La sécurité du multi-instance dépend du mode de stockage.** Dans le mode GCS
  FUSE par défaut, `max_instance_count > 1` est réellement sûr — chaque pod lit en
  direct le même bucket partagé sur le disque, sans cache dans le processus. Avec
  `stateful_pvc_enabled = true`, chaque ordinal de pod du `StatefulSet` reçoit
  **son propre PVC distinct** (sémantique standard des `volumeClaimTemplates` de
  Kubernetes) — exécuter plus d'un réplica dans ce mode donne à chaque pod une
  configuration qui diverge indépendamment, et non un tableau de bord partagé.
  Conservez `max_instance_count = 1` dès que le PVC en bloc est activé.
- **Aucune authentification propre.** `HOMEPAGE_ALLOWED_HOSTS` vaut `"*"` par
  défaut — cela ne conditionne que la vérification de l'en-tête `Host` sur les
  appels `/api/*` de données des widgets de Homepage, et non un véritable contrôle
  d'accès. Placez-le derrière IAP, un VPN ou un reverse proxy si vous devez
  restreindre qui peut y accéder.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Homepage {#a-gke-autopilot--the-homepage-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Homepage pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe (si
  `service_type = LoadBalancer`).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  # If stateful_pvc_enabled = true, the workload is a StatefulSet:
  kubectl get statefulset -n "$NAMESPACE"
  # Otherwise it is a Deployment:
  kubectl get deploy -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Stockage — `/app/config` {#b-storage--appconfig}

Le mécanisme de stockage dépend de `stateful_pvc_enabled` :

- **Par défaut (`false`) — GCS FUSE.** Le bucket `storage` est monté sur
  `/app/config` via le pilote CSI GCS FUSE. Il contient tous les fichiers de
  configuration YAML que lit Homepage (`settings.yaml`, `services.yaml`,
  `bookmarks.yaml`, `widgets.yaml`, `docker.yaml`) ainsi que les journaux de
  Homepage.
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
  gcloud storage ls "gs://<bucket-name>/"
  gcloud storage cat "gs://<bucket-name>/settings.yaml"
  ```
- **Sur activation (`true`) — PVC en bloc.** Un PVC `standard-rwo` par pod
  (`5Gi` par défaut) est monté sur `/app/config` à la place. Inspectez-le
  directement :
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /app/config
  kubectl exec -n "$NAMESPACE" <pod-name> -- cat /app/config/settings.yaml
  ```
  Il n'y a aucun bucket GCS à inspecter dans ce mode — la sortie
  `storage_buckets` n'est renseignée que lorsque le module s'exécute dans sa
  disposition par défaut (sans PVC).

### C. Secret Manager {#c-secret-manager}

Rien à voir ici — Homepage ne génère aucun secret. Le confirmer constitue en soi
un contrôle de cohérence utile sur un déploiement neuf :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
```

### D. Réseau et entrée {#d-networking--ingress}

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT" --filter="name~homepage"
```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

```bash
kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application Homepage {#3-homepage-application-behaviour}

- **Aucun job de schéma de base de données au premier déploiement.** Homepage n'a
  pas de base de données ; `initialization_jobs` est donc vide par défaut et aucun
  job n'est nécessaire.
- **Aucun assistant de configuration au premier lancement.** Il n'y a aucun compte
  administrateur à créer ni parcours d'accueil — Homepage affiche son tableau de
  bord à partir de la configuration présente dans `/app/config` (les valeurs par
  défaut fournies avec l'image amont sur un déploiement neuf, puisque le point
  d'entrée amorce lui-même tout fichier manquant). Personnalisez le tableau de bord
  en modifiant directement les fichiers YAML (via le bucket GCS ou
  `kubectl exec`, selon le mode de stockage — voir §2B) ou en configurant
  `docker.yaml` / la découverte par libellés si vous le connectez à une API
  Docker/Kubernetes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /api/healthcheck` — un `200 "up"` non authentifié, confirmé en conditions
  réelles.

### Vérifié en conditions réelles : StatefulSet + PVC en bloc {#verified-live-statefulset--block-pvc}

Le premier déploiement de ce module a utilisé `stateful_pvc_enabled = true`
(défini dans `config/deploy.tfvars`), exerçant de bout en bout le chemin de
stockage par PVC en bloc :

- Le pod `<service>-0` a indiqué `1/1 Running` avec **0 redémarrage**.
- Le PVC `data-<service>-0` a indiqué `Bound`.
- Les journaux de démarrage ont montré une séquence propre : une correction de la
  propriété du répertoire de configuration, la mise en service du serveur Next.js,
  puis l'auto-amorçage de `settings.yaml`/`kubernetes.yaml` sur le PVC vide, sans
  aucune erreur.
- `GET /api/healthcheck` a renvoyé `200 "up"`.
- `GET /` a renvoyé le véritable HTML du tableau de bord
  (`<title>Homepage</title>`), et non une page fictive ou une page d'erreur.
- Les fichiers du PVC avaient le bon propriétaire (`node:node`) — l'étape chown du
  point d'entrée au démarrage s'en est chargée ; les `mount_options` GCS FUSE
  `uid=1000`/`gid=1000` documentées pour `Homepage_CloudRun` et pour la
  disposition GKE par défaut n'interviennent tout simplement pas dans ce mode,
  puisqu'aucun volume GCS n'est monté lorsque `stateful_pvc_enabled = true`.

Le déploiement a également confirmé que la contrainte de quota d'adresses IP
externes du projet a conduit à `service_type = "ClusterIP"` et
`reserve_static_ip = false` pour ce déploiement précis (voir
`config/deploy.tfvars`), plutôt qu'aux valeurs par défaut du module
`LoadBalancer`/`reserve_static_ip = true` — un choix au niveau du projet, et non
une exigence du module. L'accès a été vérifié via `kubectl port-forward` plutôt
que par une adresse IP externe.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Homepage ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homepage` | Nom de base des ressources. |
| `application_display_name` | `Homepage` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Transmis tel quel comme tag de l'image `ghcr.io/gethomepage/homepage` — aucune étape de build. |
| `homepage_allowed_hosts` | `*` | `HOMEPAGE_ALLOWED_HOSTS` — liste d'autorisation, séparée par des virgules, de l'en-tête `Host` pour les appels `/api/*` de Homepage lui-même. Ce n'est pas une véritable frontière de contrôle d'accès. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port du serveur Next.js standalone de Homepage. Fixé par `Homepage_Common` ; non transmis à `App_GKE`. |
| `container_image_source` | `prebuilt` | Déploie directement `ghcr.io/gethomepage/homepage` — aucun Cloud Build pour l'application. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Léger — Homepage est un unique serveur Next.js standalone. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Plusieurs réplicas ne sont sûrs que dans le mode de stockage GCS FUSE par défaut — voir §1 et §3. Conservez `max_instance_count = 1` lorsque `stateful_pvc_enabled = true`. |
| `enable_image_mirroring` | `true` | Met l'image préconstruite en miroir dans Artifact Registry (pour éviter les limites de débit de GHCR) — pas un build. |
| `enable_cloudsql_volume` | `false` | Homepage n'a pas de Cloud SQL — conservez `false`. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` (se résout en `Deployment`) | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Homepage est un tableau de bord destiné au navigateur ; utilisez `ClusterIP` pour un accès interne uniquement ou pour les projets soumis à des contraintes de quota (la vérification en conditions réelles de ce module a utilisé `ClusterIP`). |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` bascule Homepage vers un `StatefulSet` avec un véritable PVC en bloc sur `/app/config` au lieu du volume GCS FUSE par défaut — le mode vérifié en conditions réelles pour ce module. |
| `stateful_pvc_size` | `5Gi` | La configuration YAML et les journaux de Homepage sont minuscules ; dimensionné au plancher de la plateforme. |
| `stateful_pvc_mount_path` | `/app/config` | Même chemin que le montage GCS FUSE par défaut — les deux s'excluent mutuellement et ne sont jamais montés en double. |
| `stateful_fs_group` | `3000` | `fsGroup` au niveau du pod pour le PVC en bloc (valeur par défaut du chart Helm amont). |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Reste vide par défaut — rien à amorcer. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le montage du bucket `storage` sur `/app/config` est ajouté automatiquement **uniquement** lorsque `stateful_pvc_enabled = false` ; n'utilisez cette variable que pour des volumes *supplémentaires*. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Homepage_Common` — Homepage n'a aucune base de données SQL, un point c'est tout. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/healthcheck` | `200 "up"` non authentifié — une valeur par défaut exacte, correspondant à la directive `HEALTHCHECK` de l'image, transmise sans modification depuis `Homepage_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du Service Kubernetes et URL du tableau de bord (port 3000). |
| `namespace` | Namespace Kubernetes dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne au cluster / adresse IP externe du LoadBalancer (lorsqu'elle est réservée). |
| `storage_buckets` | Le bucket `storage` qui soutient `/app/config` — renseigné uniquement dans le mode de stockage par défaut, sans PVC. |
| `statefulset_name` | Nom du StatefulSet — renseigné uniquement lorsque `stateful_pvc_enabled = true`. |
| `container_image` / `container_registry` | Référence de l'image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide pour Homepage). |
| `kubernetes_ready` | Indique si le cluster / la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` avec `stateful_pvc_enabled = true` | Conserver `1` | Élevé | Chaque ordinal de pod du StatefulSet reçoit son propre PVC distinct (et non un stockage partagé) — dépasser un réplica en mode PVC en bloc donne à chaque pod une configuration de tableau de bord qui diverge indépendamment, et non une configuration partagée cohérente. |
| `stateful_pvc_mount_path` / `gcs_volumes` sur `/app/config` | Laisser en place le montage automatique, quel que soit le mode utilisé | **Critique** | Supprimer ou mal configurer ce volume fait perdre tous les fichiers de configuration YAML au prochain démarrage à froid ou à la prochaine replanification du pod — Homepage n'a aucune autre source de vérité. |
| `HOMEPAGE_ALLOWED_HOSTS` | Laisser `*` sauf si vous connaissez le nom d'hôte final, puis le restreindre | Moyen | Une valeur trop restrictive renvoie un 400 pour chaque widget adossé à l'API (le squelette de la page se charge quand même) si le nom d'hôte réel de la requête ne correspond pas ; le traiter comme une véritable frontière d'authentification procure de toute façon un faux sentiment de sécurité. |
| Chemin de sonde | Laisser `/api/healthcheck` | Élevé | Un chemin de sonde authentifié ou inexistant laisserait le pod durablement en `Ready=False` alors même que l'application a démarré correctement. |
| `enable_redis` | Ne pas toucher au `false` codé en dur (ne tentez pas de le forcer via `environment_variables`) | Faible | Homepage n'a rien à mettre en cache ; activer Redis ajoute une dépendance Memorystore/NFS-Redis inutile. |
| `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` | Laisser `workload_type` non défini (`null`) | Faible | Une validation au moment du plan rejette purement et simplement cette combinaison — un modèle de PVC exige un StatefulSet. |
| `service_type` | `LoadBalancer`, sauf contrainte de quota | Moyen | `ClusterIP` exige `kubectl port-forward` pour l'accès — adapté à un usage interne ou aux projets limités en quota (comme lors de la vérification en conditions réelles de ce module), mais inaccessible depuis un navigateur sans cela. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — Workload
Identity, autoscaling, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Homepage,
partagée avec la variante Cloud Run, est décrite dans
**[Homepage_Common](Homepage_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homepage sur GKE Autopilot](../labs/Homepage_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Homepage sur Google Cloud Run](Homepage_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homepage Common — Configuration applicative partagée](Homepage_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md) et [Jellystat sur GKE Autopilot](Jellystat_GKE.md) dans la solution **Media Server**.
