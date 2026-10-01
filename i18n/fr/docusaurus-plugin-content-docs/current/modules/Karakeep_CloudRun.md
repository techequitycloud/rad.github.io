---
title: "Karakeep sur Google Cloud Run"
description: "Référence de configuration pour déployer Karakeep sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Karakeep_CloudRun.md @ 3055034 sha256:b261ced24bf1 -->

# Karakeep sur Google Cloud Run {#karakeep-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Karakeep_CloudRun.png" alt="Karakeep sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Karakeep est une application open source et auto-hébergeable pour tout mettre en
favori (liens, notes et images), avec étiquetage automatique par IA et recherche en
texte intégral/sémantique. Ce module déploie Karakeep sur **Cloud Run v2** au-dessus
du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Karakeep et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et simultanéité, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Karakeep s'exécute comme un conteneur Next.js sur Cloud Run v2, associé à un sidecar
Meilisearch obligatoire pour la recherche. Contrairement à la plupart des
applications de ce catalogue, il n'utilise **aucune base de données relationnelle
externe** — tout l'état réside dans une base SQLite intégrée ainsi que dans les
ressources téléversées sur le volume NFS partagé de la plateforme :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 1 vCPU / 512 MiB par défaut, mise à zéro, limité à une seule instance |
| Recherche | Cloud Run v2 (service interne) | Un sidecar Meilisearch requis, déployé automatiquement — non facultatif |
| Base de données | aucune | L'état réside dans une base SQLite intégrée, et non dans Cloud SQL |
| Stockage objet | aucun (NFS à la place) | Les ressources téléversées sont conservées sur le volume NFS partagé de la plateforme, et non dans GCS |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `MEILI_MASTER_KEY` générés automatiquement |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** `database_type = "NONE"` — la base SQLite intégrée de
  Karakeep et les ressources téléversées résident toutes deux sur le volume NFS
  partagé de la plateforme (`enable_nfs = true` par défaut).
- **Une seule instance uniquement.** `max_instance_count = 1` — plusieurs instances
  Cloud Run écrivant dans le même fichier SQLite sur NFS risquent de le corrompre,
  même avec le mode WAL désactivé (ce que ce module conserve par défaut).
- **Meilisearch est obligatoire, et non facultatif.** Il est déployé
  automatiquement comme service Cloud Run supplémentaire à accès interne uniquement.
  Sans lui, `MEILI_ADDR` de Karakeep n'est pas défini et la recherche est
  désactivée silencieusement (la mise en favori elle-même fonctionne toujours).
- **Pas de build de conteneur personnalisé.** Le mode de journalisation SQLite de
  Karakeep est déjà par défaut le mode `DELETE`, compatible NFS — l'image officielle
  préconstruite est déployée telle quelle.
- **Pas d'identifiant d'amorçage administrateur.** Le premier compte créé via le
  formulaire d'inscription de l'interface web devient administrateur.
- **`NEXTAUTH_SECRET` est immuable après le premier démarrage.** Sa rotation
  invalide toutes les sessions actives.
- **Facturation à la requête par défaut.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — le chemin principal d'enregistrement/de recherche de
  Karakeep n'a besoin d'aucun CPU en arrière-plan ; l'exploration asynchrone des
  liens et l'étiquetage par IA peuvent être suspendus pendant la mise à zéro.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Karakeep {#a-cloud-run--the-karakeep-service}

Karakeep s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la simultanéité,
l'environnement d'exécution et la répartition du trafic.

### B. Meilisearch (sidecar requis) {#b-meilisearch-required-sidecar}

La recherche en texte intégral et sémantique de Karakeep repose entièrement sur une
instance Meilisearch, déployée automatiquement comme service Cloud Run distinct à
accès interne uniquement. Son URL est injectée automatiquement dans la variable
d'environnement `MEILI_ADDR` de l'application principale. Son index réside sur le
stockage éphémère propre au sidecar — les services supplémentaires ne partagent pas
le volume NFS de l'application principale — et est reconstruit entièrement à chaque
redémarrage. Cela n'affecte que la disponibilité de la recherche, et non la sécurité
des données ; les favoris sont conservés sur le `/data` monté en NFS de
l'application principale.

- **Console :** Cloud Run → le service `<service>-meilisearch` (entrée interne
  uniquement — non joignable directement depuis un navigateur).
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~meilisearch"
  gcloud run services logs read <service>-meilisearch --project "$PROJECT" --region "$REGION" --limit=50
  ```

### C. NFS (Cloud Filestore ou la VM NFS+Redis autogérée) {#c-nfs-cloud-filestore-or-the-self-managed-nfsredis-vm}

La base SQLite intégrée de Karakeep et ses ressources téléversées (les captures
d'écran des pages mises en favori y seraient également stockées, bien que ce module
n'active pas la capture d'écran par Chrome headless) résident sur le volume NFS
partagé de la plateforme, monté sur `/data`.

- **Console :** Filestore → instances (si `Services_GCP` a créé une instance
  Filestore gérée) — ou Compute Engine → la VM NFS autogérée.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de découverte et de montage
NFS.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement : `NEXTAUTH_SECRET` (signature des JWT de
session) et `MEILI_MASTER_KEY` (partagé entre l'application et son sidecar
Meilisearch).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques de Cloud
Run vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Karakeep {#3-karakeep-application-behaviour}

- **Pas de job de configuration de la base de données au premier déploiement.**
  Karakeep gère lui-même son schéma SQLite et ses migrations au démarrage — il n'y a
  pas de job `db-init` distinct à inspecter.
- **Pas d'identifiant d'amorçage administrateur à récupérer.** Le premier compte
  créé via le formulaire d'inscription de l'interface web devient administrateur. Il
  n'y a rien à récupérer dans Secret Manager avant la première connexion.
- **La recherche dépend de l'accessibilité du sidecar.** Si le service Meilisearch
  ne démarre pas, la recherche cesse silencieusement de fonctionner — la mise en
  favori, l'étiquetage et la navigation continuent tous de fonctionner, mais rien
  n'est retrouvable par la recherche.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — la page
  publique de connexion/d'accueil de Karakeep.
- **Le travail asynchrone (exploration des liens, étiquetage par IA) s'exécute dans
  le processus.** Avec `cpu_always_allocated = false` (la valeur par défaut), ce
  travail peut être suspendu pendant que l'instance est mise à zéro entre les
  requêtes, puis reprendre à la requête suivante.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Karakeep ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `karakeep` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Karakeep_Common` fait correspondre `"latest"` au tag évolutif `"release"` propre à Karakeep. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire — le mode de journalisation SQLite par défaut de Karakeep est déjà compatible NFS. |
| `min_instance_count` | `0` | Mise à zéro. |
| `max_instance_count` | `1` | **Fixé** — sécurité multi-écrivain de SQLite sur NFS. Ne l'augmentez pas. |
| `container_port` | `3000` | Port par défaut natif de Karakeep. |
| `cpu_always_allocated` | `true` | Facturation à la requête. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Obligatoire — la base SQLite et les ressources de Karakeep y résident. |
| `nfs_mount_path` | `/data` | Valeur par défaut de `DATA_DIR` de Karakeep. |
| `storage_buckets` | `[]` | Aucun bucket GCS provisionné — Karakeep utilise NFS, et non le stockage objet. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — aucune instance Cloud SQL n'est provisionnée. |

### Groupe 13 — Jobs et sidecars {#group-13--jobs--sidecars}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Non utilisé — Karakeep migre son propre schéma au démarrage. |
| `additional_services` | `[]` | Services *supplémentaires* configurables par l'utilisateur en plus de ceux de Karakeep — le sidecar Meilisearch requis est déployé automatiquement et n'est pas représenté ici. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` délai de 30 s | Les sondes ciblent la page de connexion publique. |

---

## 5. Outputs {#5-outputs}

Renvoyés lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Vides — sans objet (`database_type = "NONE"`). |
| `storage_buckets` | Vide — Karakeep assure la persistance via NFS, et non GCS. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (valeur par défaut fixée) | Critical | L'augmenter expose à une corruption de SQLite par des écrivains NFS concurrents — Karakeep n'a aucun autre backend de base de données sur lequel se replier. |
| Premier compte créé via l'inscription | Le créer immédiatement après le déploiement | Critical | Le premier compte inscrit devient administrateur — si l'inscription reste ouverte, le premier visiteur qui atteint l'URL s'attribue ce rôle. |
| `enable_nfs` | `true` (par défaut) | Critical | Le désactiver supprime tout stockage durable — la base SQLite et les ressources résideraient sur le système de fichiers éphémère de Cloud Run et disparaîtraient à chaque redémarrage de révision. |
| `container_image_source` | `prebuilt` (par défaut) | High | `"custom"` déclenche un Cloud Build inutile sans Dockerfile configuré dans ce module — le build échouera. |
| Accessibilité du sidecar Meilisearch | Vérifier que `MEILI_ADDR` est résolu après le déploiement | Medium | Si le sidecar ne démarre pas, la recherche cesse silencieusement de fonctionner tandis que le reste de l'application fonctionne normalement — un état dégradé facile à manquer. |
| `NEXTAUTH_SECRET` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critical | Sa rotation invalide toutes les sessions utilisateur actives. |
| Variable d'environnement `DATA_DIR` | La définir explicitement (ce module la définit toujours sur `nfs_mount_path`) | Critical | La valeur par défaut propre à Karakeep est une **chaîne vide**, et non `/data` (cette valeur par défaut n'existe que dans le modèle docker-compose amont). Si elle n'est pas définie, les migrations et le fichier SQLite se résolvent silencieusement vers un stockage éphémère au lieu du montage NFS — confirmé en conditions réelles : l'inscription renvoie des erreurs 500 avec `SqliteError: no such table: user` jusqu'à correction. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et simultanéité, entrée et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Karakeep, partagée avec la variante GKE, est décrite dans
**[Karakeep_Common](Karakeep_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Karakeep sur Cloud Run](../labs/Karakeep_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Karakeep sur GKE Autopilot](Karakeep_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Karakeep Common — Configuration applicative partagée](Karakeep_Common.md) — la configuration partagée par les deux cibles de déploiement.
