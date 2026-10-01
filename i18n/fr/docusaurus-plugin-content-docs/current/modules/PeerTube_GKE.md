---
title: "PeerTube sur GKE Autopilot"
description: "Référence de configuration pour déployer PeerTube sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PeerTube_GKE.md @ 3055034 sha256:41d4a8892c0a -->

# PeerTube sur GKE Autopilot {#peertube-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PeerTube_GKE.png" alt="PeerTube sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PeerTube est une plateforme open source d'hébergement vidéo fédérée via ActivityPub — une
alternative auto-hébergée à YouTube dans laquelle des instances exploitées indépendamment se suivent
et fédèrent entre elles vidéos, commentaires et chaînes (ainsi qu'avec le reste du
Fediverse), de la même manière que Mastodon fédère les publications. Ce module déploie
PeerTube sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud utilisés par PeerTube et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

PeerTube s'exécute sous la forme d'un pod Node.js construit sur mesure sur GKE Autopilot, à partir d'un
Dockerfile reposant sur l'image de base officielle `chocobozzz/peertube`, afin qu'un
ARG de build dédié `PEERTUBE_VERSION` puisse épingler une version réelle. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js sur le port 9000 ; 2 vCPU / 2 GiB par défaut (prudent — à augmenter pour un vrai transcodage) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — extensions `pg_trgm`/`unaccent` pré-créées ; PeerTube migre lui-même son schéma ; sidecar Cloud SQL Auth Proxy |
| Cache et file d'attente | Redis | **Obligatoire, et non facultatif** — la file de jobs BullMQ de PeerTube (transcodage, livraison de la fédération, notifications) n'a aucun repli en mémoire |
| Stockage d'objets | Cloud Storage | Un bucket `videos` public (compatible S3, identifiants HMAC) pour les fichiers vidéo et de playlists de streaming ; un bucket `data` privé (GCS FUSE, avec un correctif UID/GID explicite) pour l'état local |
| Secrets | Secret Manager | `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD` et paire de clés d'accès/secrète HMAC S3 générés automatiquement ; mot de passe de la base de données |
| Ingress | Service Kubernetes / Gateway | Service `LoadBalancer` par défaut — doit être public pour la fédération ; domaine personnalisé en option via Kubernetes Gateway |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Redis est obligatoire.** Le transcodage, la livraison de la fédération et le
  pipeline de notifications de PeerTube passent tous par une file de jobs BullMQ intégrée au processus, sans
  aucun repli en mémoire — contrairement à la plupart des modules de ce catalogue, où Redis
  est un réglage facultatif de performance/de scaling. `enable_redis = true` est la
  valeur par défaut et ne doit jamais être désactivé ; une précondition évaluée au plan bloque
  `enable_redis = true` lorsque ni `redis_host` n'est défini ni `enable_nfs = true`.
- **Ce module a corrigé un véritable bug de permissions de stockage propre à GKE.**
  Le point d'entrée fournisseur de PeerTube s'exécute en root et effectue le `chown` de `/data` vers
  l'utilisateur `peertube` (uid/gid **999**) avant d'abandonner les privilèges — ce
  `chown` à l'intérieur du conteneur fonctionne bien avec l'intégration gcsfuse propre à Cloud Run, mais
  **le pilote CSI GCS FUSE de GKE ne le respecte pas**, et le montage reste
  la propriété de root. Voir le §3 pour l'explication complète et le correctif.
- **GKE est la bonne cible pour une charge de transcodage réelle.** Contrairement à la variante
  Cloud Run (volontairement limitée à la VOD/au transcodage léger), le modèle de calcul soutenu de GKE
  et la possibilité offerte par ce module d'augmenter `cpu_limit`/`memory_limit`
  bien au-delà de l'économie de la réduction à zéro en font le meilleur choix pour le transcodage
  en production — la FAQ de PeerTube recommande jusqu'à 8 vCPU / 8Gi.
- **Le streaming en direct RTMP n'est pas raccordé dans cette version — mais il n'est pas bloqué
  architecturalement ici comme il l'est sur Cloud Run.** `enable_live_streaming` vaut par défaut
  `false` et n'a actuellement aucun effet : les services Cloud Run ne peuvent jamais acheminer du
  TCP brut (une limite architecturale absolue), mais le modèle réseau de GKE *peut*
  exposer des ports TCP supplémentaires via des ports de Service LoadBalancer additionnels — ce
  raccordement n'est simplement pas encore implémenté.
- **Le bucket `videos` est volontairement public.** L'architecture même de PeerTube
  exige que les navigateurs récupèrent les fichiers vidéo et de playlists de streaming directement depuis
  le stockage d'objets, sans passer par l'application — le bucket remplace le paramètre
  sécurisé par défaut du socle `public_access_prevention = "enforced"` par
  `"inherited"` afin que l'autorisation requise `allUsers:objectViewer` puisse s'appliquer (le
  même correctif déjà éprouvé sur la variante Cloud Run — voir
  [PeerTube_CloudRun](PeerTube_CloudRun.md) §3).
- **Sur un projet en libre-service géré par RAD, un remplacement de règle d'administration au niveau du projet
  est d'abord appliqué, puis attendu.** Les projets gérés par RAD héritent d'une règle d'administration de dossier
  imposant `constraints/storage.publicAccessPrevention`, qui
  prévaut sur le paramètre au niveau du bucket ci-dessus et réintroduit le même `412`.
  Lorsque `is_self_serve_project = true` (injecté par le serveur — ne le définissez jamais
  manuellement ; il vaut `false` pour un projet ordinaire que vous apportez vous-même, où tout ce
  mécanisme est sans effet), le module remplace cette contrainte au niveau du
  **projet** via le fournisseur guardrails-admin. Le remplacement est lié
  à l'état propre de ce module : détruire le déploiement rétablit donc pour le
  projet la posture appliquée par défaut du dossier.
  **Le remplacement a besoin d'environ 90 s pour se propager avant que l'autorisation sur le bucket
  ne réussisse.** Terraform indique que l'écriture de la règle d'administration est terminée en 0 s, mais
  l'application côté GCP est en retard : l'étape d'apply suivante rencontrait toujours le même `412`,
  même après épuisement du mécanisme intégré de nouvelle tentative IAM du fournisseur (~30 s, `Too many
  conflicts`). Un `time_sleep.wait_for_org_policy_propagation`
  de 90 s s'intercale entre les deux, et l'autorisation sur le bucket dépend de cette attente
  plutôt que directement du remplacement — un apply sur un projet en libre-service
  est donc, par conception, plus lent d'environ 90 s. Confirmé en conditions réelles le 2026-08-06 sur la variante
  Cloud Run, qui provisionne ses buckets par le même chemin du socle.
- **Point délicat : le remplacement porte sur le projet, donc deux variantes PeerTube dans
  un même projet entrent en conflit.** `storage.publicAccessPrevention` n'a pas de
  variante au niveau du bucket une fois appliquée à un niveau supérieur. Si un même projet
  exécute à la fois `PeerTube_GKE` et `PeerTube_CloudRun`, l'état de chaque module
  gère indépendamment le *même* objet de règle au niveau du projet, et
  détruire l'un le retire à l'autre. `solutions.yaml`
  ne sélectionne jamais qu'une seule variante PeerTube par solution ; ce cas est donc rare en
  pratique et n'est pas résolu dans le module.
- **`host` (le domaine de fédération ActivityPub) est immuable après la première utilisation
  réelle.** Laissé vide par défaut pour que le point d'entrée le dérive de l'URL de service
  prévue par App_GKE — fonctionne d'emblée sur un nouveau déploiement. Définissez un
  véritable domaine personnalisé avant toute utilisation en production.
- **Aucun job d'initialisation de l'administrateur n'est nécessaire.** `PT_INITIAL_ROOT_PASSWORD` est
  lu directement depuis `process.env` par le propre `installer.ts` de PeerTube au premier
  démarrage lorsqu'aucun utilisateur n'existe encore — le compte `root` est créé automatiquement.
- **La connexion à la base de données utilise le loopback du Cloud SQL Auth Proxy, sans chiffrement.**
  Contrairement à la variante Cloud Run (qui doit forcer `PEERTUBE_DB_SSL` à
  `true` avec la vérification du certificat désactivée, puisque Cloud Run associe l'IP privée brute de Cloud
  SQL), le mécanisme `db_host_env_var_name` d'App_GKE privilégie le loopback
  `127.0.0.1` du sidecar cloud-sql-proxy lorsqu'il est présent — la valeur par défaut partagée
  `PEERTUBE_DB_SSL="false"` de `PeerTube_Common` est donc déjà
  correcte ici, sans modification.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Les noms des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail PeerTube {#a-gke-autopilot--the-peertube-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez le Deployment.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour Workload Identity, l'autoscaling et les mécanismes
de déploiement progressif.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

PeerTube stocke toutes les données de l'application (comptes, métadonnées des vidéos, commentaires,
abonnements, playlists) dans une instance gérée Cloud SQL for PostgreSQL 15,
accessible via un sidecar Cloud SQL Auth Proxy sur `127.0.0.1`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~peertube"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Redis — la file de jobs BullMQ {#c-redis--the-bullmq-job-queue}

Redis sous-tend la file de jobs de transcodage, de livraison de la fédération et de notifications
de PeerTube. Lorsque `redis_host` est laissé vide, l'IP de la VM du serveur NFS partagé est utilisée
comme hôte Redis par défaut.

- **CLI :**
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -i PEERTUBE_REDIS
  ```

### D. Cloud Storage — `videos` (public) et `data` (privé, GCS FUSE) {#d-cloud-storage--videos-public-and-data-private-gcs-fuse}

Deux buckets GCS sont provisionnés :

- **`videos`** — public (`public_access_prevention = "inherited"`,
  `allUsers:objectViewer`), avec CORS activé, accessible via le client natif
  compatible S3 de PeerTube (AWS SDK) sur le point de terminaison XML d'interopérabilité S3 de GCS, à l'aide
  d'identifiants HMAC issus d'un compte de service dédié. Il contient les cinq classes de stockage d'objets
  de PeerTube (web-videos, streaming-playlists,
  original-video-files, user-exports, captions) sous des préfixes distincts.
- **`data`** — privé, monté via le **pilote CSI GCS FUSE** sur `/data`
  avec les options de montage explicites `uid=999,gid=999,file-mode=664,dir-mode=775`
  (voir le §3 pour comprendre pourquoi c'est indispensable sur GKE). Il contient l'état local de PeerTube
  (hors stockage d'objets) : avatars, miniatures, aperçus, storyboards,
  torrents, plugins, journaux et tmp/cache.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
  gcloud storage ls gs://<videos-bucket>/
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```

Consultez [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Le pod de PeerTube lit `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`
(consulté uniquement au premier démarrage lorsqu'aucun utilisateur n'existe), la paire de clés d'accès/secrète
HMAC S3 et — lorsque SMTP est configuré — un mot de passe SMTP, tous sous forme de
variables d'environnement adossées à des secrets. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~peertube"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails d'injection et de rotation, et
[PeerTube_Common](PeerTube_Common.md) pour la liste complète des secrets.

### F. Réseau et entrée {#f-networking--ingress}

Le Service Kubernetes utilise par défaut `service_type = "LoadBalancer"` (requis
pour la fédération ActivityPub publique et la diffusion des vidéos). Un projet soumis à des contraintes de quota
peut définir `service_type = "ClusterIP"` et vérifier via
`kubectl port-forward` au lieu de consommer du quota d'IP externes/statiques. Une
Kubernetes Gateway avec un domaine personnalisé, Cloud CDN (utile pour la diffusion
vidéo) et Cloud Armor peuvent être ajoutés par-dessus.

- **Console :** Kubernetes Engine → Gateways, Services & Ingress.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application PeerTube {#3-peertube-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute
  `scripts/peertube/db-init.sh` avec `postgres:15-alpine`. Il attend que
  Cloud SQL accepte les connexions, puis crée de manière idempotente le rôle et la
  base de données de l'application, accorde les privilèges et crée les extensions `pg_trgm` et
  `unaccent` en tant que superutilisateur postgres — le guide d'installation de PeerTube
  exige les deux mais ne les crée pas lui-même. Peut être réexécuté sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration distinct.** PeerTube crée et migre lui-même son
  schéma Sequelize automatiquement à chaque démarrage du serveur.
- **Le compte administrateur s'initialise automatiquement — aucun déclenchement manuel n'est nécessaire.**
  Contrairement à certaines applications ActivityPub de ce catalogue (GoToSocial requiert un
  job CLI manuel), le `installer.ts` de PeerTube lit `PT_INITIAL_ROOT_PASSWORD`
  directement depuis `process.env` (et non via node-config, donc sans préfixe `PEERTUBE_`) au
  premier démarrage lorsqu'aucun utilisateur n'existe encore, et crée automatiquement le compte administrateur `root`
  avec ce mot de passe. Pour le récupérer :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~root-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
  Connectez-vous sur `$SERVICE_URL/login` avec le nom d'utilisateur `root`.
- **Le domaine de fédération (`host`) est immuable après une utilisation réelle.**
  `PEERTUBE_WEBSERVER_HOSTNAME` est intégré à chaque URI d'acteur/d'objet ActivityPub
  créé localement dès le premier démarrage du serveur avec des données
  réelles. Lorsque `host` est laissé vide, `docker-entrypoint.sh` le dérive de la variable
  `GKE_SERVICE_URL` propre à App_GKE au démarrage du conteneur — une valeur par défaut fédérée
  fonctionnelle qui ne nécessite aucune décision de domaine avant le déploiement. Définissez un véritable domaine personnalisé
  via `host` avant toute utilisation en production ; le modifier une fois que de vrais comptes/vidéos
  existent nécessite le script de maintenance `update-host` de PeerTube et ne
  corrige pas rétroactivement les URI déjà fédérées.
- **Chemin de vérification d'état.** La sonde de démarrage est en **TCP** sur le port 9000 — les migrations
  DB/Redis de PeerTube et l'initialisation de l'administrateur au premier démarrage peuvent prendre plus de temps que ce
  qu'autorise une fenêtre de disponibilité HTTP classique, et une sonde HTTP visant une API
  pas encore prête empêcherait le pod de devenir Ready. La
  sonde de vivacité utilise le point de terminaison public et non authentifié `GET /api/v1/config`.

### ⚠ Le bug UID/GID de GCS-FUSE — le piège propre à GKE que corrige ce module {#-the-gcs-fuse-uidgid-bug--the-gke-specific-gotcha-this-module-fixes}

Le point d'entrée de l'image fournisseur de PeerTube (`support/docker/production/entrypoint.sh`)
s'exécute en **root** et effectue le `chown` de `/data` vers l'utilisateur `peertube` — uid/gid
**999**, confirmé via `docker run --entrypoint sh chocobozzz/peertube:production
-c "id peertube"` — avant d'abandonner les privilèges pour exécuter le serveur sous cet
utilisateur.

- **Sur Cloud Run**, ce `chown` à l'intérieur du conteneur suffit — l'intégration gcsfuse
  native de Cloud Run le tolère, et le montage finit par appartenir au bon propriétaire
  sans configuration supplémentaire.
- **Sur GKE**, le **pilote CSI GCS FUSE ne respecte pas un
  `chown` effectué à l'intérieur du conteneur.** Sans option de montage `uid=`/`gid=` explicite, le volume
  est monté comme propriété de root et le reste quoi que fasse ensuite le point d'entrée
  — la tentative de PeerTube d'écrire dans son `/data`, désormais
  propriété de root, échoue donc immédiatement :
  ```
  Error: EACCES: permission denied, mkdir '/data/logs'
  ```
  Le pod entre alors dans une boucle de plantages à chaque redémarrage, avant même que le serveur ne se lie
  à son port.

Le local partagé `_peertube_data_volume` de `PeerTube_Common` (dans
`modules/PeerTube_Common/main.tf`, utilisé par **les deux** variantes Cloud Run et GKE)
corrige ce problème en fixant des options de montage explicites :

```hcl
mount_options = [
  "implicit-dirs",
  "stat-cache-ttl=60s",
  "type-cache-ttl=60s",
  "uid=999",
  "gid=999",
  "file-mode=664",
  "dir-mode=775",
]
```

C'est sans effet sur Cloud Run (root y attribue déjà la propriété aux mêmes ID) et
indispensable sur GKE. Il s'agit de la même catégorie de bug déjà rencontrée et corrigée sur
les variantes GKE de Paperless, CodeServer, CloudBeaver et Seerr de ce catalogue
(voir le constat « GKE gcsfuse UID/GID permission denied » du `CLAUDE.md`
du dépôt) — PeerTube en est le cas confirmé le plus récent, et le premier où
l'UID discordant (999, et non le plus courant 1000) provenait du propre `chown` du point d'entrée
fournisseur plutôt que de l'instruction `USER` déclarée par l'image.

**Vérifié en conditions réelles le 2026-07-22 :**

```bash
kubectl get pods -n "$NAMESPACE" -l app=<service-name>
# 3/3 Running, 0 restarts (down from 5 before the fix)

kubectl logs -n "$NAMESPACE" <pod> | head -20
# HTTP server listening on 0.0.0.0:9000
# Creating the administrator ... Username: root

POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /data
# every entry (logs/, avatars/, torrents/, plugins/, ...) owned peertube:peertube

kubectl port-forward -n "$NAMESPACE" "$POD" 19000:9000 &
curl -s http://localhost:19000/api/v1/config | head -c 200      # 200, real JSON
curl -s http://localhost:19000/api/v1/config/about | head -c 200 # 200, real JSON
```

**Signe diagnostique**, si vous observez un jour ce symptôme sur un fork de ce module :

```bash
kubectl describe pod -n "$NAMESPACE" <peertube-pod>
# Look for: Error: EACCES: permission denied, mkdir '/data/logs'
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement
(conformément à l'étiquette `{{UIMeta group=N}}` de chaque variable dans `variables.tf`). Seuls les
paramètres propres à PeerTube ou notables pour celui-ci sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `peertube` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `PeerTube` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Se résout en l'étiquette Docker Hub maintenue `production` via l'ARG de build dédié `PEERTUBE_VERSION` — et non via l'`APP_VERSION` générique du socle (qui l'emporterait sinon lors de la fusion et produirait une étiquette `latest` impossible à résoudre). |
| `host` | `""` | `PEERTUBE_WEBSERVER_HOSTNAME` — le domaine public de fédération. **Immuable après la première utilisation réelle.** Laissé vide, il est dérivé de l'URL de service GKE prévue. |
| `admin_email` | `admin@example.com` | Adresse e-mail attribuée au compte administrateur `root` créé automatiquement. |
| `enable_open_registration` | `false` | Permet aux nouveaux utilisateurs de s'inscrire eux-mêmes. |
| `enable_live_streaming` | `false` | Présente par symétrie de schéma ; non raccordée dans cette version — voir les §1/§3. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une image basée sur un Dockerfile (base `chocobozzz/peertube:${PEERTUBE_VERSION}`) via Cloud Build. |
| `cpu_limit` | `2000m` | Valeur par défaut prudente pour une démonstration ou un usage VOD. La FAQ de PeerTube recommande jusqu'à 8 vCPU pour une charge de transcodage réelle — augmentez-la ici pour un usage en production : c'est la bonne variante pour cela. |
| `memory_limit` | `2Gi` | Valeur par défaut prudente. La FAQ de PeerTube recommande jusqu'à 8Gi pour une charge de transcodage réelle. |
| `container_port` | `9000` | Valeur par défaut native de `PEERTUBE_LISTEN_PORT` dans PeerTube. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | `0` active la réduction à zéro sur le minimum ; `3` est le plafond de coût du HPA. |
| `enable_cloudsql_volume` | `true` | Exécute le sidecar Cloud SQL Auth Proxy ; App_GKE privilégie son loopback `127.0.0.1` pour `PEERTUBE_DB_HOSTNAME`, de sorte que la valeur par défaut `PEERTUBE_DB_SSL="false"` de PeerTube est correcte sans modification (voir le §1). |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Requis par défaut pour la fédération publique ; définissez `ClusterIP` en cas de contrainte de quota d'IP statiques et vérifiez via `kubectl port-forward` (utilisé pour la vérification en conditions réelles de ce module). |
| `session_affinity` | `ClientIP` | Sessions persistantes. |
| `workload_type` | `Deployment` | `StatefulSet` est disponible via `stateful_pvc_enabled`. |

### Groupe 5 — Variables d'environnement, secrets et SMTP {#group-5--environment-variables-secrets--smtp}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair fusionnées avec les valeurs par défaut de `PeerTube_Common`. |
| `secret_environment_variables` | `{}` | Références Secret Manager destinées à l'opérateur. |
| `smtp_host` | `""` | Nom d'hôte SMTP. Une valeur vide désactive l'e-mail ; une valeur non vide provisionne le secret du mot de passe SMTP. |
| `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | `587` / `""` / `""` / `false` / `""` | Configuration SMTP standard, utilisée uniquement lorsque `smtp_host` est défini. `mail_from` vaut par défaut `noreply@<host>` s'il est vide. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne la VM NFS partagée, dont l'IP sert d'hôte Redis par défaut lorsque `redis_host` est vide. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | `PeerTube_Common` fournit les véritables déclarations des buckets `data`/`videos`, en remplaçant la valeur par défaut générique de cette variable, limitée à `data`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires au-delà de `data` (qui intègre déjà le correctif uid=999/gid=999 — voir le §3). |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PeerTube requiert PostgreSQL. |
| `db_name` | `peertube` | La base de données effectivement créée et injectée sous `PEERTUBE_DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `peertube` | Le rôle effectivement créé et injecté sous `PEERTUBE_DB_USERNAME` ; mot de passe généré automatiquement dans Secret Manager. |
| `enable_postgres_extensions` | `true` | Installe `postgres_extensions` après le provisionnement. |
| `postgres_extensions` | `["pg_trgm", "unaccent"]` | Requises par le guide d'installation de PeerTube ; non créées par PeerTube lui-même. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — ne jamais désactiver. PeerTube n'a aucun repli en mémoire pour BullMQ. Une précondition évaluée au plan bloque `enable_redis=true` sans `redis_host` ni `enable_nfs`. |
| `redis_host` | `""` | Laissez vide pour utiliser par défaut l'IP du serveur NFS. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` fourni par `PeerTube_Common`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Lorsqu'elle vaut `true`, App_GKE monte un véritable PVC en mode bloc sur `/data` au lieu de GCS FUSE, et le raccordement propre à `PeerTube_GKE` (`peertube.tf`) désactive automatiquement le volume GCS FUSE pour éviter un double montage. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 9000 | Confirme que le port est lié ; les migrations DB/Redis de PeerTube et l'initialisation de l'administrateur se terminent avant que l'API HTTP ne soit réellement prête. |
| `liveness_probe` | HTTP `/api/v1/config`, délai initial de 60 s | Le point de terminaison de configuration public et non authentifié. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Test de disponibilité Cloud Monitoring — pertinent uniquement lorsque `service_type = "LoadBalancer"` ou qu'un domaine personnalisé est configuré. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` / `namespace` | Nom et espace de noms du Service Kubernetes. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne ; IP externe du LoadBalancer (lorsqu'elle est réservée). |
| `service_url` | URL d'accès à PeerTube. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | `127.0.0.1` via le sidecar Cloud SQL Auth Proxy / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`data`, `videos`). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` | État du monitoring. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` | Identifiant du projet. |
| `cicd_enabled` / `artifact_registry_repository` | État du CI/CD et dépôt Artifact Registry. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |
| `vpc_sc_enabled` / `audit_logging_enabled` | État de VPC-SC et de la journalisation d'audit. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `mount_options` GCS FUSE de `/data` | Conserver le correctif `uid=999`/`gid=999` de `PeerTube_Common` | **Critique** | Sans lui, le pod entre dans une boucle de plantages avec `Error: EACCES: permission denied, mkdir '/data/logs'` à chaque redémarrage — un mode de défaillance propre à GKE, absent sur Cloud Run (voir le §3). |
| `host` (`PEERTUBE_WEBSERVER_HOSTNAME`) | Définir votre domaine réel avant la première utilisation réelle | Critique | Intégré à chaque URI d'acteur/d'objet ActivityPub au moment de sa création ; le modifier une fois que de vrais comptes/vidéos existent casse la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `enable_redis` | `true` (ne jamais désactiver) | Critique | PeerTube n'a aucun repli en mémoire pour BullMQ — le transcodage, la livraison de la fédération et les notifications cessent tous de fonctionner sans Redis. |
| `public_access_prevention` du bucket `videos` | `"inherited"` (défini par `PeerTube_Common`, ne pas remplacer par `"enforced"`) | Critique | L'architecture de PeerTube exige que les navigateurs récupèrent les fichiers vidéo directement depuis le stockage d'objets ; `"enforced"` bloque l'autorisation requise `allUsers:objectViewer` avec une erreur `412` au moment de l'apply. |
| `database_type` | `POSTGRES_15` | Critique | PeerTube requiert PostgreSQL ; les extensions `pg_trgm`/`unaccent` et le schéma Sequelize sont propres à Postgres. |
| `startup_probe` | Conserver `type = "TCP"` | Élevé | Les migrations DB/Redis de PeerTube et l'initialisation de l'administrateur prennent plus de temps que ce qu'autorise une fenêtre de disponibilité HTTP classique ; une sonde HTTP visant une API pas encore prête peut empêcher le pod de devenir Ready. |
| `cpu_limit` / `memory_limit` | Augmenter nettement pour une charge de transcodage réelle | Élevé | Les valeurs par défaut `2000m`/`2Gi` sont volontairement prudentes pour une démonstration ou un usage VOD ; la FAQ de PeerTube recommande jusqu'à 8 vCPU/8Gi pour un transcodage réel en production — des ressources sous-dimensionnées bloquent ou font échouer les jobs de transcodage. |
| `stateful_pvc_enabled` | Laisser à `false`, sauf si vous avez besoin de garanties de verrouillage en écriture d'un stockage en mode bloc pour `/data` | Moyen | L'activer bascule `/data` sur un véritable PVC et désactive automatiquement le volume GCS FUSE — combiner les deux entraînerait un double montage du chemin. |
| `service_type` | `LoadBalancer` pour la fédération publique ; `ClusterIP` uniquement en cas de réelle contrainte de quota d'IP | Moyen | `ClusterIP` rend l'instance inaccessible depuis l'extérieur du cluster — acceptable pour une vérification via `kubectl port-forward`, inadapté à une instance fédérée de production. |
| `enable_open_registration` | `false` pour la plupart des déploiements | Moyen | Laisser l'inscription ouverte sur une instance publique permet à quiconque dispose de l'URL de créer un compte et de téléverser du contenu vidéo. |
| `enable_iap` | `false` pour une instance publique | Moyen | IAP bloque le trafic de fédération ActivityPub non authentifié et la consultation publique des vidéos — ne convient qu'à une instance entièrement privée ou de test. |
| Secret `PT_INITIAL_ROOT_PASSWORD` | Récupérer et conserver en lieu sûr après le premier déploiement | Moyen | C'est le seul identifiant du compte administrateur `root` ; il n'est ni régénéré ni réappliqué une fois le compte existant. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à PeerTube partagée avec la variante Cloud Run est définie dans
**[PeerTube_Common](PeerTube_Common.md)** (source du module :
`modules/PeerTube_Common`). Consultez également le guide de la variante Cloud Run,
**[PeerTube_CloudRun](PeerTube_CloudRun.md)**, pour l'explication de l'accès public au bucket de stockage,
commune aux deux plateformes.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PeerTube sur GKE Autopilot](../labs/PeerTube_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md) — la même application sur Cloud Run, si vous avez besoin de l'autre cible de déploiement.
- [PeerTube Common — Configuration applicative partagée](PeerTube_Common.md) — la configuration partagée par les deux cibles de déploiement.
