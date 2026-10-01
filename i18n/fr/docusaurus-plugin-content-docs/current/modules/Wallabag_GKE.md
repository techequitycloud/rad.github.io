---
title: "Wallabag sur GKE Autopilot"
description: "Référence de configuration pour déployer Wallabag sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wallabag_GKE.md @ 944fee5 sha256:bfcc203157e4 -->

# Wallabag sur GKE Autopilot {#wallabag-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallabag_GKE.png" alt="Wallabag sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallabag est une application gratuite, open source et auto-hébergée d'archivage d'articles
à « lire plus tard » — une alternative à Pocket. Enregistrez des articles depuis une extension de navigateur, un bookmarklet,
une application mobile ou l'API REST, puis lisez-les plus tard dans une vue épurée et sans distraction,
avec recherche plein texte, étiquettes, annotations et flux RSS de vos éléments
enregistrés. Ce module déploie Wallabag sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Wallabag et sur la manière de les explorer et
de les exploiter depuis la Google Cloud Console et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wallabag s'exécute sous la forme d'un pod PHP/Symfony (nginx + php-fpm sous s6-overlay) sur GKE
Autopilot. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Symfony, 1 vCPU / 2 GiB par défaut ; un seul réplica par défaut (GKE ne permet pas la mise à zéro) |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Wallabag_Common fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` est provisionné, mais Wallabag ne le lit ni ne l'écrit — tout le contenu réside dans MySQL |
| Secrets | Secret Manager | `APP_SECRET` généré automatiquement (jeton de sécurité Symfony) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par `Wallabag_Common` ;
  choisir un autre moteur fait échouer le déploiement.
- **`enable_cloudsql_volume = true`.** Un sidecar Cloud SQL Auth Proxy écoute sur
  `127.0.0.1:3306` ; `wallabag.tf` fixe en outre `DB_HOST = "127.0.0.1"` afin que le
  point d'entrée encapsulant se connecte toujours au sidecar. La variante Cloud Run se
  connecte au contraire via l'IP privée de l'instance.
- **Un seul secret Secret Manager.** `APP_SECRET` (un jeton de sécurité Symfony) est
  généré automatiquement et remplace la valeur par défaut intégrée de Wallabag, connue publiquement.
  Il n'existe pas de secret distinct pour un mot de passe administrateur généré.
- **`min_instance_count = 1`, `max_instance_count = 1` par défaut.** GKE ne permet pas la
  mise à zéro ; conservez un seul réplica tant que le comportement de Wallabag en matière de sessions/cache
  avec plusieurs pods n'a pas été vérifié.
- **`service_type = LoadBalancer`** avec `session_affinity = "ClientIP"` ;
  `enable_custom_domain = true` et `reserve_static_ip = true` par défaut.
- **`enable_nfs` vaut `true` par défaut mais n'a aucune utilité fonctionnelle.** Il monte le NFS Cloud
  Filestore dans `/var/lib/wallabag`, mais le `WORKDIR` de l'image de Wallabag est
  `/var/www/wallabag` — rien n'écrit dans le chemin monté. Vous pouvez le désactiver sans risque.
- **Pas de job de migration distinct.** La commande `bin/console wallabag:install` de Wallabag
  gère à la fois la création du schéma et la configuration initiale en une seule étape idempotente.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Wallabag {#a-gke-autopilot--the-wallabag-workload}

Wallabag s'exécute par défaut sous la forme d'un Deployment à un seul réplica. Autopilot facture le
CPU et la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Wallabag pour voir
  les pods, les événements et les journaux. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Wallabag stocke toutes les données de l'application (articles enregistrés, étiquettes, utilisateurs, annotations)
dans une instance gérée Cloud SQL for MySQL 8.0. Le pod y accède de façon privée
via un **sidecar Cloud SQL Auth Proxy** qui écoute sur `127.0.0.1:3306`. Lors du
premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application,
suivi de `wallabag-install`, qui exécute le programme d'installation propre à Wallabag pour créer
le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket générique `data` est provisionné par défaut (via l'entrée `storage_buckets`
du socle), mais Wallabag lui-même ne le lit ni ne l'écrit jamais — tout le
contenu réside dans MySQL, et `gcs_volumes` (qui monterait un bucket via FUSE dans
le pod) est vide par défaut.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager : `APP_SECRET`
(matérialisé sous cette clé simple — le CRD SecretSync de GKE rejette les valeurs `targetKey`
contenant `__`, si bien que le véritable nom `SYMFONY__ENV__SECRET` est associé par alias au
démarrage du conteneur par le point d'entrée encapsulant, au lieu d'être lui-même la clé
synchronisée). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe,
avec une IP statique réservée et un Ingress Kubernetes pour les domaines personnalisés.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Wallabag {#3-wallabag-application-behaviour}

- **Une chaîne d'initialisation en deux étapes, et non une étape de migration séparée à la Laravel.**
  `db-init` (`mysql:8.0-debian`) crée la base de données et l'utilisateur de l'application, vides,
  et accorde les droits. `wallabag-install` dépend ensuite de `db-init` et réutilise
  la même image applicative personnalisée (de sorte que les alias d'environnement du point d'entrée encapsulant s'exécutent toujours),
  sa commande étant remplacée par `bin/console wallabag:install --env=prod -n`.
  Cette commande unique effectue à la fois la création du schéma *et* la configuration initiale
  (y compris l'amorçage du compte administrateur par défaut) — il n'y a pas de job de
  migration distinct à exécuter lors des mises à niveau ; relancer `wallabag:install` sur une
  base de données déjà installée est sans risque et idempotent.
- **Comportement des sondes de santé.** La sonde de démarrage est en **TCP** sur le port 80 — il suffit
  que nginx soit à l'écoute, indépendamment de l'avancement du programme d'installation. La sonde de vivacité est en
  **HTTP `GET /`** : une requête non authentifiée vers le chemin racine renvoie une
  **redirection HTTP 302 vers `/login`**, que la sémantique des sondes de Kubernetes considère comme
  une réponse valide (tout code 2xx–3xx). N'attendez pas un simple 200 de `/` — un 302
  vers `/login` est le résultat attendu, signe de bonne santé.
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 302
  ```
- **Compte administrateur initial.** `wallabag:install --env=prod -n` crée le
  compte administrateur par défaut propre à Wallabag en utilisant les valeurs d'installation par défaut documentées par Wallabag
  (nom d'utilisateur et mot de passe tous deux `wallabag`) — aucun secret Secret Manager
  ne contient de mot de passe administrateur généré. **Changez ce
  mot de passe immédiatement après la première connexion.** Les nouveaux comptes ne peuvent pas s'inscrire eux-mêmes
  (`SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`) — créez des utilisateurs supplémentaires
  depuis l'interface d'administration ou avec `kubectl exec ... -- bin/console fos:user:create`.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-or-wallabag-install-job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Wallabag ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du cluster et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallabag` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image de base `wallabag/wallabag`. `"latest"` correspond à un tag épinglé (`2.6.14`) au moment du build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit l'image encapsulante via Cloud Build. `"prebuilt"` ignore entièrement l'encapsulation qui crée les alias de base de données/de secret. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | GKE ne permet pas la mise à zéro ; un seul réplica par défaut. |
| `container_port` | `80` | Le nginx de Wallabag écoute sur le port 80. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de ressources par pod. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy sur `127.0.0.1`. Conservez `true` sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe par défaut. |
| `session_affinity` | `ClientIP` | Achemine les requêtes d'un client vers le même pod. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` (Wallabag n'a pas besoin d'une identité de PVC par pod). |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `wallabag-install`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | **Sans utilité fonctionnelle** — monté dans `/var/lib/wallabag`, mais l'image de Wallabag n'y écrit rien. Vous pouvez le désactiver sans risque. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique. Wallabag ne le lit ni ne l'écrit. |
| `gcs_volumes` | `[]` | Rien n'est monté via FUSE dans le pod par défaut. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | se résout en `MYSQL_8_0` | Fixé par `Wallabag_Common`. |
| `application_database_name` / `application_database_user` | `wallabag` | Préfixés par le tenant au moment du déploiement. Immuables après le premier déploiement. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (tous vides) | **Non utilisés par Wallabag** — le point d'entrée encapsulant lit directement les variables standard `DB_*` et les associe lui-même par alias à `SYMFONY__ENV__DATABASE_*`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress Kubernetes avec `application_domains`. |
| `reserve_static_ip` | `true` | Une IP stable qui survit aux redéploiements. |
| `network_tags` | `["nfsserver"]` | Ciblage du pare-feu ; nécessaire à la connectivité NFS lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Entièrement facultatif — utilisé uniquement par la fonction d'import en masse asynchrone de Wallabag. |

Toutes les autres entrées (métadonnées du groupe 0, environnement du groupe 2, secrets du groupe 5,
StatefulSet du groupe 7, quota de ressources du groupe 8, fiabilité du groupe 9, observabilité du groupe 10,
CI/CD du groupe 12, sauvegarde du groupe 17, SQL personnalisé du groupe 18, IAP du groupe 20,
Cloud Armor du groupe 21, VPC-SC du groupe 22) se comportent exactement comme documenté dans
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` / `service_external_ip` | IP interne / externe. |
| `service_url` | URL du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | `127.0.0.1` via le sidecar Cloud SQL Auth Proxy. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `wallabag-install`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources K8s sont déployées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement du pilote de base de données (`SYMFONY__ENV__DATABASE_DRIVER`, codée en dur dans `entrypoint.sh`) | doit être définie explicitement (ici `pdo_mysql`) | **Critical** | Le `parameters.yml` livré avec Wallabag définit `database_driver` à `pdo_sqlite` par défaut. Définir uniquement `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` sans variable de pilote explicite conduit encore à une installation silencieuse sur un fichier SQLite local jetable — l'installation « réussit », le pod est signalé Ready, mais toutes les données résident dans un fichier éphémère effacé à chaque redémarrage ou redéploiement du pod, et MySQL n'est jamais sollicité. Aucune erreur n'est levée. **Si ce module est un jour cloné comme modèle pour une autre application basée sur Symfony, vérifiez que la variable d'environnement du pilote de base de données est définie explicitement** — cette catégorie d'échec est indétectable de l'extérieur ; utilisez `kubectl exec` dans le pod et consultez les journaux de démarrage (`"Configuring the SQLite database..."` ou une ligne de connexion MySQL) pour vous en assurer. Consultez [App_GKE](App_GKE.md) et [App_CloudRun](App_CloudRun.md) pour savoir comment le socle injecte de manière générique les variables d'environnement de base de données — la traduction propre à l'application et les éventuels éléments manquants relèvent toujours de la responsabilité du module appelant. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; un renommage recrée la base de données/l'utilisateur et détruit tous les articles enregistrés. |
| `APP_SECRET` (généré automatiquement) | Ne jamais le modifier à la main dans Secret Manager après le premier démarrage | High | Wallabag l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et toutes les URL signées déjà émises. |
| Identifiants administrateur par défaut (`wallabag` / `wallabag`, amorcés par `wallabag:install`) | À changer immédiatement après la première connexion | High | Le programme d'installation amorce les identifiants par défaut bien connus de Wallabag — quiconque connaît l'URL du service et cette valeur publique peut se connecter tant que le mot de passe n'a pas été changé. |
| `container_image_source` | `custom` | Critical | Passer à `prebuilt` déploie l'image standard `wallabag/wallabag` sans point d'entrée encapsulant — les alias des variables d'environnement de base de données et de secret ne sont jamais créés, et le pod ne peut donc pas du tout atteindre MySQL. |
| `enable_cloudsql_volume` | `true` sur GKE | Critical | Définir `false` supprime le sidecar Auth Proxy dont dépend la valeur fixe `DB_HOST = "127.0.0.1"` du point d'entrée encapsulant — le pod ne peut pas atteindre Cloud SQL. |
| `max_instance_count` | `1`, sauf vérification contraire | High | Dépasser 1 pod sans avoir vérifié le comportement de Wallabag en matière de sessions/cache risque de produire des sessions utilisateur incohérentes d'un pod à l'autre. |
| `enable_nfs` | `false`, sauf besoin à d'autres fins | Low / coût | Vaut `true` par défaut et provisionne un partage Filestore que Wallabag n'utilise jamais — un coût récurrent inutile. |
| `enable_cloud_armor` | à activer en production | Medium | Le service est par défaut accessible publiquement sans protection WAF. |

---

Pour le comportement du socle mentionné tout au long de ce guide — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Wallabag
partagée avec la variante Cloud Run est décrite dans
**[Wallabag_Common](Wallabag_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallabag sur GKE Autopilot](../labs/Wallabag_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wallabag Common — Configuration applicative partagée](Wallabag_Common.md) — la configuration partagée par les deux cibles de déploiement.
