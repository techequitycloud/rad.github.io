---
title: "Karakeep sur GKE Autopilot"
description: "Référence de configuration pour déployer Karakeep sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Karakeep_GKE.md @ 3055034 sha256:37fe81d90645 -->

# Karakeep sur GKE Autopilot {#karakeep-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Karakeep_GKE.png" alt="Karakeep sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Karakeep est une application open source et auto-hébergeable pour tout mettre en
favori (liens, notes et images), avec étiquetage automatique par IA et recherche en
texte intégral/sémantique. Ce module déploie Karakeep sur **GKE Autopilot**
au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Karakeep et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Karakeep s'exécute comme une charge de travail web Next.js, associée à un Service
sidecar Meilisearch obligatoire pour la recherche. Contrairement à la plupart des
applications de ce catalogue, il n'utilise **aucune base de données relationnelle
externe** — tout l'état réside dans une base SQLite intégrée ainsi que dans les
ressources téléversées sur le volume NFS partagé de la plateforme :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Next.js, 1 vCPU / 512 MiB par défaut, limité à un seul réplica |
| Recherche | GKE Autopilot (Service interne) | Un sidecar Meilisearch requis, déployé automatiquement — non facultatif |
| Base de données | aucune | L'état réside dans une base SQLite intégrée, et non dans Cloud SQL |
| Stockage objet | aucun (NFS à la place) | Les ressources téléversées sont conservées sur le volume NFS partagé de la plateforme, et non dans GCS |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `MEILI_MASTER_KEY` générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** `database_type = "NONE"` — la base SQLite intégrée de
  Karakeep et les ressources téléversées résident toutes deux sur le volume NFS
  partagé de la plateforme.
- **Un seul réplica uniquement.** `max_instance_count = 1` — plusieurs pods
  écrivant dans le même fichier SQLite sur NFS risquent de le corrompre, même avec le
  mode WAL désactivé.
- **Stratégie de déploiement `Recreate` appliquée automatiquement.** Le socle
  détecte les applications adossées à NFS et utilise `Recreate` au lieu de
  `RollingUpdate`, évitant l'interblocage dû à deux pods brièvement actifs
  qu'entraînerait sinon une mise à jour progressive.
- **Meilisearch est obligatoire, et non facultatif.** Il est déployé
  automatiquement comme Service Kubernetes à accès interne uniquement. Sans lui,
  `MEILI_ADDR` de Karakeep n'est pas défini et la recherche est désactivée
  silencieusement.
- **Pas de build de conteneur personnalisé.** Le mode de journalisation SQLite de
  Karakeep est déjà par défaut le mode `DELETE`, compatible NFS — l'image officielle
  préconstruite est déployée telle quelle.
- **Pas d'identifiant d'amorçage administrateur.** Le premier compte créé via le
  formulaire d'inscription de l'interface web devient administrateur.
- **`NEXTAUTH_URL` utilise la substitution `$(VAR)` native de Kubernetes** —
  `$(GKE_SERVICE_URL)` se résout en la valeur injectée par le socle au démarrage du
  conteneur (contrairement à Cloud Run, où `$(VAR)` est transmis littéralement).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Karakeep {#a-gke-autopilot--the-karakeep-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Karakeep. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail.

### B. Meilisearch (sidecar requis) {#b-meilisearch-required-sidecar}

Déployé automatiquement comme Service Kubernetes distinct à accès interne
uniquement. Son URL est injectée automatiquement dans `MEILI_ADDR` de l'application
principale. Son index réside sur le stockage éphémère propre au sidecar — les
services supplémentaires ne partagent pas le volume NFS de l'application
principale — et est reconstruit entièrement à chaque redémarrage. Cela n'affecte que
la disponibilité de la recherche, et non la sécurité des données ; les favoris sont
conservés sur le `/data` monté en NFS de l'application principale.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -l app=meilisearch
  kubectl logs -n "$NAMESPACE" deploy/<service>-meilisearch --tail=50
  ```

### C. NFS (Cloud Filestore ou la VM NFS+Redis autogérée) {#c-nfs-cloud-filestore-or-the-self-managed-nfsredis-vm}

La base SQLite intégrée de Karakeep et ses ressources téléversées résident toutes
deux sur le volume NFS partagé de la plateforme, monté sur `/data`.

- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement : `NEXTAUTH_SECRET` et
`MEILI_MASTER_KEY`.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Karakeep {#3-karakeep-application-behaviour}

- **Pas de Job de configuration de la base de données au premier déploiement.**
  Karakeep gère lui-même son schéma SQLite au démarrage.
- **Pas d'identifiant d'amorçage administrateur à récupérer.** Le premier compte
  créé via l'interface web devient administrateur.
- **La recherche dépend de l'accessibilité du sidecar.** Si le Service Meilisearch
  ne démarre pas, la recherche cesse silencieusement de fonctionner ; la mise en
  favori continue.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Karakeep ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `karakeep` | Nom de base des ressources. |
| `application_version` | `latest` | Correspond au tag évolutif `"release"` propre à Karakeep. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Limité à un seul réplica pour la sécurité de SQLite sur NFS. |
| `container_port` | `3000` | Port par défaut natif de Karakeep. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Obligatoire — la base SQLite et les ressources de Karakeep y résident. |
| `nfs_mount_path` | `"/app/data"` | Le module définit `DATA_DIR` sur ce chemin. La variante Cloud Run utilise `/data` à la place — les deux fonctionnent, car `DATA_DIR` suit toujours le montage. |
| `stateful_pvc_enabled` | `null` | Non défini ; la logique de résolution propre à `App_GKE` s'applique donc (pas de PVC). Karakeep utilise NFS, et non un PVC bloc. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — aucune instance Cloud SQL n'est provisionnée. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Vides — sans objet. |
| `storage_buckets` | Vide — Karakeep assure la persistance via NFS. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (valeur par défaut fixée) | Critical | L'augmenter expose à une corruption de SQLite par des écrivains NFS concurrents. |
| Premier compte créé via l'inscription | Le créer immédiatement après le déploiement | Critical | Le premier compte inscrit devient administrateur. |
| `enable_nfs` | `true` (par défaut) | Critical | Le désactiver supprime tout stockage durable. |
| `container_image_source` | `prebuilt` (par défaut) | High | `"custom"` déclenche un Cloud Build inutile, sans Dockerfile dans ce module. |
| Accessibilité du sidecar Meilisearch | Vérifier que `MEILI_ADDR` est résolu après le déploiement | Medium | La recherche cesse silencieusement de fonctionner si le sidecar ne démarre pas. |
| `NEXTAUTH_SECRET` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critical | Sa rotation invalide toutes les sessions actives. |
| Variable d'environnement `DATA_DIR` | La définir explicitement (ce module la définit toujours sur `nfs_mount_path`) | Critical | La valeur par défaut propre à Karakeep est une **chaîne vide**, et non `/data` (cette valeur par défaut n'existe que dans le modèle docker-compose amont). Si elle n'est pas définie, les migrations et le fichier SQLite se résolvent silencieusement vers un stockage éphémère au lieu du montage NFS. |
| Format de la valeur de `additional_services[].secret_env_vars` | Nom de clé simple (par ex. `"MEILI_MASTER_KEY"`) | High | Le Secret K8s consolidé par tenant de GKE stocke des clés portant le nom de la variable d'environnement elle-même — **et non** la chaîne brute `secret_id` de Secret Manager (c'est la convention Cloud Run). Un format erroné provoque `CreateContainerConfigError: couldn't find key <secret_id> in Secret <prefix>-secrets`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Karakeep, partagée avec la variante Cloud Run,
est décrite dans **[Karakeep_Common](Karakeep_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Karakeep sur GKE Autopilot](../labs/Karakeep_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Karakeep sur Google Cloud Run](Karakeep_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Karakeep Common — Configuration applicative partagée](Karakeep_Common.md) — la configuration partagée par les deux cibles de déploiement.
