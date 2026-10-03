---
title: "Wallabag sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Wallabag sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wallabag_GKE.md @ 15fd4c7 sha256:b90f30d4e426 -->

# Wallabag sur GKE Autopilot {#wallabag-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallabag_GKE.png" alt="Wallabag sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallabag est une application d'archivage d'articles "lire plus tard" gratuite,
open source et auto-hébergée — une alternative à Pocket. Enregistrez des
articles à partir d'une extension de navigateur, d'un bookmarklet, d'une
application mobile ou de l'API REST, puis lisez-les plus tard dans une vue
propre et sans distraction avec recherche en texte intégral, étiquetage,
annotations et flux RSS de vos éléments enregistrés. Ce module déploie Wallabag
sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Wallabag et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wallabag s'exécute comme un pod PHP/Symfony (nginx + php-fpm sous s6-overlay)
sur GKE Autopilot. Le déploiement connecte un ensemble ciblé de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Symfony, 1 vCPU / 2 GiB par défaut ; réplica unique par défaut (GKE n'a pas de mise à l'échelle à zéro) |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Wallabag_Common fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` est provisionné, mais Wallabag ne le lit ni ne l'écrit — tout le contenu réside dans MySQL |
| Secrets | Secret Manager | `APP_SECRET` auto-généré (jeton de sécurité Symfony) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé + certificat géré activé par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par
  `Wallabag_Common` ; la sélection de tout autre moteur interrompt le déploiement.
- **`enable_cloudsql_volume = true`.** Un sidecar Cloud SQL Auth Proxy écoute sur
  `127.0.0.1:3306` ; `wallabag.tf` épingle en outre `DB_HOST = "127.0.0.1"` afin que le
  point d'entrée du wrapper compose toujours le sidecar. La variante Cloud Run
  se connecte plutôt via l'IP privée de l'instance.
- **Secret Manager unique.** `APP_SECRET` (un jeton de sécurité Symfony) est
  généré automatiquement, remplaçant la valeur par défaut connue de Wallabag.
  Il n'y a pas de secret de mot de passe administrateur généré séparément.
- **`min_instance_count = 1`, `max_instance_count = 1` par défaut.** GKE n'a pas de mise à
  l'échelle à zéro ; maintenez les réplicas à 1 à moins que le comportement de
  session/cache de Wallabag sous plusieurs pods n'ait été vérifié.
- **`service_type = LoadBalancer`** avec `session_affinity = "ClientIP"` ;
  `enable_custom_domain = true` et `reserve_static_ip = true` par défaut.
- **`enable_nfs` par défaut `true` mais est fonctionnellement inutilisé.** Il
  monte Cloud Filestore NFS à `/var/lib/wallabag`, mais l'image de Wallabag
  `WORKDIR` est `/var/www/wallabag` — rien n'écrit dans le chemin monté. Peut
  être désactivé en toute sécurité.
- **Pas de job de migration séparé.** Le propre `bin/console wallabag:install` de Wallabag
  gère à la fois la création du schéma et la configuration initiale en une seule
  étape idempotente.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Wallabag {#a-gke-autopilot--the-wallabag-workload}

Wallabag s'exécute par défaut comme un déploiement à réplica unique. Autopilot
facture le CPU/la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Wallabag pour les pods, les événements et les journaux. Kubernetes
  Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Wallabag stocke toutes les données de l'application (articles enregistrés,
balises, utilisateurs, annotations) dans une instance gérée Cloud SQL pour
MySQL 8.0. Le pod y accède en privé via un **sidecar Cloud SQL Auth Proxy**
écoutant sur `127.0.0.1:3306`. Lors du premier déploiement, un job `db-init`
crée la base de données et l'utilisateur de l'application, suivi de
`wallabag-install`, qui exécute l'installateur propre à Wallabag pour créer le
schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket générique `data` est provisionné par défaut (via l'entrée
`storage_buckets` de la Fondation), mais Wallabag lui-même ne le lit ni ne l'écrit
jamais — tout le contenu réside dans MySQL, et `gcs_volumes` (qui monterait un
bucket dans le pod via fuse) est vide par défaut.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :
`APP_SECRET` (matérialisé sous cette clé simple — le CRD SecretSync de GKE
rejette les valeurs `targetKey` contenant `__`, donc le vrai nom
`SYMFONY__ENV__SECRET` est aliasé au démarrage du conteneur par le point d'entrée du
wrapper plutôt que d'être la clé synchronisée elle-même). Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing avec une adresse IP statique réservée et un Ingress Kubernetes
pour les domaines personnalisés.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Le stdout/stderr du pod s'écoule vers Cloud Logging ; les métriques GKE et Cloud
SQL s'écoulent vers Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Wallabag {#3-wallabag-application-behaviour}

- **Chaîne d'initialisation en deux étapes, pas une étape de migration séparée
  de type Laravel.** `db-init` (`mysql:8.0-debian`) crée la base de données et
  l'utilisateur de l'application vides et accorde les privilèges. `wallabag-install`
  dépend ensuite de `db-init` et réutilise la même image d'application
  personnalisée (de sorte que l'aliasing d'environnement du point d'entrée du
  wrapper s'exécute toujours) avec sa commande remplacée par
  `bin/console wallabag:install --env=prod -n`. Cette commande unique effectue à la fois la création du
  schéma *et* la configuration initiale (y compris l'amorçage du compte
  administrateur par défaut) — il n'y a pas de job de migration séparé à
  exécuter lors des mises à niveau ; réexécuter `wallabag:install` sur une base de
  données déjà installée est sûr et idempotent.
- **Comportement de la vérification de l'état.** La sonde de démarrage est
  **TCP** sur le port 80 — elle n'a besoin que de nginx pour se lier,
  indépendamment de la progression de l'installateur. La sonde de vivacité est
  **HTTP `GET /login`**, qui renvoie un simple `200`. Elle évite
  délibérément `/` : la racine redirige les requêtes non
  authentifiées vers `/login` (HTTP 302), ce que Kubernetes accepterait
  mais la vérification de l'état du backend de la passerelle — reflétée par
  cette sonde — ne le fait pas, car elle nécessite un `200` littéral.
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 302
  ```
- **Compte administrateur initial.** `wallabag:install --env=prod -n` crée le compte
  administrateur par défaut de Wallabag en utilisant les valeurs par défaut
  d'installation documentées de Wallabag (nom d'utilisateur et mot de passe
  tous deux `wallabag`) — il n'y a pas de secret Secret Manager contenant un
  mot de passe administrateur généré. **Changez ce mot de passe
  immédiatement après la première connexion.** Les nouveaux comptes ne peuvent
  pas s'auto-enregistrer (`SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`) — créez des utilisateurs
  supplémentaires à partir de l'interface utilisateur d'administration ou avec
  `kubectl exec ... -- bin/console fos:user:create`.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-or-wallabag-install-job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Wallabag sont listés ; toute autre entrée est héritée de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le cluster et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallabag` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image de base pour `wallabag/wallabag`. `"latest"` correspond à un tag épinglé (`2.6.14`) au moment de la build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `"prebuilt"` ignore entièrement le wrapper d'aliasing DB/secret. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | GKE n'a pas de mise à l'échelle à zéro ; réplica unique par défaut. |
| `container_port` | `80` | Le nginx de Wallabag écoute sur le port 80. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de ressources par pod. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy sur `127.0.0.1`. Garder `true` sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe par défaut. |
| `session_affinity` | `ClientIP` | Route les requêtes d'un client vers le même pod. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` (Wallabag n'a pas besoin d'identité PVC par pod). |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne intégrée `db-init` → `wallabag-install`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | **Fonctionnellement inutilisé** — monté à `/var/lib/wallabag`, mais l'image de Wallabag n'y écrit rien. Peut être désactivé en toute sécurité. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique. Non lu ni écrit par Wallabag. |
| `gcs_volumes` | `[]` | Rien n'est monté via fuse dans le pod par défaut. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | se résout en `MYSQL_8_0` | Fixé par `Wallabag_Common`. |
| `application_database_name` / `application_database_user` | `wallabag` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (tous vides) | **Inutilisé par Wallabag** — le point d'entrée du wrapper lit directement les variables standard `DB_*` et les alias sur `SYMFONY__ENV__DATABASE_*` lui-même. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress Kubernetes avec `application_domains`. |
| `reserve_static_ip` | `true` | Une IP stable qui survit aux redéploiements. |
| `network_tags` | `["nfsserver"]` | Ciblage du pare-feu ; requis pour la connectivité NFS lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Purement optionnel — uniquement utilisé par la fonction d'importation en masse asynchrone de Wallabag. |

Toutes les autres entrées (métadonnées du groupe 0, environnement du groupe 2,
secrets du groupe 5, StatefulSet du groupe 7, quota de ressources du groupe 8,
fiabilité du groupe 9, observabilité du groupe 10, CI/CD du groupe 12,
sauvegarde du groupe 17, SQL personnalisé du groupe 18, IAP du groupe 20, Cloud
Armor du groupe 21, VPC-SC du groupe 22) se comportent exactement comme
documenté dans [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` / `service_external_ip` | IP interne / externe. |
| `service_url` | URL du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | `127.0.0.1` via le sidecar Cloud SQL Auth Proxy. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `wallabag-install`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources K8s sont déployées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État du VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide échoue à la **planification** avec une erreur claire
> et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement du pilote DB (`SYMFONY__ENV__DATABASE_DRIVER`, codée en dur dans `entrypoint.sh`) | doit être définie explicitement (`pdo_mysql` ici) | **Critique** | Le `parameters.yml` fourni par Wallabag définit par défaut `database_driver` à `pdo_sqlite`. Définir uniquement `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` sans variable de pilote explicite installe toujours silencieusement contre un fichier SQLite local jetable — l'installation "réussit", le pod signale Prêt, mais toutes les données résident dans un fichier éphémère effacé à chaque redémarrage ou redéploiement du pod, et MySQL n'est jamais touché. Aucune erreur n'est levée. **Si ce module est un jour cloné comme modèle pour une autre application basée sur Symfony, vérifiez que la variable d'environnement du pilote DB est définie explicitement** — cette classe d'échec est indétectable de l'extérieur ; utilisez `kubectl exec` dans le pod et vérifiez les journaux de démarrage (`"Configuring the SQLite database..."` vs. une ligne de connexion MySQL) pour confirmer. Voir [App_GKE](App_GKE.md) et [App_CloudRun](App_CloudRun.md) pour savoir comment la Fondation injecte génériquement les variables d'environnement DB — la traduction spécifique à l'application et les pièces manquantes sont toujours la responsabilité du module appelant. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la DB/l'utilisateur et détruit tous les articles enregistrés. |
| `APP_SECRET` (auto-généré) | Ne jamais modifier manuellement dans Secret Manager après le premier démarrage | Élevé | Wallabag l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et toutes les URL signées déjà émises. |
| Identifiants administrateur par défaut (`wallabag` / `wallabag`, amorcés par `wallabag:install`) | Changer immédiatement après la première connexion | Élevé | L'installateur amorce les identifiants par défaut bien connus de Wallabag — toute personne connaissant l'URL du service et la valeur par défaut publique peut se connecter tant que le mot de passe n'est pas changé. |
| `container_image_source` | `custom` | Critique | Passer à `prebuilt` déploie l'image standard `wallabag/wallabag` sans point d'entrée de wrapper — l'aliasing des variables d'environnement DB et secret ne s'exécute jamais, de sorte que le pod ne peut pas du tout atteindre MySQL. |
| `enable_cloudsql_volume` | `true` sur GKE | Critique | Définir `false` supprime le sidecar Auth Proxy dont dépend l'épingle `DB_HOST = "127.0.0.1"` du point d'entrée du wrapper — le pod ne peut pas atteindre Cloud SQL. |
| `max_instance_count` | `1` sauf vérification contraire | Élevé | Mettre à l'échelle au-delà d'un pod sans vérifier le comportement de session/cache de Wallabag risque des sessions utilisateur incohérentes entre les pods. |
| `enable_nfs` | `false` sauf si nécessaire à d'autres fins | Faible / coût | Par défaut `true` et provisionne un partage Filestore que Wallabag n'utilise jamais — un coût récurrent inutile. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Wallabag partagée avec la variante
Cloud Run est décrite dans **[Wallabag_Common](Wallabag_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallabag sur GKE Autopilot](../labs/Wallabag_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wallabag Common — Configuration d'application partagée](Wallabag_Common.md) — la configuration partagée par les deux cibles de déploiement.
