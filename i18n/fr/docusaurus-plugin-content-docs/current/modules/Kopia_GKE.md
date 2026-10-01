---
title: "Kopia sur GKE Autopilot"
description: "Référence de configuration pour déployer Kopia sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Kopia_GKE.md @ 3055034 sha256:1a6517e17f06 -->

# Kopia sur GKE Autopilot {#kopia-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kopia_GKE.png" alt="Kopia sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kopia est un outil de sauvegarde open source rapide et sécurisé, avec chiffrement
côté client, compression et déduplication. Ce module exécute Kopia en **mode
serveur de dépôt** sur **GKE Autopilot** : un serveur unique, toujours joignable,
auquel des clients CLI `kopia` distants se connectent pour envoyer et récupérer des
snapshots chiffrés, adossé nativement à un bucket Cloud Storage — en s'appuyant sur
le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Kopia et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et cycle de vie du déploiement — reportez-vous
au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

**Il n'existe pas de `Kopia_CloudRun`.** Le protocole de snapshot client-serveur de
Kopia repose exclusivement sur gRPC, qui n'obtient un véritable HTTP/2 qu'au travers
du TLS+ALPN propre à Kopia — le GFE de Cloud Run termine toujours le HTTPS public à
sa propre périphérie et ne peut jamais transmettre un flux TLS terminé par le
conteneur ; une variante Cloud Run (construite, déployée et testée en conditions
réelles) a donc échoué à chaque véritable session de snapshot. Consultez
[Kopia_Common](Kopia_Common.md) pour l'analyse complète, confirmée par le code
source.

---

## 1. Vue d'ensemble {#1-overview}

Kopia s'exécute comme une charge de travail GKE Autopilot à pod unique, son dépôt
résidant nativement dans Cloud Storage — pas de base de données, pas de volume de
données monté en système de fichiers pour les sauvegardes elles-mêmes :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod serveur Go, 1 vCPU / 1 GiB par défaut ; un seul réplica de Deployment |
| Stockage du dépôt | Cloud Storage (API GCS native, pas un montage) | Tous les snapshots jamais écrits, sous un préfixe d'objet `repository/` |
| Persistance du certificat TLS | Cloud Storage (montage GCS FUSE sur `/var/lib/kopia`) | Même bucket, préfixe `tls/` — certificat/clé autosignés, générés une seule fois |
| Secrets | Secret Manager | Deux secrets indépendants : `ADMIN_PASSWORD` (connexion) et `REPO_PASSWORD` (clé de chiffrement du dépôt) |
| Entrée | LoadBalancer / Cloud Load Balancing | Externe par défaut (les clients distants doivent pouvoir l'atteindre) ; simple relais TCP L4 — Kopia termine son propre TLS |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Pas de base de données, pas de montage de système de fichiers pour les
  données.** Le dépôt de Kopia est écrit directement par le client d'API GCS natif
  de Kopia (authentifié par ADC) — le bucket n'est pas monté comme système de
  fichiers pour les données de sauvegarde. `database_type = "NONE"`.
- **Un bucket, deux rôles.** Le même bucket `storage` est également monté via FUSE
  sur `/var/lib/kopia`, uniquement pour conserver le certificat TLS autosigné entre
  les redémarrages (préfixe `tls/` — n'entre jamais en collision avec
  `repository/`).
- **Kopia termine son propre TLS.** C'est nécessaire, car le Service
  `LoadBalancer` L4 simple de GKE n'a pas de périphérie terminant le HTTP (à la
  différence du GFE de Cloud Run). Le certificat est généré une seule fois, au
  premier démarrage ; chaque démarrage suivant réutilise le même certificat
  persisté (Kopia refuse de régénérer face à un fichier de certificat existant).
  L'empreinte SHA256 dont chaque client a besoin s'affiche une seule fois, dans les
  journaux, au moment de la génération.
- **Deux secrets indépendants, non interchangeables.** `ADMIN_PASSWORD` protège
  l'interface Web et l'API de contrôle, et peut être renouvelé sans risque.
  `REPO_PASSWORD` est la clé de chiffrement du contenu du dépôt lui-même, définie
  une fois au premier déploiement — la renouveler indépendamment du contenu réel du
  dépôt rend définitivement orphelins tous les snapshots existants.
- **Une véritable session client exige plus que l'authentification HTTP Basic.**
  Le point d'entrée provisionne, à chaque démarrage, un utilisateur stocké dans le
  dépôt (`<ADMIN_USERNAME>@kopia`) avec les ACL activées — indispensable pour une
  véritable session de snapshot gRPC, que la seule couche `ADMIN_PASSWORD`
  n'autorise pas.
- **Port `51515`, LoadBalancer par défaut.** Le port serveur natif de Kopia est
  fixé par `Kopia_Common` ; `service_type` vaut `LoadBalancer` par défaut, puisque
  l'accessibilité externe depuis des clients distants est toute la raison d'être de
  ce module.
- **Serveur unique, compatible avec la mise à zéro.** `max_instance_count` doit
  rester à `1` (la maintenance du dépôt suppose qu'un seul serveur en est
  propriétaire) ; `min_instance_count = 0` est sans risque, car le dépôt réside dans
  Cloud Storage et non sur un volume local à l'instance.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kopia {#a-gke-autopilot--the-kopia-workload}

Kopia s'exécute dans un seul pod (Deployment par défaut ; StatefulSet est disponible
mais inutile — voir §4).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Kopia pour voir le pod et les événements.
- **CLI :**
  ```bash
  kubectl get deployment,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour le fonctionnement de la planification
Autopilot et de Workload Identity.

### B. Cloud Storage — le dépôt (pas de Cloud SQL) {#b-cloud-storage--the-repository-no-cloud-sql}

Il n'y a **aucune instance Cloud SQL** — `database_type = "NONE"`. Les données du
dépôt de Kopia sont écrites directement dans le bucket `storage` par le client
d'API GCS natif de Kopia, sous le préfixe d'objet `repository/` :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls -r gs://<storage-bucket>/repository/ | head
```

Le même bucket est également monté via FUSE sur `/var/lib/kopia`, uniquement pour
conserver le certificat TLS autosigné sous un préfixe `tls/` distinct (voir §D) —
les deux n'entrent jamais en collision.

### C. Secret Manager — deux secrets indépendants {#c-secret-manager--two-independent-secrets}

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~repo-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

`ADMIN_PASSWORD` protège l'interface Web et l'API de contrôle ; `REPO_PASSWORD` est
la clé de chiffrement du contenu du dépôt et l'identifiant avec lequel un véritable
client se connecte. Consultez
[Kopia_Common §2](Kopia_Common.md#2-two-independent-secrets-in-secret-manager) pour
le détail complet de la raison pour laquelle ils ne sont pas interchangeables.

### D. Certificat TLS — autosigné, persisté {#d-tls-certificate--self-signed-persisted}

```bash
# From the pod's first-boot logs (fingerprint prints once, at generation time):
kubectl logs <pod> -n "$NAMESPACE" -c kopia | grep -A2 -i fingerprint

# Recompute at any time (GKE gives real shell access, unlike Cloud Run):
kubectl exec <pod> -n "$NAMESPACE" -c kopia -- \
  openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
```

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est un Service **LoadBalancer**, externe et
joignable d'emblée par des clients CLI `kopia` distants. Il s'agit d'un **simple
relais TCP L4** — sans périphérie terminant le HTTP — si bien que le TLS propre à
Kopia atteint le client de bout en bout.

```bash
kubectl get svc -n "$NAMESPACE"    # confirm the external port -> 51515 mapping
gcloud compute addresses list --project "$PROJECT"
```

> **Le port externe du Service vaut `80` par défaut, et non `51515`.** `Kopia_GKE`
> n'expose pas la variable `service_port` d'`App_GKE` ; elle prend donc toujours la
> valeur par défaut d'`App_GKE` (`80`) ; le `target_port` du Service est le port réel
> de Kopia (`51515`). Comme il s'agit d'un simple relais TCP, le TLS de Kopia se
> termine toujours correctement de bout en bout — mais un client doit se connecter
> explicitement à `https://<external-ip>:80` (`https://` seul implique le port 443,
> qui n'est pas ouvert). Confirmez toujours la correspondance réelle avec
> `kubectl get svc` avant de connecter un client.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
à Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

Un `uptime_check_config` est disponible mais **désactivé par défaut** — si vous
l'activez, sachez qu'il effectue une vérification HTTP, et Kopia n'a aucun point de
terminaison HTTP non authentifié à cibler : la vérification échouera donc en
permanence.

---

## 3. Comportement de l'application Kopia {#3-kopia-application-behaviour}

- **Connexion ou création du dépôt à chaque démarrage.** Le point d'entrée exécute
  `kopia repository connect gcs --bucket=... --prefix=repository/`, avec repli sur
  `kopia repository create gcs ...` si le dépôt n'existe pas encore. Cette logique
  idempotente remplace entièrement ce que ferait sinon la tâche d'initialisation
  d'une application à base de données — il n'existe pas de tâche de
  migration/initialisation distincte pour Kopia.
- **Utilisateur stocké dans le dépôt + ACL, provisionnés à chaque démarrage.**
  `kopia server users
  add/set "${ADMIN_USERNAME}@kopia" --user-password="${REPO_PASSWORD}"` suivi de
  `kopia server acl enable`, tous deux idempotents (ajout-ou-mise à jour /
  activation-ou-ignorer). C'est ce qui autorise réellement la session de snapshot
  gRPC d'un client — l'authentification HTTP Basic (`ADMIN_PASSWORD`) seule ne le
  fait pas.
- **TLS généré une fois, réutilisé indéfiniment.** Premier démarrage : aucun
  fichier de certificat persisté → `--tls-generate-cert`, empreinte affichée une
  seule fois dans les journaux. Chaque démarrage suivant : fichiers de certificat
  trouvés dans `/var/lib/kopia/tls/` → réutilisés tels quels, sans régénération
  (Kopia refuse de régénérer face à un fichier de certificat existant).
- **Commande de connexion du client** — le flux exact, vérifié en conditions
  réelles :
  ```bash
  kopia repository connect server \
    --url=https://<external-ip>:<service-port> \
    --server-cert-fingerprint=<sha256-fingerprint> \
    --password=<REPO_PASSWORD> \
    --override-username=admin --override-hostname=kopia
  ```
  plus les variables d'environnement `KOPIA_SERVER_USERNAME=admin` /
  `KOPIA_SERVER_PASSWORD=<ADMIN_PASSWORD>` pour la couche externe
  d'authentification HTTP Basic qu'utilisent l'interface Web et l'API de contrôle.
  Notez que le mot de passe utilisé pour la *connexion au dépôt* est
  `REPO_PASSWORD`, et non `ADMIN_PASSWORD` — voir
  [Kopia_Common §4](Kopia_Common.md#4-the-third-mechanism--a-repository-stored-user--acls).
- **Maintenance du dépôt à écrivain unique.** Le GC et le compactage propres à
  Kopia supposent qu'un seul serveur possède le dépôt à un instant donné — gardez
  `max_instance_count = 1`.
- **La mise à zéro ne met pas les données en danger.** Le dépôt réside dans Cloud
  Storage, et non sur un volume local à l'instance ; un démarrage à froid se
  contente donc de se reconnecter (et, lors du tout premier démarrage, de régénérer
  le certificat TLS).
- **Les mises à jour recréent le pod.** Un changement de version reconstruit
  l'image personnalisée et recrée le pod unique ; la logique de
  connexion-ou-création/utilisateur/ACL du point d'entrée s'exécute à nouveau sur le
  nouveau pod, sans traitement particulier.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Kopia ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard. Consultez le
`modules/Kopia_GKE/README.md` pour la référence exhaustive des entrées, groupe par
groupe.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez `gke` pour l'exécuter à côté d'une variante Cloud Run d'une autre application sur le même tenant. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kopia` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Kopia ; `latest` épingle le build sur `0.23.1` (Docker Hub, et non GHCR — aucune ambiguïté de préfixe `v` ici). |
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Les envois et restaurations de snapshots sont limités par le CPU (compression, chiffrement, hachage) — augmentez pour des tâches de sauvegarde volumineuses ou fréquentes. |
| `memory_limit` | `1Gi` | L'empreinte propre de Kopia est modeste ; une marge supplémentaire profite au cache de contenu sur les dépôts comportant de nombreux snapshots ou des snapshots volumineux. |
| `min_instance_count` | `0` | La mise à zéro est sans risque — le dépôt réside dans Cloud Storage. |
| `max_instance_count` | `1` | Gardez `1` — la maintenance du dépôt de Kopia suppose qu'un seul serveur en est propriétaire. |
| `enable_cloudsql_volume` | `false` | Kopia n'utilise pas Cloud SQL — gardez `false`. |
| `enable_image_mirroring` | `true` | Duplique l'image Kopia construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires en texte clair, fusionnés avec la valeur par défaut du module `ADMIN_USERNAME=admin`. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées comme variables d'environnement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessibilité externe par défaut — les clients distants doivent pouvoir atteindre ce serveur. N'utilisez `ClusterIP` que lorsque tous les clients s'exécutent déjà dans le même cluster/VPC. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` uniquement si `stateful_pvc_enabled = true` (non recommandé — voir le groupe 7). |
| `termination_grace_period_seconds` | `60` | Secondes entre SIGTERM et SIGKILL — laisse à Kopia le temps de vider les écritures en cours. |

> **`service_port` n'est pas exposé par ce module** — voir §2E ci-dessus. Le port
> externe du LoadBalancer vaut toujours `80` (la valeur par défaut d'`App_GKE`) ;
> `target_port` est le port réel de Kopia, `51515`.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Disponible mais non recommandé.** La seule chose qui résiderait sur un PVC est le minuscule certificat TLS persisté — aucun besoin significatif en IOPS ou en verrouillage qu'un périphérique bloc améliorerait. GCS FUSE (la valeur par défaut) convient. |
| `stateful_pvc_mount_path` | `/var/lib/kopia` | Doit correspondre au chemin de montage GCS FUSE par défaut si vous activez un PVC. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` par défaut — le certificat persisté est un minuscule fichier sans besoin d'IOPS élevées. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 15 s, seuil de 10 tentatives | **TCP, et non HTTP** — chaque point de terminaison de Kopia exige une authentification ; une sonde sur un chemin HTTP renverrait donc toujours 401. |
| `liveness_probe` | TCP, délai de 30 s, seuil de 3 tentatives | Même raisonnement que pour `startup_probe`. |
| `uptime_check_config` | désactivé | S'il est activé, il s'agit d'une vérification HTTP qui échouera en permanence face aux points de terminaison de Kopia protégés par authentification. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucune tâche d'initialisation par défaut — la logique de connexion-ou-création du point d'entrée la remplace. |
| `cron_jobs` | `[]` | CronJobs Kubernetes (par exemple, un `kopia maintenance run` périodique pour le GC du dépôt). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` (données du dépôt + persistance du certificat TLS). |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires — le montage du certificat TLS de Kopia est ajouté automatiquement. |

### Groupe 15 / 16 — Redis / Base de données (non applicable) {#group-15--16--redis--database-not-applicable}

Kopia n'utilise ni l'un ni l'autre. `enable_redis` est codé en dur à `false` dans
`main.tf` (remplaçant la valeur par défaut `true` d'`App_GKE`) ; `database_type` est
fixé à `NONE`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway pour un nom d'hôte personnalisé. Notez que le protocole client de Kopia est du gRPC brut, et non du HTTP de navigateur — un domaine personnalisé sert surtout à fournir aux clients une `--url` stable, et non une interface navigable. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre, afin que les clients distants n'aient pas à réépingler `--url`. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | IAP est conçu pour l'authentification navigateur/HTTP, et non pour le protocole de snapshot gRPC brut — il ne convient que pour protéger l'interface Web sur un domaine personnalisé, pas le point de terminaison de connexion des clients. |

### Groupes 12, 8, 9, 13, 17, 18, 21, 22 {#groups-12-8-9-13-17-18-21-22}

Comportement standard d'`App_GKE` — CI/CD et Binary Authorization, quota de
ressources, règles de fiabilité, NFS, sauvegarde et maintenance (générique au socle,
et non le dépôt propre à Kopia), SQL personnalisé (non applicable), Cloud Armor et
VPC Service Controls. Consultez [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe (lorsque `reserve_static_ip = true`) — la partie hôte de la valeur `kopia repository connect server --url=`. |
| `service_url` | URL calculée par le socle. **Ne vous fiez pas au schéma ni au port pour Kopia** — par défaut un simple `http://<ip>` sans port ; confirmez le port réel avec `kubectl get svc`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Vide par défaut — Kopia n'a pas de tâche d'initialisation. |
| `statefulset_name` | Nom du StatefulSet (uniquement lorsque `workload_type = "StatefulSet"`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — `workload_type = "Deployment"` avec
> `stateful_pvc_enabled = true`, IAP sans identités autorisées, unités de quota non
> binaires. Une configuration invalide fait échouer le **plan** avec une erreur
> claire et nommée avant la création de toute ressource.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `REPO_PASSWORD` (Secret Manager) | Ne jamais le renouveler manuellement après le premier déploiement | **Critical** | Il n'existe aucun moyen pris en charge de rechiffrer un dépôt actif — renouveler ce secret indépendamment du contenu réel du dépôt GCS rend définitivement orphelins tous les snapshots existants. |
| Mot de passe de l'utilisateur du dépôt | Connecter les clients avec `--password=<REPO_PASSWORD>`, jamais `<ADMIN_PASSWORD>` | **Critical** | `kopia repository connect server` n'a pas d'option distincte pour le mot de passe de l'utilisateur serveur — son unique saisie de mot de passe EST l'identifiant de la session gRPC, vérifié par rapport au mot de passe de l'utilisateur stocké dans le dépôt. Utiliser `ADMIN_PASSWORD` fait échouer chaque session avec `PermissionDenied`. |
| `max_instance_count` | `1` | **Critical** | La maintenance du dépôt propre à Kopia (GC/compactage) suppose qu'un seul serveur en est propriétaire ; un second serveur concurrent fait s'affronter des exécutions de maintenance sur le même dépôt. |
| Sondes de santé | Les laisser en TCP (valeur par défaut du module) | **High** | Chaque point de terminaison de Kopia exige une authentification — une sonde sur un chemin HTTP renvoie toujours 401, et le pod ne devient jamais Ready alors que le serveur a bien démarré. |
| URL/port de connexion du client | Port explicite, confirmé via `kubectl get svc` | **High** | `service_port` n'est pas exposé par ce module et vaut `80` par défaut, et non le port réel de Kopia, `51515`. Un simple `https://<ip>` implique le port 443 (non ouvert) et échoue silencieusement à se connecter. |
| `uptime_check_config` | Laisser `enabled = false` (valeur par défaut du module) | **Medium** | S'il est activé, il effectue une vérification HTTP sur un point de terminaison protégé par authentification et échoue en permanence, générant de fausses alertes. |
| `stateful_pvc_enabled` | Laisser `false`/non défini (valeur par défaut du module) | **Low** | Disponible, mais la seule chose qui y résiderait est le minuscule certificat TLS persisté — aucun avantage en IOPS ou en verrouillage par rapport au montage GCS FUSE par défaut. |
| `enable_iap` | Uniquement pour l'interface Web et l'API de contrôle, pas pour le point de terminaison de connexion des clients | **Medium** | IAP est orienté authentification navigateur/HTTP ; il ne protège pas (et ne peut pas protéger utilement) la session de snapshot gRPC brute. |
| Certificat TLS | Ne jamais supprimer `/var/lib/kopia/tls/*` en dehors du module | **High** | Chaque client distant déjà connecté a épinglé l'ancienne empreinte via `--server-cert-fingerprint=` ; un certificat régénéré casse tous les clients existants jusqu'à ce qu'ils réépinglent la nouvelle. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Kopia est décrite
dans **[Kopia_Common](Kopia_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kopia sur GKE Autopilot](../labs/Kopia_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Kopia Common — Configuration applicative partagée](Kopia_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [UrBackup sur GKE Autopilot](UrBackup_GKE.md) et [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md) dans la solution **Backup & Disaster Recovery**.
