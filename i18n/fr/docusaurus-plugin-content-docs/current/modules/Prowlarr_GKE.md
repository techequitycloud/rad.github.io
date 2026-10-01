---
title: "Prowlarr sur GKE Autopilot"
description: "Référence de configuration pour déployer Prowlarr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Prowlarr_GKE.md @ 3055034 sha256:e410aecff691 -->

# Prowlarr sur GKE Autopilot {#prowlarr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Prowlarr_GKE.png" alt="Prowlarr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Prowlarr est le **gestionnaire d'indexeurs** central de la suite d'automatisation
multimédia *arr — Sonarr, Radarr, Lidarr et Readarr pointent tous vers Prowlarr au
lieu de configurer les indexeurs séparément dans chaque application ; Prowlarr
synchronise la configuration des indexeurs vers l'API propre à chaque application
connectée. Il est écrit en .NET, issu de la même lignée de code Servarr que
Sonarr/Radarr, et publié sous licence GPL-3.0. Ce module déploie Prowlarr sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

**Il s'agit de la seule variante de plateforme de Prowlarr dans ce catalogue.** Un
module `Prowlarr_CloudRun` a été construit, déployé et diagnostiqué, puis
entièrement retiré — voir §3 pour le constat complet. Il n'existe aucune
alternative Cloud Run de repli ; GKE est la seule cible prise en charge.

Ce guide se concentre sur les services cloud qu'utilise Prowlarr et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Prowlarr s'exécute comme un pod à processus .NET unique, adossé à une base de
données SQLite intégrée. Le déploiement assemble un ensemble restreint et ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod à processus .NET unique, 1 vCPU / 1 GiB par défaut |
| Base de données | aucune | Prowlarr gère sa configuration d'indexeurs et de synchronisation des applications dans une base SQLite intégrée (mode WAL) — aucune instance Cloud SQL n'est créée |
| Stockage objet | un PVC bloc (par défaut), ou Cloud Storage | `stateful_pvc_enabled = true` par défaut — un véritable PVC bloc monté sur `/config` ; un bucket GCS `storage` existe mais n'est pas utilisé comme montage, sauf si le PVC est désactivé |
| Cache et file d'attente | aucun | Prowlarr ne dépend ni de Redis ni d'une file d'attente (`enable_redis` codé en dur à `false`) |
| Secrets | Secret Manager | **Aucun n'est généré** — Prowlarr n'a ni compte administrateur intégré ni clé de chiffrement à protéger |
| Entrée | Cloud Load Balancing | LoadBalancer externe une fois `service_type = "LoadBalancer"` défini ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données d'aucune sorte.** `Prowlarr_Common` fixe `database_type =
  "NONE"` — le seul état persistant de Prowlarr est son propre fichier SQLite
  intégré.
- **Image officielle, non modifiée.** `container_image_source = "prebuilt"`
  déploie directement `lscr.io/linuxserver/prowlarr` — pas de Dockerfile, pas de
  build personnalisé, pas de traduction de point d'entrée.
- **PVC de stockage bloc par défaut, pas GCS FUSE.** `stateful_pvc_enabled =
  true` exécute Prowlarr comme un StatefulSet avec un PVC par pod monté sur
  `/config`. C'est délibéré et non fortuit — SQLite en mode WAL a besoin d'un
  véritable verrouillage de fichiers POSIX, que GCS FUSE ne fournit pas de manière
  fiable, et ce catalogue a un historique documenté de corruption par GCS FUSE
  d'autres applications SQLite en mode WAL (voir UptimeKuma).
  `stateful_pvc_storage_class` vaut par défaut `standard` (HDD `pd-standard`),
  **pas** SSD — l'état de configuration de Prowlarr est minuscule et n'a aucun
  besoin d'IOPS élevées ; il puise donc dans le quota régional `DISKS_TOTAL_GB`,
  bien plus large, plutôt que dans le quota `SSD_TOTAL_GB`, très serré.
- **Instance unique, non négociable.** `min_instance_count = 1` et
  `max_instance_count = 1` — la base SQLite intégrée n'accepte qu'un seul
  rédacteur.
- **`service_type` nécessite une surcharge explicite.** La valeur par défaut
  héritée du socle pour cette variable est `"ClusterIP"` ; Prowlarr possède une
  véritable interface web que les opérateurs doivent atteindre, définissez donc
  `service_type = "LoadBalancer"` au moment du déploiement.
- **Aucun identifiant par défaut.** Il n'y a ni secret généré ni compte
  administrateur intégré — configurez l'authentification (si vous le souhaitez)
  depuis **Settings → General → Security** dans l'interface web après le premier
  déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Prowlarr {#a-gke-autopilot--the-prowlarr-workload}

- **Console :** GKE → Workloads → sélectionnez le StatefulSet `prowlarr` pour
  consulter l'état des pods, l'utilisation des ressources et les journaux.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

### B. Stockage — un PVC bloc (par défaut) ou Cloud Storage {#b-storage--a-block-pvc-default-or-cloud-storage}

- **Console :** Kubernetes Engine → Storage, ou Cloud Storage → Buckets
  (filtrez sur le préfixe du locataire).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                    # stateful_pvc_enabled = true (default)
  gcloud storage buckets list --project "$PROJECT" --filter="name~prowlarr"   # only mounted if the PVC is disabled
  ```

### C. Secret Manager {#c-secret-manager}

Prowlarr ne crée aucun secret propre, mais l'empreinte Secret Manager de la charge
de travail (secrets partagés de la plateforme, liaisons Workload Identity) mérite
tout de même d'être vérifiée si vous ajoutez des `secret_environment_variables`
personnalisées :

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~prowlarr"
  ```

### D. Réseau et entrée {#d-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  echo "$EXTERNAL_IP"
  ```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

- **Console :** Logging → Logs Explorer, filtre
  `resource.type="k8s_container" resource.labels.namespace_name="<namespace>"`.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Prowlarr {#3-prowlarr-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` — Prowlarr crée et migre son propre schéma SQLite
  (`prowlarr.db`, mode WAL) dans `/config` au premier démarrage.
- **Aucun compte administrateur par défaut.** L'authentification est désactivée
  tant que vous ne l'activez pas dans l'interface web (**Settings → General →
  Security**) ; il n'existe aucun identifiant « admin/admin » ni identifiant de
  première connexion bien connu à modifier.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /ping`, qui renvoie `200 {"status":"OK"}` sans authentification. C'est une
  véritable correction par rapport à la source clonée d'origine de ce module, qui
  faisait pointer les deux sondes vers `/api/health` (un chemin qui n'existe pas
  dans Prowlarr).
- **Inspecter l'exécution des jobs** (pertinent uniquement si vous fournissez des
  `initialization_jobs` personnalisés — aucun ne s'exécute par défaut) :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ Pourquoi il n'existe pas de variante Cloud Run : s6-overlay contre gVisor {#-why-there-is-no-cloud-run-variant-s6-overlay-vs-gvisor}

C'est le constat propre à la plateforme le plus lourd de conséquences pour ce
module — le résultat de trois déploiements de diagnostic en direct, distincts et
méthodiques, qui ont écarté le stockage et les ressources avant de conclure que la
cause première était le propre système d'initialisation du conteneur.

**Le problème.** L'image officielle `lscr.io/linuxserver/prowlarr`, comme toutes les
images LinuxServer.io, utilise **s6-overlay** comme PID 1 — un système de
supervision qui lance lui-même (exec) le processus applicatif après avoir exécuté
sa propre séquence d'initialisation (corrections de permissions, amorçage des
services, etc.). Cloud Run exécute les conteneurs dans **gVisor**, un bac à sable
en espace utilisateur qui intercepte et émule les appels système Linux. Sur
Cloud Run, le conteneur Prowlarr n'a produit **aucune sortie** — pas même la
bannière de démarrage de s6-overlay, qui s'affiche normalement en quelques
millisecondes sur toute autre plateforme — et Cloud Run a signalé
**"Application exec likely failed"** à chaque fois.

**Comment le problème a été isolé.** Trois déploiements de diagnostic en direct, en
modifiant une seule variable à la fois :

1. **Configuration par défaut** — échec identique : aucune sortie, échec de l'exec.
2. **Avec un volume GCS ajouté** (au cas où le montage lui-même aurait été
   bloquant) — échec identique.
3. **Avec davantage de CPU/mémoire** (au cas où la séquence d'initialisation de
   s6-overlay aurait simplement expiré faute de ressources) — échec identique.

Les trois tentatives ont produit exactement le même symptôme, sans aucune
variation, ce qui a écarté le stockage et le dimensionnement des ressources comme
causes et a isolé l'échec au processus d'initialisation lui-même, incompatible avec
le bac à sable gVisor — et non une erreur de configuration corrigible avec d'autres
paramètres.

**Le résultat.** `Prowlarr_CloudRun` a été construit, déployé, diagnostiqué, puis
**entièrement retiré du catalogue** — le même sort déjà réservé à Kopia, RocketChat
et LobeChat, chacun retiré pour sa propre incompatibilité au niveau de la
plateforme plutôt que laissé dans un état définitivement défaillant.
`Prowlarr_GKE` n'est soumis à aucune restriction de ce type : GKE exécute les
conteneurs sur de vrais nœuds Linux (les nœuds gérés d'Autopilot), si bien que
s6-overlay s'exécute exactement comme sur n'importe quel hôte Docker standard —
confirmé en direct : le pod indique `1/1
Running` et `/ping` renvoie `200` aussi bien en interne
(`kubectl exec ... wget`) qu'en externe une fois l'IP du LoadBalancer
provisionnée.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Prowlarr ou notables pour
lui sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `prowlarr` | Nom de base des ressources. |
| `application_display_name` | `Prowlarr` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Transmis tel quel comme tag de l'image officielle — pas de build personnalisé, donc aucun ARG de build d'épinglage de version n'existe. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement `lscr.io/linuxserver/prowlarr`. Correctement transmis à `App_GKE` (contrairement à certains modules prebuilt où cette variable est inerte). |
| `container_port` | `9696` | Fixé via `Prowlarr_Common` ; non transmis directement à `App_GKE`. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Tous deux épinglés à `1` — la base SQLite intégrée n'accepte qu'un seul rédacteur. |
| `enable_image_mirroring` | `true` | Met en miroir l'image officielle dans Artifact Registry pour éviter les limites de débit de Docker Hub, même si l'image elle-même n'est pas modifiée. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | **Surchargez-la à `LoadBalancer`.** La valeur par défaut héritée est pensée pour des charges de travail internes ou de type base de données ; Prowlarr possède une véritable interface web qui doit être joignable de l'extérieur. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (valeur par défaut) — inutile de définir les deux. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Valeur par défaut délibérée** — offre à la base SQLite intégrée en mode WAL un véritable verrouillage de fichiers POSIX, que GCS FUSE ne fournit pas de manière fiable. |
| `stateful_pvc_mount_path` | `/config` | Emplacement où Prowlarr conserve `prowlarr.db` et tout le reste de l'état de l'application. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, pas SSD — l'état de configuration/SQLite de Prowlarr est petit et n'a aucun besoin d'IOPS élevées ; évite le quota `SSD_TOTAL_GB`, très serré, au profit du quota `DISKS_TOTAL_GB`, bien plus large. |
| `stateful_fs_group` | `3000` | Rend le PVC accessible en écriture au groupe ; Prowlarr s'exécute avec l'UID 1000 / GID 2000. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/ping` | Les sondes réellement appliquées au Pod (transmises via `Prowlarr_Common`). Confirmé en direct : `200 {"status":"OK"}`, sans authentification. |
| `startup_probe_config` / `health_check_config` | HTTP `/api/health` (obsolète) | **Inertes pour Prowlarr** — `App_GKE` préfère toujours les `startup_probe`/`liveness_probe` propres à l'application ci-dessus lorsqu'un module en fournit, de sorte que ces variables de premier niveau n'atteignent jamais la spécification du Pod malgré leur valeur par défaut d'apparence obsolète. |
| `uptime_check_config` | `{ enabled = false, path = "/api/health" }` | **Pas inerte.** Désactivée par défaut, mais si vous activez le test de disponibilité Cloud Monitoring, surchargez `path = "/ping"` — cette variable est appliquée telle quelle, contrairement aux deux précédentes. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Provisionné mais **non utilisé comme montage** tant que `stateful_pvc_enabled = true` (valeur par défaut) — le PVC bloc prend `/config` en charge à la place. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Prowlarr_Common` — Prowlarr n'a pas de base de données SQL. |

### Groupe 19 — Domaine personnalisé et réseau {#group-19--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Le déploiement de test/référence a utilisé `false` (IP éphémère) après avoir atteint le plafond du quota d'IP statiques globales du projet — il est sans risque de laisser `false` pour Prowlarr, qui n'intègre aucune URL autoréférente dans sa propre configuration au démarrage. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du Service Kubernetes. |
| `storage_buckets` | Le bucket `storage` (non utilisé comme montage tant que `stateful_pvc_enabled = true`). |
| `statefulset_name` | Nom du StatefulSet (le type de charge de travail par défaut). |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |
| `container_image` / `container_registry` | La référence de l'image déployée et le dépôt Artifact Registry. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

La validation au moment du plan détecte le conflit de mise à l'échelle min/max,
l'exigence d'identifiants IAP et le conflit StatefulSet/`workload_type` avant
l'apply — mais plusieurs paramètres qui passent la validation ont tout de même une
valeur par défaut d'apparence erronée ou risquée, à connaître avant de déployer.

> Risque : **Critique** (perte de données / interruption / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` | `LoadBalancer` | Élevé | La valeur par défaut héritée est `ClusterIP` — l'interface web de Prowlarr reste injoignable depuis l'extérieur du cluster tant que ce paramètre n'est pas défini explicitement. |
| Déploiement sur Cloud Run | À éviter — utilisez `Prowlarr_GKE` (la seule variante prise en charge) | Critique | Le processus d'initialisation s6-overlay de l'image ne peut pas s'exécuter dans le bac à sable gVisor de Cloud Run — confirmé par 3 déploiements de diagnostic, tous en échec identique sans aucune sortie du conteneur. Il n'existe aucun correctif de configuration ; un module `Prowlarr_CloudRun` a été construit, testé et retiré précisément pour cette raison. |
| `stateful_pvc_enabled` | `true` (valeur par défaut) | Élevé | Le désactiver revient à un montage GCS FUSE sur `/config`, qui ne prend pas en charge de manière fiable le verrouillage de fichiers POSIX dont a besoin la base SQLite en mode WAL de Prowlarr — ce catalogue a un historique documenté de corruption par GCS FUSE d'autres applications SQLite en mode WAL. |
| `stateful_pvc_storage_class` | Laisser à `standard` (HDD) | Faible–Moyen | Passer à `standard-rwo`/`premium-rwo` (SSD) puise dans le quota `SSD_TOTAL_GB`, bien plus serré, sans réel bénéfice — le profil d'E/S de fichiers de configuration de Prowlarr n'a pas besoin des IOPS d'un SSD. |
| `max_instance_count` | Laisser à `1` | Critique | La base SQLite intégrée n'accepte qu'un seul rédacteur ; augmenter cette valeur expose à une corruption de la base de données. |
| `uptime_check_config.path` | Surcharger à `/ping` si vous activez les tests de disponibilité | Moyen | Le `path` par défaut de la variable est un `/api/health` obsolète hérité de la source clonée de ce module — contrairement à `startup_probe`/`liveness_probe`, celle-ci n'est *pas* surchargée ailleurs, si bien qu'un test de disponibilité activé avec le chemin par défaut échouera sur un chemin qui n'existe pas. |
| Authentification | L'activer depuis Settings → General → Security dans l'interface web après le premier déploiement | Élevé | Prowlarr est livré sans compte administrateur intégré ni secret généré — une instance joignable depuis Internet et non authentifiée est exposée par défaut tant que vous ne l'avez pas configurée. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Prowlarr est décrite dans
**[Prowlarr_Common](Prowlarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Prowlarr sur GKE Autopilot](../labs/Prowlarr_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Prowlarr Common — Configuration applicative partagée](Prowlarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md) et [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Media Server**.
