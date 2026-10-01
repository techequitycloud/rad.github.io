---
title: "Ghostfolio sur GKE Autopilot"
description: "Référence de configuration pour déployer Ghostfolio sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ghostfolio_GKE.md @ 3055034 sha256:91e1456162bf -->

# Ghostfolio sur GKE Autopilot {#ghostfolio-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghostfolio_GKE.png" alt="Ghostfolio sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghostfolio est une application open source de gestion de patrimoine sous licence
AGPL, qui permet de suivre la valeur nette, les portefeuilles d'investissement et
l'allocation d'actifs sur plusieurs comptes de courtage et plateformes — une
alternative respectueuse de la vie privée aux outils commerciaux de suivi de
portefeuille. Ce module déploie Ghostfolio sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Ghostfolio et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Ghostfolio s'exécute comme une charge de travail web NestJS (ORM Prisma). Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | API NestJS + frontend Angular, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — l'ORM Prisma de Ghostfolio ne prend pas en charge MySQL |
| Cache et file d'attente | Redis (**obligatoire**, pas facultatif) | Mise en cache des données de marché, sessions et gestion des files/jobs Bull |
| Secrets | Secret Manager | `ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | Service `LoadBalancer` externe par défaut ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; l'ORM Prisma de Ghostfolio ne prend pas en charge
  d'autres moteurs.
- **Redis est obligatoire, pas facultatif.** Le point de terminaison de santé de
  Ghostfolio vérifie directement la connectivité Redis, de sorte que l'application
  ne se déclare jamais en bonne santé sans lui.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Tous deux bloquent le démarrage. Faire tourner
  `ACCESS_TOKEN_SALT` après le premier démarrage invalide tous les Security Tokens
  anonymes émis auparavant.
- **Aucun compte administrateur prédéfini.** Le premier visiteur de l'URL déployée
  clique sur « Get Started » et l'application génère un Security Token aléatoire en
  tant que propriétaire du compte — il n'y a ni formulaire e-mail/mot de passe ni
  assistant de premier lancement à remplir.
- **`service_type = "LoadBalancer"` par défaut.** Ghostfolio est une interface web
  destinée au navigateur ; contrairement aux applications purement internes (bases
  de données, outils d'administration), il a donc besoin d'un Service joignable
  publiquement.
- **Aucun stockage de fichiers/médias en masse n'est provisionné.** `enable_nfs`
  vaut `false` par défaut et `storage_buckets` est toujours vide.
- **`DATABASE_URL` est composée à l'exécution.** La chaîne de connexion Prisma de
  Ghostfolio est un DSN de type URL ; sur GKE, le point d'entrée cloud utilise le
  loopback `127.0.0.1` du sidecar cloud-sql-proxy avec `sslmode=disable` lorsque
  `enable_cloudsql_volume = true` (la valeur par défaut).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Les noms des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Ghostfolio {#a-gke-autopilot--the-ghostfolio-workload}

Ghostfolio s'exécute comme un Deployment Kubernetes derrière un Service. Autopilot
gère automatiquement le provisionnement des nœuds et le placement des pods.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le Deployment.
- **CLI :**
  ```bash
  kubectl get deployment -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe deployment <deployment-name> -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=<app-label> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la mise à l'échelle, la stratégie de
déploiement progressif et les budgets d'interruption de pods.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Ghostfolio stocke toutes les données applicatives dans une instance gérée Cloud SQL
for PostgreSQL 15, jointe via un sidecar cloud-sql-proxy à l'écoute sur `127.0.0.1`.
Au premier déploiement, un Job d'initialisation crée la base de données et le rôle
de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Redis (obligatoire) {#c-redis-required}

Redis prend en charge la mise en cache des données de marché, les sessions et la
gestion des files/jobs Bull.

- **CLI :**
  ```bash
  kubectl exec -it -n "$NAMESPACE" <pod-name> -- sh -c 'echo -e "PING\r" | nc $REDIS_HOST $REDIS_PORT'
  # Confirm the pod's injected Redis env vars:
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep REDIS
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement : `ACCESS_TOKEN_SALT` et
`JWT_SECRET_KEY`. Le mot de passe de la base de données est géré séparément par le
socle et synchronisé dans le cluster via `SecretSync`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le Service `LoadBalancer` par défaut expose une IP externe. Un Ingress Kubernetes
avec un domaine personnalisé et un certificat géré peut être ajouté via
`enable_custom_domain`.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont transmis automatiquement à Cloud Logging par
l'agent de journalisation GKE ; les métriques sont transmises à Cloud Monitoring.

- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" resource.labels.namespace_name="'"$NAMESPACE"'"' --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ghostfolio {#3-ghostfolio-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine` et crée de façon
  idempotente le rôle, la base de données et les droits de l'application.
- **Les migrations et l'alimentation initiale s'exécutent à CHAQUE démarrage du
  conteneur**, dans le même processus que le serveur. Le `docker/entrypoint.sh`
  amont exécute `prisma migrate deploy`, puis `prisma db seed`, puis démarre le
  serveur — une migration en échec fait planter le conteneur de façon visible au
  lieu de livrer un pod en bonne santé face à une base vide.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont immuables après le premier
  démarrage.** Faire tourner `ACCESS_TOKEN_SALT` invalide tous les Security Tokens
  émis auparavant. Faire tourner `JWT_SECRET_KEY` déconnecte tout le monde.
- **Aucun formulaire de premier lancement à remplir.** Le premier visiteur génère
  son propre Security Token via « Get Started » — aucune étape d'amorçage
  administrateur n'est nécessaire.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /api/v1/health`, qui vérifie À LA FOIS les connexions à la base de données ET
  à Redis et renvoie `503` tant que les deux ne sont pas opérationnelles.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Ghostfolio ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | `ghostfolio/ghostfolio` sur Docker Hub publie un vrai tag `latest` — épinglez une version pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | 1 vCPU / 1 GiB suffit pour un usage typique. |
| `container_port` | `3333` | Le `DEFAULT_PORT` de Ghostfolio. |
| `enable_cloudsql_volume` | `true` | Exécute le sidecar cloud-sql-proxy ; `DB_IP` se résout en `127.0.0.1` et le point d'entrée cloud utilise `sslmode=disable`. |
| `container_image_source` | `custom` | Cloud Build enveloppe l'image préconstruite `ghostfolio/ghostfolio` avec un point d'entrée cloud léger. |

### Groupe 6 — Placement Kubernetes et réseau {#group-6--kubernetes-placement--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Ghostfolio est une interface web destinée au navigateur — ne passez pas à `ClusterIP` sans chemin d'entrée distinct. |
| `namespace_name` | (généré automatiquement) | Espace de noms Kubernetes. |

### Groupe 15 — Base de données {#group-15--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `ghostfolio` | Nom de la base PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `ghostfolio` | Utilisateur de la base de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 13 — Jobs et NFS {#group-13--jobs--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Pas de job de migration distinct — les migrations s'exécutent dans le conteneur de l'application à chaque démarrage. |
| `enable_nfs` | `false` | Inutile — Ghostfolio n'a pas de stockage de fichiers/médias en masse. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/v1/health`, 30s delay, 12-failure threshold | Vérifie À LA FOIS la connectivité à la base de données ET à Redis. |
| `health_check_config` | HTTP `/api/v1/health`, 30s delay, 3-failure threshold | Même point de terminaison que la sonde de démarrage. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | OBLIGATOIRE — toujours transmis inconditionnellement, jamais conditionné à `redis_host != ""`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis (sensible). Repris à l'exécution dans la variable d'environnement `REDIS_PASSWORD` propre à Ghostfolio. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `service_url` | URL de l'application déployée (IP du LoadBalancer, domaine personnalisé ou DNS interne). |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `storage_buckets` | Toujours vide — Ghostfolio n'a besoin d'aucun stockage de fichiers/médias en masse. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Le faire tourner invalide tous les Security Tokens émis auparavant. |
| `JWT_SECRET_KEY` (généré automatiquement) | Ne le faire tourner que pendant une fenêtre de maintenance | Critique | Le faire tourner invalide toutes les sessions actives. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_redis` | `true`, toujours transmis inconditionnellement | Critique | Sans lui, le point de terminaison de santé de Ghostfolio ne se déclare jamais en bonne santé. |
| `service_type` | `LoadBalancer` | Élevé | Passer à `ClusterIP` sans chemin d'entrée distinct rend l'application injoignable depuis l'extérieur du cluster. |
| `enable_cloudsql_volume` | `true` | Élevé | Le désactiver supprime le sidecar proxy : `DB_IP` revient alors à l'IP privée brute et la logique `sslmode` du point d'entrée cloud ne correspond plus à une connexion loopback. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'importation. |

---

Pour le comportement du socle évoqué tout au long de cette page — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Ghostfolio, partagée avec la variante Cloud
Run, est décrite dans **[Ghostfolio_Common](Ghostfolio_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ghostfolio sur GKE Autopilot](../labs/Ghostfolio_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ghostfolio Common — Configuration applicative partagée](Ghostfolio_Common.md) — la configuration partagée par les deux cibles de déploiement.
