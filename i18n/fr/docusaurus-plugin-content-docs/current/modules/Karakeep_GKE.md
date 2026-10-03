---
title: "Karakeep sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Karakeep sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Karakeep_GKE.md @ 15fd4c7 sha256:5e4bb81a51bf -->

# Karakeep sur GKE Autopilot {#karakeep-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Karakeep_GKE.png" alt="Karakeep sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Karakeep est une application open-source et auto-hébergeable pour tout
marquer (liens, notes et images) avec un étiquetage automatique basé sur l'IA
et une recherche sémantique/en texte intégral. Ce module déploie Karakeep sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Karakeep et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Karakeep s'exécute comme une charge de travail web Next.js, associée à un
Service sidecar Meilisearch obligatoire pour la recherche. Contrairement à la
plupart des applications de ce catalogue, elle n'utilise **aucune base de
données relationnelle externe** — tout l'état réside dans une base de données
SQLite embarquée, plus les actifs téléchargés sur le volume NFS partagé de la
plateforme :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Next.js, 1 vCPU / 512 MiB par défaut, épinglé à un seul réplica |
| Recherche | GKE Autopilot (Service interne) | Un sidecar Meilisearch requis, déployé automatiquement — non optionnel |
| Base de données | aucune | L'état réside dans une base de données SQLite embarquée, pas Cloud SQL |
| Stockage d'objets | aucun (NFS à la place) | Les actifs téléchargés persistent sur le volume NFS partagé de la plateforme, pas GCS |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `MEILI_MASTER_KEY` auto-générés |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** `database_type = "NONE"` — la base de données SQLite embarquée de Karakeep
  et les actifs téléchargés résident tous deux sur le volume NFS partagé de la
  plateforme.
- **Un seul réplica.** `max_instance_count = 1` — plusieurs pods écrivant le même fichier SQLite
  sur NFS risquent une corruption même avec le mode WAL désactivé.
- **Stratégie de déploiement `Recreate` appliquée automatiquement.** La Fondation
  détecte les applications basées sur NFS et utilise `Recreate` au lieu de
  `RollingUpdate`, évitant ainsi le blocage de deux pods s'exécutant brièvement qu'une
  mise à jour glissante provoquerait autrement.
- **Meilisearch est obligatoire, pas optionnel.** Déployé automatiquement comme
  un Service Kubernetes interne uniquement. Sans lui, `MEILI_ADDR` de Karakeep
  n'est pas défini et la recherche est silencieusement désactivée.
- **Pas de build de conteneur personnalisé.** Le mode journal SQLite de Karakeep
  est déjà par défaut le mode `DELETE` sûr pour NFS — l'image officielle
  pré-construite est déployée telle quelle.
- **Pas de credential d'amorçage administrateur.** Le premier compte créé via
  le formulaire d'inscription de l'interface web devient l'administrateur.
- **`NEXTAUTH_URL` utilise la substitution native `$(VAR)` de Kubernetes** —
  `$(GKE_SERVICE_URL)` se résout à la valeur injectée par la Fondation au démarrage du
  conteneur (contrairement à Cloud Run, où `$(VAR)` est passé littéralement).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Karakeep {#a-gke-autopilot--the-karakeep-workload}

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Karakeep. Kubernetes Engine → Services & Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail.

### B. Meilisearch (sidecar requis) {#b-meilisearch-required-sidecar}

Déployé automatiquement comme un Service Kubernetes séparé, interne uniquement.
Son URL est auto-injectée dans `MEILI_ADDR` de l'application principale. Son
index réside sur le stockage éphémère du sidecar — les services
supplémentaires ne partagent pas le volume NFS de l'application principale — et
se reconstruit à partir de zéro à chaque redémarrage. Cela n'affecte que la
disponibilité de la recherche, pas la sécurité des données ; les signets
persistent sur `/data` monté sur NFS de l'application principale.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -l app=meilisearch
  kubectl logs -n "$NAMESPACE" deploy/<service>-meilisearch --tail=50
  ```

### C. NFS (Cloud Filestore ou la VM NFS+Redis auto-gérée) {#c-nfs-cloud-filestore-or-the-self-managed-nfsredis-vm}

La base de données SQLite embarquée de Karakeep et ses actifs téléchargés
résident tous deux sur le volume NFS partagé de la plateforme, monté sur
`/data`.

- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement : `NEXTAUTH_SECRET` et `MEILI_MASTER_KEY`.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

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

- **Pas de Job de configuration de base de données au premier déploiement.**
  Karakeep gère son propre schéma SQLite en interne au démarrage.
- **Pas de credential d'amorçage administrateur à récupérer.** Le premier
  compte créé via l'interface web devient l'administrateur.
- **La recherche dépend de la joignabilité du sidecar.** Si le Service
  Meilisearch ne démarre pas, la recherche cesse silencieusement de fonctionner
  ; la mise en signet continue.
- **Chemin de santé.** La sonde de démarrage cible `/` ; la sonde de
  vivacité (`health_check_config`) cible `/api/health`, qui renvoie un 200 littéral.
  `/` redirige vers `/signin` (307), et le chemin de vivacité est
  répliqué dans le contrôle de santé de la passerelle, qui traite une
  redirection comme non saine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Karakeep sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `karakeep` | Nom de base des ressources. |
| `application_version` | `latest` | Correspond à la balise `"release"` de Karakeep. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Pas de build personnalisé nécessaire. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Réplica unique épinglé pour la sécurité de SQLite sur NFS. |
| `container_port` | `3000` | Port natif par défaut de Karakeep. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — la base de données SQLite de Karakeep et ses actifs y résident. |
| `nfs_mount_path` | `"/app/data"` | Le module définit `DATA_DIR` à ce chemin. La variante Cloud Run utilise `/data` à la place — les deux fonctionnent, car `DATA_DIR` suit toujours le montage. |
| `stateful_pvc_enabled` | `null` | Non défini, donc la propre logique de résolution de `App_GKE` s'applique (pas de PVC). Karakeep utilise NFS, pas un PVC de bloc. |

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
| `service_external_ip` | IP du LoadBalancer externe. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Vide — non applicable. |
| `storage_buckets` | Vide — Karakeep persiste via NFS. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `max_instance_count` | `1` (par défaut épinglé) | Critique | Augmenter cela risque une corruption de SQLite due à des rédacteurs NFS concurrents. |
| Premier compte créé via l'inscription | Créez-le immédiatement après le déploiement | Critique | Le premier compte à s'inscrire devient administrateur. |
| `enable_nfs` | `true` (par défaut) | Critique | Le désactiver supprime tout stockage durable. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module. |
| Joignabilité du sidecar Meilisearch | Vérifiez que `MEILI_ADDR` est résolu après le déploiement | Moyen | La recherche cesse silencieusement de fonctionner si le sidecar ne démarre pas. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives. |
| Variable d'environnement `DATA_DIR` | Définir explicitement (ce module la définit toujours à `nfs_mount_path`) | Critique | La valeur par défaut de Karakeep est une **chaîne vide**, pas `/data` (cette valeur par défaut n'existe que dans le modèle docker-compose en amont). Si elle n'est pas définie, les migrations et le fichier SQLite se résolvent silencieusement en stockage éphémère au lieu du montage NFS. |
| Format de la valeur `additional_services[].secret_env_vars` | Nom de clé simple (par exemple `"MEILI_MASTER_KEY"`) | Élevé | Le magasin de secrets K8s consolidé par locataire de GKE stocke les clés nommées d'après la variable d'environnement elle-même — **pas** la chaîne brute `secret_id` de Secret Manager (c'est la convention Cloud Run). L'utilisation du mauvais format provoque `CreateContainerConfigError: couldn't find key <secret_id> in Secret <prefix>-secrets`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Karakeep partagée avec la variante
Cloud Run est décrite dans **[Karakeep_Common](Karakeep_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Karakeep sur GKE Autopilot](../labs/Karakeep_GKE.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Karakeep sur Google Cloud Run](Karakeep_CloudRun.md) — la même application
  sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Karakeep Common — Configuration d'application partagée](Karakeep_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
