---
title: "App CloudRun — Guide de lab"
description: "Labs pratiques : déployez un socle de référence, puis choisissez des labs de fonctionnalités pour chaque groupe de configuration — chacun avec un objectif, des paramètres testés, une vérification, des pièges et des étapes de retour arrière — ainsi que les opérations, l'observabilité et le démantèlement."
---

<!-- translated-from: docs/labs/App_CloudRun.md @ 2be24ed1 sha256:96f9818f669a -->

# App CloudRun — Guide de lab {#app-cloudrun--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** parcours principal (Tâches 1–2) ~45–60 minutes ; chaque lab de fonctionnalité 10–40 minutes ; l'ensemble des labs et tâches ~10–12 heures.

`App CloudRun` est le **moteur de déploiement socle** pour tous les modules applicatifs Cloud Run sur cette plateforme. Il provisionne un service Cloud Run v2 prêt pour la production pour toute charge de travail conteneurisée — avec en option Cloud SQL (PostgreSQL, MySQL ou SQL Server), du stockage partagé NFS, des buckets GCS et des montages GCS Fuse, Secret Manager, du CI/CD avec Cloud Build et Cloud Deploy, Cloud Monitoring, Identity-Aware Proxy, ainsi qu'un Global HTTPS Load Balancer optionnel avec WAF Cloud Armor et CDN. Les modules applicatifs tels que `Django_CloudRun` et `Ghost_CloudRun` appellent ce moteur en interne ; vous pouvez également le déployer directement, comme le fait ce lab.

Déployé seul, le module compile et exécute un **exemple d'application Flask intégrée** (depuis le répertoire `scripts/` du module : `app.py` ainsi qu'un `Dockerfile` basé sur `python:3.11-slim`, servi par gunicorn sur le port `8080`). Il vous fournit de véritables points de terminaison pour effectuer vos tests :

| Point de terminaison | Ce qu'il renvoie | Pourquoi il est utile dans ce lab |
|---|---|---|
| `/` | `Hello from Sample App! Visitor count: N` — incrémente une ligne de compteur dans PostgreSQL | Prouve toute la chaîne : entrée (ingress) → conteneur → Cloud SQL. Si la base de données est inaccessible, il répond tout de même 200 mais indique `(DB unavailable: …)`, alors **lisez le corps de la réponse, pas seulement le code d'état**. |
| `/db` | JSON `{"status": "connected", "version": "PostgreSQL …"}`, ou HTTP 500 avec l'erreur | Une vérification directe de la connectivité à la base de données. |
| `/whoami` | JSON avec `remote_addr`, les en-têtes de transfert (`X-Forwarded-For`, `Forwarded`, …) et les *noms* de tous les en-têtes de requête | Montre exactement ce que le front-end de la plateforme transmet au conteneur. |
| `/healthz` | JSON `{"status": "healthy"}` | Utilisé par les sondes de démarrage et de vivacité. **À travers l'URL publique `*.run.app`, il renvoie l'erreur 404 de Google**, car le front-end de Cloud Run répond lui-même `/healthz` — les sondes contournent le front-end et voient le 200 de l'application. Ne pointez jamais un contrôle externe vers `/healthz`. |

L'exemple d'application utilise **PostgreSQL uniquement** ; son job `db-init` (image `postgres:15-alpine`) crée l'utilisateur, la base de données et la table `visitors`.

Ce lab traite du fonctionnement du **module Cloud Run et de la plateforme Google Cloud**, et non de la charge de travail au sein du conteneur. Chaque entrée est documentée, groupe par groupe, dans le [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun) ; ce lab vous montre comment *tester* chaque groupe et prouver son bon fonctionnement.

> **Ce lab se déploie sur un socle `Services_GCP`.** Utilisez le **même `tenant_id`** que votre déploiement `Services_GCP` afin que `App CloudRun` découvre automatiquement et se lie au VPC partagé, à l'instance Cloud SQL, au serveur NFS et à Artifact Registry au lieu de provisionner ses propres copies intégrées (inline). (Le déploiement autonome — avec `require_services_gcp_module = false` — est pris en charge, mais le but de ce lab est de manipuler le socle.)

> **Les entrées sont validées au moment du plan.** Le module rejette les valeurs non valides et les combinaisons de fonctionnalités incompatibles — un réplica de lecture sans primaire, IAP sans utilisateurs autorisés, un runtime `gen1` avec NFS, un job `mount_nfs` avec `enable_nfs = false`, une source d'image `prebuilt` sans image, CDN sans Cloud Armor, `database_type = "NONE"` avec le volume Cloud SQL encore actif — *avant* que quoi que ce soit ne soit créé, avec une erreur claire nommant la variable. Vous ferez l'expérience d'un échec rapide et explicite plutôt que d'un déploiement à moitié construit. Le tableau [*Configuration Pitfalls* du Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun) signale les combinaisons interceptées de cette manière.

### Organisation de ce lab {#how-this-lab-is-organised}

- **Partie 1 — Cœur (Tâches 1–2).** Déployez un socle de référence et vérifiez-le. Tout le monde suit cette étape ; chaque lab de fonctionnalité en découle.
- **Partie 2 — Labs de fonctionnalités.** Un lab par groupe de variables du formulaire de déploiement (Lab 2 = Groupe 2, Lab 3 = Groupe 3, …, Lab 18 = Groupe 18), plus le **Lab I** pour les paramètres d'isolation sans groupe associé. Après le socle de référence, ils sont indépendants les uns des autres : exécutez-les dans l'ordre de votre choix, et sélectionnez uniquement ceux qui vous intéressent dans le menu ci-dessous. Chaque lab indique son objectif, sa durée, son coût et ses prérequis, et se termine par une étape de **Retour arrière**.
- **Partie 3 — Exploiter, observer, dépanner, démanteler (Tâches 3–6).**

### Menu des labs {#lab-menu}

| Lab | Groupe | Objectif (ce que vous serez capable de faire) | Durée | Coût supplémentaire ? | Configuration externe |
|---|---|---|---|---|---|
| [Lab 2](#lab-2--support-users--resource-labels-group-2) | 2 | Router les alertes Cloud Monitoring vers votre équipe et étiqueter chaque ressource pour l'imputation des coûts, puis vérifier les deux configurations | 10–15 min | Non | Aucune |
| [Lab 3](#lab-3--application-identity-group-3) | 3 | Renommer le nom d'affichage/la description de l'application, incrémenter `application_version` et tracer la nouvelle image et révision produite | 15 min | Non | Aucune |
| [Lab 4](#lab-4--runtime--scaling-group-4) | 4 | Dimensionner et mettre à l'échelle le service (instances min/max, CPU/mémoire, mode de facturation, délai d'expiration), changer la source d'image et répartir le trafic entre révisions | 30–40 min | Oui, tant que `min_instance_count ≥ 1` | Aucune |
| [Lab 5](#lab-5--environment-variables--secrets-group-5) | 5 | Injecter des variables d'environnement brutes et Secret Manager, observer une variable nommée comme un identifiant être déplacée automatiquement dans Secret Manager, et étiqueter/annoter le service | 20–30 min | Non | Créer un secret (démontré) |
| [Lab 6](#lab-6--initialization-jobs--health-checks-group-6) | 6 | Ajuster les sondes de démarrage/vivacité, créer un test de disponibilité fonctionnel sur Cloud Run, ajouter une alerte de latence et étendre la chaîne de jobs d'initialisation sans perdre `db-init` | 30–40 min | Faible (le test de disponibilité nécessite une instance toujours active) | Aucune |
| [Lab 7](#lab-7--cron-jobs-additional-services--sidecars-group-7) | 7 | Ajouter un job Cloud Run planifié, un service Cloud Run frère et un sidecar dans la révision, et prouver que le frère n'est accessible que via le VPC | 30–40 min | Faible | Aucune |
| [Lab 8](#lab-8--cicd--github-integration-group-8) | 8 | Activer Binary Authorization et vérifier son application ; parcourir (ou exécuter) le pipeline GitHub → Cloud Build → Cloud Deploy | 20 min (BinAuthz) / 40+ min (CI/CD) | Non | **[Configuration externe requise]** pour CI/CD : dépôt GitHub + jeton ou installation de l'application |
| [Lab 9](#lab-9--storage--filesystem--nfs-group-9) | 9 | Déplacer le point de montage NFS, puis prouver que les fichiers présents survivent à un conteneur neuf via un test écriture-redémarrage-lecture | 20–30 min | Non | Aucune |
| [Lab 10](#lab-10--storage-filesystem--image-registry-group-10) | 10 | Créer un bucket GCS versionné, le monter avec GCS Fuse et prouver que les écritures via le montage atterrissent bien dans le bucket | 20–30 min | Faible (stockage du bucket) | Aucune (AR CMEK modifie l'état KMS du projet) |
| [Lab 11](#lab-11--redis-cache-group-11) | 11 | Voir précisément quelles variables Redis le module injecte, et comment la définition de `redis_auth` les modifie | 15 min | Non | Aucune |
| [Lab 12](#lab-12--database-backend-group-12) | 12 | Trouver la base de données et les identifiants de l'application, leur ajouter des alias de variables d'environnement et exécuter une rotation automatique de mot de passe de bout en bout | 30–40 min | Faible | Aucune |
| [Lab 13](#lab-13--backup--maintenance-group-13) | 13 | Replanifier la sauvegarde de base de données, en déclencher une à la demande et restaurer le dump de validation fourni dans la base de données | 20–30 min | Faible | Aucune pour le dump d'exemple fourni |
| [Lab 14](#lab-14--custom-initialisation--sql-group-14) | 14 | Déposer des scripts SQL ordonnés dans un bucket et demander au module de les exécuter sur la base de données applicative | 20–30 min | Non | Téléverser deux fichiers `.sql` (démontré) |
| [Lab 15](#lab-15--access--networking-group-15) | 15 | Restreindre le trafic entrant (ingress), router tout le trafic sortant (egress) via le VPC et distinguer les trois types d'erreurs 404 Cloud Run | 20–30 min | Non | Aucune |
| [Lab 16](#lab-16--identity-aware-proxy-group-16) | 16 | Placer l'authentification Google devant le service et vérifier qui peut y accéder | 20–30 min | Non | **[Configuration externe requise]** : un écran de consentement OAuth (impossible à supprimer une fois créé) |
| [Lab 17](#lab-17--cloud-armor--cdn-group-17) | 17 | Protéger le service avec un Global HTTPS Load Balancer, le WAF Cloud Armor et CDN, et observer le blocage d'une sonde XSS | 30–40 min | **Oui** (équilibreur de charge, stratégie) | Aucune (domaine personnalisé facultatif : requiert un DNS) |
| [Lab 18](#lab-18--vpc-service-controls--audit-logging-group-18) | 18 | Activer la journalisation d'audit détaillée et tenter de créer un périmètre VPC-SC, en vérifiant s'il a réellement été créé | 20–30 min | Oui (volume de journaux) | **[Configuration externe requise]** pour VPC-SC : une organisation GCP |
| [Lab I](#lab-i--isolation-in-a-shared-project-no-group) | — | Exécuter l'application sous son propre compte de service, lui accorder des rôles supplémentaires et isoler ses secrets, buckets, service et jobs de toute autre application du projet | 30–40 min | Non | Barrière d'isolation uniquement : `roles/iam.denyAdmin` au niveau de l'**organisation** |

> **Les numéros de groupe correspondent au formulaire de déploiement.** Le groupe de chaque lab correspond à l'en-tête de groupe que vous voyez sur le formulaire de configuration RAD. Le [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun) numérote actuellement les groupes de ce module avec un cran de décalage inférieur (son Groupe 2 est le Groupe 3 du formulaire, et ainsi de suite), et classe `support_users` et `resource_labels` sous son Groupe 1.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD sur un socle `Services_GCP` et localiser tout ce qu'il provisionne.
- Vérifier un déploiement en interrogeant directement les objets déployés — plutôt qu'en se fiant aveuglément à un apply vert.
- Modifier n'importe quel groupe de paramètres en toute sécurité avec **Update**, en sachant quelles modifications sont sans risque (update-safe) et lesquelles remplacent des ressources.
- Manipuler chaque groupe de configuration : runtime et scaling, secrets, sondes et surveillance, jobs et services frères, CI/CD et Binary Authorization, stockage NFS et GCS, Redis, la base de données et sa rotation de mot de passe, sauvegardes et restaurations, SQL personnalisé, réseau, IAP, Cloud Armor/CDN, VPC-SC et journaux d'audit, ainsi que l'isolation par application dans un projet partagé.
- Exploiter, observer, dépanner et démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module le cas
  échéant (voir Tâche 1).
- Un projet Google Cloud avec **la facturation activée**.
- **CLI gcloud** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation vous demande de prouver que vous en avez le contrôle (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer au compte de service de déploiement RAD le rôle **Owner**. Un projet créé pour vous par RAD ne nécessite aucune de ces démarches.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD, guère plus que le nom du tenant et la région). Toutes les autres entrées du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches de Jour 2 — sont modifiées par la suite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, option accessible à tout compte tant que les builds sont inclus dans le prix (dans un environnement de lab, seul un administrateur peut l'utiliser). Les mises à jour n'entraînent jamais de frais de module.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- `curl` sur votre poste de travail (ou utilisez Cloud Shell, qui dispose de tout le nécessaire ci-dessus).

Définissez ces variables de shell une seule fois ; chaque tâche et lab ci-dessous les réutilise. Définissez `APP` et `TENANT` sur le `application_name` et le `tenant_id` avec lesquels vous effectuez le déploiement :

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"          # the region you deploy into
export APP="crapp"                   # application_name (default "crapp")
export TENANT="demo"                 # tenant_id — must match your Services_GCP deployment

# Run these AFTER Task 1 completes. The service is named
# <application_name><tenant_id><8-hex tenant hash>, e.g. crappdemo1a2b3c4d.
export SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
  --filter="metadata.name~^${APP}${TENANT}[0-9a-f]{8}$" \
  --format="value(metadata.name)" --limit=1)
export SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format="value(status.url)")
export TENANT_PREFIX="${SERVICE#$APP}"            # tenant + hash, e.g. demo1a2b3c4d
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
echo "Service: $SERVICE"; echo "URL: $SERVICE_URL"; echo "Tenant prefix: $TENANT_PREFIX"
```

Presque tout ce que le module crée est nommé d'après `$SERVICE` : les jobs sont `$SERVICE-<job>`, les buckets `gcs-$SERVICE-<suffix>`, le bucket de sauvegarde `gcs-$SERVICE-backups`, la base de données et son utilisateur `$SERVICE` (les tirets deviennent des underscores), le secret du mot de passe de base de données `secret-<sql-instance>-$SERVICE`. Le compte de service partagé par le tenant sous lequel tourne l'application est `cloudrun-sa-$TENANT_PREFIX`.

## Comment modifier les paramètres dans les labs de fonctionnalités {#how-to-change-settings-in-the-feature-labs}

- **Mettre à jour avec le mode avancé.** Sur la page **Deployments**, ouvrez votre déploiement, cliquez sur **Update**, cochez **Enable advanced mode** pour afficher tous les groupes, modifiez les entrées indiquées par le lab et soumettez. La mise à jour exécute le même pipeline plan/apply que le premier déploiement, avec les journaux en temps réel. Les extraits HCL de chaque lab indiquent les *valeurs* à saisir dans le formulaire ; les noms des champs correspondent aux noms des variables.
- **Update-safe vs non update-safe.** Les champs signalés comme update-safe (la colonne **Update-safe** dans le tableau des paramètres de chaque lab) peuvent être modifiés sur un déploiement en cours d'exécution. Modifier un champ **non signalé** déclenche un avertissement indiquant que la modification peut détruire ou remplacer des ressources — par exemple un bucket, le mot de passe de base de données ou l'équilibreur de charge. Lisez l'étape *Étape 2 — Appliquer* du lab avant de confirmer. Lorsque l'option **Enforce Update Safe** du déploiement est activée, les champs non signalés sont en lecture seule et le lab ne peut pas être exécuté tant qu'elle n'est pas désactivée.
- **Le rejet au moment du plan est attendu et formateur.** Plusieurs labs vous demandent volontairement de soumettre une combinaison non valide (CDN sans Cloud Armor, IAP sans utilisateurs). La mise à jour échoue dès l'étape de *plan* avec une erreur mentionnant la variable et rien n'est modifié — c'est le garde-fou qui joue son rôle.
- **Un lab à la fois.** Appliquez, vérifiez, puis effectuez un **Retour arrière** avant de commencer le lab suivant — sauf si un lab précise qu'un lab ultérieur s'appuie sur lui. Transmettre une liste telle que `cron_jobs`, `initialization_jobs`, `storage_buckets` ou `gcs_volumes` **remplace** toute la liste, donc redéclarez tous les éléments que vous souhaitez conserver.
- **Vérifiez en interrogeant directement l'objet déployé.** Un apply vert prouve uniquement que Terraform s'est terminé sans erreur. Chaque étape de *Vérification* lit le service, le job, le bucket, le secret ou la stratégie actifs, ou sollicite le point de terminaison. Les tests de groupe sur ce module ont révélé plusieurs paramètres qui s'appliquaient sans encombre sans rien faire ; la relecture directe est le seul signal fiable.
- **Les variables du Groupe 0 ne sont jamais affichées sur le formulaire** — elles sont définies par la plateforme ou par un module englobant (wrapper). Consultez l'[Annexe](#appendix--group-0-platform-wiring-variables).

---

## Tâche 1 — Déployer le socle de référence [Automatisé] {#task-1--deploy-the-baseline-automated}

### Étape 1.0 — Choisir les paramètres de base {#step-10--choose-the-baseline-settings}

Le socle de référence est volontairement minimal : les valeurs par défaut du module plus les entrées du Groupe 1. Le Groupe 1 (*Project & Identity*) n'a pas de lab dédié — vous le définissez ici. Tout le reste conserve sa valeur par défaut ; les contacts de support et les étiquettes (Groupe 2) font l'objet du Lab 2.

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `project_id` | *(requis)* | Non | Le projet dans lequel tout est créé. |
| `tenant_id` | `"demo"` | Non | 1–7 lettres minuscules/chiffres ; intégré dans chaque nom de ressource et partagé par tous les modules du tenant. **Doit correspondre à votre tenant `Services_GCP`.** |
| `region` | `"us-central1"` | Non | Utilisé uniquement lorsque la région ne peut pas être découverte depuis le sous-réseau `Services_GCP`. |

```hcl
project_id = "<your-project-id>"
tenant_id  = "demo"                # MUST match your Services_GCP deployment
region     = "us-central1"
```

Ce que vous apportent les valeurs par défaut :

- **Un build personnalisé** de l'application Flask d'exemple (`container_image_source = "custom"`), poussé vers l'Artifact Registry partagé et déployé sous forme de service Cloud Run `$SERVICE` sur `gen2`, 1 vCPU / 512Mi, `min_instance_count = 0`, `max_instance_count = 1`, facturation CPU basée sur les requêtes, trafic entrant (ingress) `all`.
- **Une base de données et un utilisateur PostgreSQL** au sein de l'instance Cloud SQL partagée (pas de nouvelle instance), le mot de passe dans Secret Manager, le socket monté sur `/cloudsql` et le job `db-init` exécuté à chaque apply.
- **NFS** depuis le serveur NFS partagé monté sur `/mnt/nfs`, et le câblage **Redis** pointant vers la même VM NFS (qui héberge également Redis).
- **Un bucket de sauvegarde** `gcs-$SERVICE-backups`, un job de sauvegarde quotidien et son déclencheur Cloud Scheduler (02:00 UTC).
- Des sondes de démarrage et de vivacité sur `/healthz` ; **aucun** test de disponibilité (désactivé par défaut et créé uniquement pour un service toujours actif).

### Étape 1.1 — Déployer {#step-11--deploy}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans le menu supérieur de la plateforme RAD, ouvrez **App (Cloud Run)** dans la liste des **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous possédez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et `tenant_id`, et vérifiez les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez l'estimation des coûts dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle s'affiche et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que la vérification d'un projet personnel, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en direct.

2. La plateforme provisionne le service Cloud Run, la base de données et l'utilisateur avec leur secret Secret Manager, la configuration NFS/Redis et le bucket de sauvegarde, compile l'image d'exemple avec Cloud Build, et exécute le job `db-init` avant la création du service. Avec `Services_GCP` déjà présent, un premier déploiement prend environ **10–20 minutes** ; si la plateforme doit provisionner `Services_GCP` au préalable (VPC, Cloud SQL, VM NFS), comptez **20–35 minutes**.

3. Une fois terminé, exécutez le bloc de découverte des **Prérequis** pour définir `SERVICE`, `SERVICE_URL`, `TENANT_PREFIX` et `PROJECT_NUMBER`, puis listez les éléments créés :

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud run jobs list     --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"
   gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name.basename())"
   gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" --filter="name~$SERVICE"
   ```

   Vous devez voir apparaître le service `$SERVICE` ; des jobs incluant `$SERVICE-db-init`, `$SERVICE-db-create`, `$SERVICE-db-export` (sauvegarde) et `$SERVICE-nfs-setup` ; le bucket `gcs-$SERVICE-backups` ; le secret du mot de passe de base de données ; et le job planifié `$SERVICE-backup-schedule`.

---

## Tâche 2 — Accéder au socle de référence et le vérifier [Manuel] {#task-2--access--verify-the-baseline-manual}

1. **L'application répond, et accède à sa base de données.** Interrogez `/`, et non `/healthz` (le front-end de Cloud Run intercepte `/healthz` sur l'URL publique) :

   ```bash
   curl -s "$SERVICE_URL/"          # expect: Hello from Sample App! Visitor count: 1 (then 2, 3, …)
   curl -s "$SERVICE_URL/db"        # expect: {"status":"connected","version":"PostgreSQL 1x.x …"}
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"   # expect 404 — Google's page, not the app's
   ```

   La première requête après une période d'inactivité peut prendre quelques secondes : `min_instance_count = 0` signifie que le service réduit ses instances à zéro. Un compteur de visiteurs qui s'incrémente constitue la preuve de bout en bout — conteneur, socket Cloud SQL, identifiants et schéma fonctionnent tous.

2. **Le service est relié au socle**, et non à des copies intégrées — le VPC partagé et l'instance Cloud SQL partagée :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
     | grep -E "cloudsql-instances|network-interfaces|vpc-access"
   ```

   Vous devez observer une annotation `run.googleapis.com/cloudsql-instances` nommant `<project>:<region>:<instance>` et une interface réseau sur le réseau `Services_GCP`.

3. **La configuration injectée.** Listez les variables d'environnement reçues par le conteneur :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.spec.containers[0].env)"
   ```

   Vous devez trouver `DB_HOST` = `/cloudsql/<project>:<region>:<instance>` (un répertoire de socket), `DB_IP` (l'IP privée de l'instance), `DB_NAME` et `DB_USER` = `$SERVICE`, `DB_PORT` = `5432`, `DB_PASSWORD` comme référence de secret, `CLOUDRUN_SERVICE_URL`, `NFS_SERVER_IP`, et `REDIS_HOST` / `REDIS_PORT` / `REDIS_URL`.

4. **La base de données et son secret.**

   ```bash
   export SQL_CONN=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances'])")
   export SQL_INSTANCE="${SQL_CONN##*:}"
   gcloud sql databases list --instance="$SQL_INSTANCE" --project="$PROJECT" --filter="name=$SERVICE"
   gcloud sql users list --instance="$SQL_INSTANCE" --project="$PROJECT" --filter="name=$SERVICE"
   export DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~secret-.*-${SERVICE}$" --format="value(name.basename())" --limit=1)
   gcloud secrets versions list "$DB_SECRET" --project="$PROJECT"
   ```

5. **Le job d'initialisation s'est exécuté.**

   ```bash
   gcloud run jobs executions list --job="$SERVICE-db-init" --project="$PROJECT" --region="$REGION" \
     --format="table(metadata.name,status.succeededCount,status.failedCount,status.completionTime)"
   ```

   Attendez-vous à au moins une exécution avec `succeededCount = 1`. Ses journaux se terminent par `Sample DB Init complete.`

6. **NFS et le chemin réseau.** Le volume NFS est monté sur `/mnt/nfs` et le service utilise la sortie VPC directe (Direct VPC egress) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
     | grep -B2 -A4 -i "nfs"
   ```

7. **Ce que fournit le front-end.** `/whoami` montre que Cloud Run ajoute votre véritable adresse IP cliente à `X-Forwarded-For` et `Forwarded`, et que `remote_addr` est une adresse de front-end link-local :

   ```bash
   curl -s "$SERVICE_URL/whoami"
   ```

8. **Les étiquettes de la plateforme.** Chaque ressource porte les étiquettes réservées définies par la plateforme :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="yaml(metadata.labels)"
   ```

   Attendez-vous à trouver `application`, `deployment`, `tenant`, `managed-by: app-cloudrun` et `module: app-cloudrun`. Le Lab 2 y ajoutera les vôtres.

---

## Partie 2 — Labs de fonctionnalités {#part-2--feature-labs}

Chaque lab suppose acquis le socle de la Tâche 1 et les variables de shell des **Prérequis**. Les valeurs indiquées dans les extraits de *Configuration* sont celles vérifiées sur un déploiement réel de ce module, adaptées avec des variables génériques.

### Lab 2 — Utilisateurs de support et étiquettes de ressources (Groupe 2) {#lab-2--support-users--resource-labels-group-2}

> **Objectif :** s'assurer que les alertes parviennent bien à une personne, et que chaque ressource créée par le module puisse être identifiée pour la facturation et l'inventaire.

**Vous allez :** vous ajouter comme contact de support et repérer le canal de notification ainsi créé · ajouter vos propres étiquettes et les lire sur plusieurs types de ressources · observer quelles clés d'étiquettes sont réservées par la plateforme.
**Durée :** 10–15 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `support_users` | `[]` | Oui | Adresses e-mail recevant les alertes Cloud Monitoring (un canal de notification par e-mail chacun). N'accorde aucun droit IAM. Les alertes du Lab 6 (test de disponibilité, `alert_policies`) arrivent ici. |
| `resource_labels` | `{}` | Oui | Étiquettes appliquées sur chaque ressource créée par le module. Les clés `application`, `deployment`, `tenant`, `managed-by` et `module` sont réservées et toujours écrasées par la plateforme. |

#### Étape 1 — Configurer {#step-1--configure}

```hcl
support_users   = ["<your-email>"]                               # receives every alert this module raises
resource_labels = { environment = "lab", cost-center = "training" }   # applied to every resource
```

#### Étape 2 — Appliquer {#step-2--apply}

**Update**. Crée un canal de notification par e-mail et réétiquette le service, les jobs, les buckets et les secrets sur place (~2 min). Aucun trafic de révision n'est perturbé.

#### Étape 3 — Vérifier {#step-3--verify}

```bash
# Labels on the service, a job, a bucket and a secret
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="yaml(metadata.labels)"
gcloud run jobs describe "$SERVICE-db-init" --project="$PROJECT" --region="$REGION" --format="yaml(metadata.labels)"
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format=yaml | grep -A8 -i labels
gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(labels)"

# The notification channel for your address
gcloud beta monitoring channels list --project="$PROJECT" --format="table(displayName,type,labels.email_address)"
```

Attendez-vous à voir `environment: lab` et `cost-center: training` aux côtés des étiquettes réservées sur chaque ressource (`$DB_SECRET` est défini à la Tâche 2, étape 4), ainsi qu'un canal `email` associé à votre adresse.

#### Explorer davantage {#explore-further}

- Ajoutez `module = "mine"` à `resource_labels` et faites un nouvel apply : l'étiquette affiche toujours `module: app-cloudrun` — les clés réservées ne peuvent pas être écrasées.
- Réalisez ensuite le Lab 6 avec un test de disponibilité : son alerte d'échec sera envoyée à ce canal.

#### Pièges à éviter {#watch-out-for}

- Les valeurs des étiquettes doivent comporter des lettres minuscules, des chiffres, `_` ou `-` (règles des étiquettes GCP) ; une adresse e-mail n'est pas une valeur d'étiquette valide.
- `support_users` ne sert qu'à router les alertes. Il ne donne aucun accès au projet.

#### Retour arrière {#revert}

```hcl
support_users   = []
resource_labels = {}
```

Les canaux de notification sont supprimés et vos étiquettes retirées ; les étiquettes réservées restent en place.

---

### Lab 3 — Identité de l'application (Groupe 3) {#lab-3--application-identity-group-3}

> **Objectif :** modifier la manière dont l'application est nommée et versionnée, et suivre l'incrémentation de version jusqu'à la création d'une nouvelle image et révision.

**Vous allez :** définir un nom d'affichage et une description · incrémenter `application_version` et observer le déploiement d'un nouveau build et d'une nouvelle révision · vérifier quel nom ne doit jamais changer.
**Durée :** 15 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-1}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `application_name` | `"crapp"` | Oui (indicateur) — mais voir *Pièges à éviter* | Base de chaque nom de ressource (`$SERVICE`, jobs, buckets, secrets, base de données). 1–20 car., minuscules, commence par une lettre. |
| `application_display_name` | `"App_CloudRun Application"` | Oui | Nom lisible par un humain pour l'interface de la plateforme et les tableaux de bord. |
| `application_description` | `"App CloudRun Custom Application…"` | Oui | Description enregistrée sur le service Cloud Run. |
| `application_version` | `"1.0.0"` | Oui | Tag d'image pour le build personnalisé ; sa modification déclenche une nouvelle exécution de Cloud Build et une nouvelle révision. Injecté sous `APP_VERSION`. |

#### Étape 1 — Configurer {#step-1--configure-1}

```hcl
application_display_name = "App CloudRun (lab)"            # free text, safe to change any time
application_description  = "Foundation module lab walkthrough"
application_version      = "1.0.1"                         # was 1.0.0 — forces a new build + revision
```

#### Étape 2 — Appliquer {#step-2--apply-1}

**Update** avec le mode avancé. Le changement de version exécute Cloud Build (~3–5 min) et crée une nouvelle révision ; les champs de nom mettent à jour le service sur place. Rien n'est détruit.

#### Étape 3 — Vérifier {#step-3--verify-1}

```bash
# Image tag and APP_VERSION follow application_version
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[0].image)"          # expect …/crapp:1.0.1 (or @sha256 digest of it)
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A1 APP_VERSION   # expect 1.0.1

# A new revision now serves 100% of traffic
gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)"

# Description recorded on the service
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i description

# The build that produced it
gcloud builds list --project="$PROJECT" --region="$REGION" --limit=3 --format="table(id,status,createTime)"
```

L'application répond toujours `curl -s "$SERVICE_URL/"` avec un compteur croissant — la base de données survit à une nouvelle révision.

#### Explorer davantage {#explore-further-1}

- Définissez `application_version = "latest"` et faites un nouvel apply : le tag `latest` est réutilisé, il devient donc impossible de déduire ce qui tourne à partir du tag. Lisez plutôt le **digest** de l'image depuis la révision (`gcloud run revisions describe <rev> --format="value(status.imageDigest)"`).
- Faites un nouvel apply avec la *même* version : aucun nouveau build ni révision n'est créé — une recompilation nécessite un changement de version.

#### Pièges à éviter {#watch-out-for-1}

- **Ne modifiez jamais `application_name` (ou `tenant_id`) après le premier déploiement**, même si le formulaire n'affiche pas d'avertissement. Tous deux sont intégrés dans chaque nom de ressource ; un changement crée un tout nouveau service, une nouvelle base de données, de nouveaux buckets et secrets, et rend orphelins ou détruit les anciens.
- `application_name` plus `tenant_id` doivent respecter la limite de 63 caractères imposée pour les noms — un contrôle au moment du plan rejette les noms trop longs.

#### Retour arrière {#revert-1}

Restaurez `application_display_name = "App_CloudRun Application"` et la description par défaut. Laissez `application_version` à la valeur incrémentée (revenir à `1.0.0` déclenche un autre build), ou rétablissez-la si vous préférez.

---

### Lab 4 — Runtime et mise à l'échelle (Groupe 4) {#lab-4--runtime--scaling-group-4}

> **Objectif :** contrôler la source du conteneur, son dimensionnement, sa facturation et sa mise à l'échelle, et répartir le trafic entre les révisions.

**Vous allez :** garder une instance active (warm) et en autoriser deux · basculer sur du CPU toujours alloué et un délai d'expiration de requête plus long · redimensionner le CPU/la mémoire · purger les anciennes révisions · répartir le trafic avec un canary tagué.
**Durée :** 30–40 min · **Coût :** **oui** — `min_instance_count = 1` avec `cpu_always_allocated = true` facture un vCPU en continu jusqu'au retour arrière · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-2}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `deploy_application` | `true` | Non | `false` provisionne tout sauf le service Cloud Run (approche orientée infrastructure). |
| `container_image_source` | `"custom"` | Non | `custom` compile l'application d'exemple avec Cloud Build ; `prebuilt` déploie `container_image` tel quel. |
| `container_image` | `""` | Oui | URI de l'image pour `prebuilt` (alors requise — vérification au plan), ou la source de mise en miroir. |
| `container_build_config` | `{ enabled = true }` | Oui | Chemin/contenu du Dockerfile, contexte, `build_args`, dépôt cible, `base_image` pour le build personnalisé. |
| `enable_image_mirroring` | `true` | Oui | Copie une image externe dans Artifact Registry avant de la déployer. |
| `min_instance_count` | `0` | Oui | Instances gardées actives (warm). `0` = mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Oui | Plafond de mise à l'échelle (limite de coût). Doit être ≥ min (vérification au plan). |
| `cpu_always_allocated` | `false` | Oui | `true` = CPU entre les requêtes (facturation par instance) ; `false` = basé sur les requêtes. |
| `container_port` | `8080` | Oui | Port d'écoute de l'application — l'exemple écoute sur 8080. |
| `container_protocol` | `"http1"` | Oui | `http1` ou `h2c` (HTTP/2 de bout en bout, ex. gRPC). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Oui | Limites CPU/mémoire (`cpu_request`, `mem_request` facultatifs). |
| `execution_environment` | `"gen2"` | Oui | `gen2` est requis pour NFS et GCS Fuse ; `gen1` avec l'un ou l'autre est rejeté au plan. |
| `timeout_seconds` | `300` | Oui | Délai d'expiration par requête, 0–3600. |
| `enable_cloudsql_volume` | `true` | Oui | Monte le socket Cloud SQL. Doit être `false` quand `database_type = "NONE"`. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Oui | Emplacement où apparaît le répertoire de socket. |
| `traffic_split` | `[]` | Oui | Répartition du trafic entre révisions ; la somme des entrées doit valoir 100. |
| `max_revisions_to_retain` | `7` | Oui | Les révisions plus anciennes au-delà de ce seuil sont purgées après chaque apply (0 = ne jamais purger). |

#### Étape 1 — Configurer {#step-1--configure-2}

```hcl
min_instance_count      = 1          # one instance always warm: no cold starts (and it bills)
max_instance_count      = 2          # allow scale-out to two instances
cpu_always_allocated    = true       # CPU between requests; instance-based billing
timeout_seconds         = 600        # 10-minute request timeout
container_port          = 8080       # the sample app's real port — do not change
container_resources     = { cpu_limit = "1000m", memory_limit = "1Gi" }   # more memory
max_revisions_to_retain = 5          # keep at most 5 revisions
```

#### Étape 2 — Appliquer {#step-2--apply-2}

**Update**. Tous les champs sont update-safe : une nouvelle révision est créée et le trafic bascule vers elle (~2–4 min). Aucun build ne s'exécute.

#### Étape 3 — Vérifier {#step-3--verify-2}

```bash
# Scaling, billing mode, environment and timeout on the live revision template
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -E "minScale|maxScale|cpu-throttling|execution-environment|timeoutSeconds"
# expect minScale '1', maxScale '2', cpu-throttling 'false', execution-environment gen2, timeoutSeconds 600

# Resources actually applied to the container
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].resources)"        # expect memory 1Gi, cpu 1000m

# Revision count stays at or below 5
gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(name)" | wc -l
```

Avec `min_instance_count = 1`, la première requête après une longue période d'inactivité ne subit plus de démarrage à froid : `curl -s -w "\n%{time_total}s\n" "$SERVICE_URL/"`.

#### Explorer davantage {#explore-further-2}

- **Canary avec URL taguée.** Notez les noms de la révision actuelle et précédente (`gcloud run revisions list …`), puis définissez :

  ```hcl
  traffic_split = [
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",   percent = 90 },
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", percent = 10, revision = "<previous-revision-name>", tag = "canary" },
  ]
  ```

  Vérifiez avec `gcloud run services describe "$SERVICE" … --format="yaml(status.traffic)"` ; la révision taguée obtient sa propre URL (`https://canary---…run.app`). Une répartition dont la somme n'est pas égale à 100 est rejetée au plan.
- **Image précompilée.** Définissez `container_image_source = "prebuilt"` et `container_image = "us-docker.pkg.dev/cloudrun/container/hello"` ; avec la mise en miroir activée, l'image est d'abord copiée dans Artifact Registry (vérifiez le chemin de l'image de la révision). Laisser `container_image` vide fait échouer le plan. Revenez à `custom` après — les points de terminaison d'exemple n'existent que dans le build personnalisé.
- **CPU fractionnaire.** `container_resources = { cpu_limit = "500m", memory_limit = "512Mi" }` n'est accepté qu'avec `cpu_always_allocated = false` ; gen2 ne descend jamais en dessous de 512Mi.
- **`execution_environment = "gen1"`** avec le `enable_nfs = true` par défaut — soumettez-le et observez l'erreur générée au plan.

#### Pièges à éviter {#watch-out-for-2}

- `cpu_always_allocated = true` avec `min_instance_count ≥ 1` mobilise un vCPU 24/7. Ne l'utilisez que pour les tâches s'exécutant sans requête entrante (planificateurs, workers de file d'attente, WebSockets, initialisation lente au premier démarrage).
- Chaque service frère `additional_services` hérite de `cpu_always_allocated` (Lab 7), ses ressources doivent donc être d'au moins 1000m/512Mi.
- `container_port` doit correspondre au port sur lequel l'application écoute ; une discordance fait échouer la sonde de démarrage et la révision ne devient jamais prête.
- `max_revisions_to_retain` ne purge qu'après un apply **réussi**.

#### Retour arrière {#revert-2}

```hcl
min_instance_count      = 0
max_instance_count      = 1
cpu_always_allocated    = false
timeout_seconds         = 300
container_resources     = { cpu_limit = "1000m", memory_limit = "512Mi" }
max_revisions_to_retain = 7
traffic_split           = []
```

Le retour arrière crée une révision de plus et remet le service en mise à l'échelle à zéro (stoppe la facturation continue).

---

### Lab 5 — Variables d'environnement et secrets (Groupe 5) {#lab-5--environment-variables--secrets-group-5}

> **Objectif :** fournir la configuration et les identifiants au conteneur de la bonne manière, et observer le module protéger un identifiant placé au mauvais endroit.

**Vous allez :** ajouter des variables d'environnement brutes · référencer un secret Secret Manager existant · observer la conversion automatique en secret d'une variable brute nommée comme un identifiant · ajouter une annotation personnalisée et des étiquettes de service.
**Durée :** 20–30 min · **Coût :** aucun · **Prérequis / configuration externe :** créer un secret (Étape 1).

#### Paramètres de ce groupe {#settings-in-this-group-3}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `environment_variables` | `{}` | Oui | Variables d'environnement en texte brut. Visibles par quiconque peut lire le service. |
| `secret_environment_variables` | `{}` | Oui | Nom de variable d'environnement → nom de secret **existant** ; résolu au démarrage de l'instance (`latest`). Le module accorde au compte de service l'accès par secret. |
| `protect_sensitive_environment_variables` | `true` | Oui | Déplace toute entrée `environment_variables` non vide dont le nom ressemble à un identifiant (`…PASSWORD`, `…SECRET`, `…TOKEN`, `…API_KEY`, …) vers Secret Manager et l'injecte sous forme de secret sous le même nom. Masqué dans les projets gérés par RAD. |
| `service_annotations` | `{}` | Oui | Annotations sur le service. Les clés sous `run.googleapis.com/` sont des annotations système et sont rejetées par l'API. |
| `service_labels` | `{}` | Oui | Étiquettes sur le service Cloud Run uniquement (en plus de `resource_labels`). |
| `secret_rotation_period` | `"2592000s"` | Oui | Fréquence à laquelle Secret Manager publie une *notification* de rotation pour les secrets du module (le mot de passe DB). Doit se terminer par `s`. Ne fait aucune rotation automatique par lui-même — voir Lab 12. |
| `secret_propagation_delay` | `30` | Oui | Secondes d'attente après l'écriture d'un secret avant que les ressources dépendantes ne l'utilisent. |

#### Étape 1 — Configurer {#step-1--configure-3}

Créez le secret que le service référencera (un réplica géré par l'utilisateur dans votre région, ce qui satisfait les stratégies d'organisation restreignant la localisation) :

```bash
printf 'lab-demo-value' | gcloud secrets create lab-api-key --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

Puis définissez :

```hcl
environment_variables = {
  LOG_LEVEL    = "info"                 # plain configuration
  LAB_PASSWORD = "not-a-real-secret"    # credential-named: will be moved into Secret Manager
}
secret_environment_variables = { API_KEY = "lab-api-key" }               # existing secret by NAME
service_annotations          = { "lab.example.com/owner" = "platform-team" }  # NOT run.googleapis.com/*
service_labels               = { tier = "frontend" }
secret_propagation_delay     = 45
```

#### Étape 2 — Appliquer {#step-2--apply-3}

**Update**. Crée un nouveau secret pour `LAB_PASSWORD`, des autorisations IAM sur les deux secrets et une nouvelle révision (~3 min).

#### Étape 3 — Vérifier {#step-3--verify-3}

```bash
# Plain vs secret-backed variables on the live revision
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A4 -E "LOG_LEVEL|LAB_PASSWORD|API_KEY"
# expect LOG_LEVEL with a plain value; LAB_PASSWORD and API_KEY with valueFrom.secretKeyRef

# The secret the module created for LAB_PASSWORD
gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE}-env-lab-password" --format="value(name.basename())"

# The service account was granted access to your secret
gcloud secrets get-iam-policy lab-api-key --project="$PROJECT" --format="table(bindings.role,bindings.members)"

# Annotation and labels
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(metadata.annotations,metadata.labels)" | grep -E "lab.example.com|tier"
```

La valeur de `LAB_PASSWORD` n'apparaît plus nulle part dans la description du service — seule figure une référence de secret — et pourtant le conteneur voit toujours `LAB_PASSWORD=not-a-real-secret`.

#### Explorer davantage {#explore-further-3}

- Référencez un secret qui n'existe pas (`{ MISSING = "no-such-secret" }`) et observez l'erreur — les secrets référencés doivent exister avant le déploiement.
- Modifiez `secret_rotation_period` en `"604800s"` (7 jours) et vérifiez `gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(rotation,topics)"`. Essayez `"604800"` sans le `s` pour observer le contrôle de format au moment du plan.
- Nommez une variable `SMTP_PASSWORD_SECRET_NAME` : les noms tels que `*_SECRET_NAME`, `*_SECRET_ID`, `*_KEY_ID` et `*_PUBLIC_KEY` sont intentionnellement conservés en texte brut.

#### Pièges à éviter {#watch-out-for-3}

- Une clé `run.googleapis.com/…` dans `service_annotations` fait échouer l'apply — ce sont des annotations système.
- Les valeurs des secrets sont lues au **démarrage de l'instance** ; l'ajout d'une nouvelle version de secret n'atteint pas les instances actives tant qu'une nouvelle instance n'a pas démarré.
- `secret_rotation_period` ne fait que planifier une notification. Sans `enable_auto_password_rotation` (Lab 12), aucune rotation ne se produit.

#### Retour arrière {#revert-3}

Définissez `environment_variables = {}`, `secret_environment_variables = {}`, `service_annotations = {}`, `service_labels = {}`, `secret_propagation_delay = 30`, et appliquez. Supprimez ensuite le secret que vous avez créé vous-même : `gcloud secrets delete lab-api-key --project="$PROJECT"`. Le secret `LAB_PASSWORD` créé par le module est supprimé par l'apply.

---

### Lab 6 — Jobs d'initialisation et contrôles de santé (Groupe 6) {#lab-6--initialization-jobs--health-checks-group-6}

> **Objectif :** contrôler ce qui s'exécute avant le démarrage du service et la manière dont sa santé est évaluée — la chaîne de jobs d'initialisation, des sondes ajustées dans Cloud Run, un test de disponibilité externe véritablement fonctionnel et une alerte qui vous parvient.

**Vous allez :** ajouter un second job d'initialisation après `db-init` sans le perdre · ajuster la sonde de démarrage · créer un test de disponibilité sur le bon chemin · ajouter une stratégie d'alerte de latence · comprendre pourquoi un service à mise à l'échelle à zéro n'a pas de test de disponibilité.
**Durée :** 30–40 min · **Coût :** faible — le test de disponibilité nécessite `min_instance_count ≥ 1` · **Prérequis / configuration externe :** `support_users` défini (Lab 2) pour recevoir l'e-mail d'alerte.

#### Paramètres de ce groupe {#settings-in-this-group-4}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", image = "postgres:15-alpine", script_path = "scripts/db-init.sh", execute_on_apply = true }]` | Oui | Jobs Cloud Run (`$SERVICE-<name>`) exécutés pendant le déploiement, avant la création du service, ordonnés par `depends_on_jobs`. Fournir la liste **remplace** le `db-init` par défaut. |
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Oui | Étape de validation avant qu'une instance ne reçoive du trafic. Champs : `type` (HTTP/TCP), `path`, `initial_delay_seconds` (10), `timeout_seconds` (5), `period_seconds` (10), `failure_threshold` (10). |
| `prereq_subnet_cidr_override` | `""` | Non | CIDR du sous-réseau principal du VPC **intégré (inline)** (mode autonome uniquement). Vide = un /24 unique dérivé par déploiement. Ignoré sur un socle `Services_GCP`, ce lab ne le modifie donc pas. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Oui | Sonde de vivacité ; redémarre le conteneur après `failure_threshold` (3) échecs tous les `period_seconds` (30). |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Non | Test de disponibilité Cloud Monitoring depuis des emplacements mondiaux (`check_interval` 60s, `timeout` 10s). Créé **uniquement** quand `min_instance_count ≥ 1` déployé et le point de terminaison est public. |
| `alert_policies` | `[]` | Oui | Stratégies d'alerte sur seuil de métrique notifiant `support_users`. Champs : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`, `per_series_aligner` (par défaut `ALIGN_MEAN`). |

#### Étape 1 — Configurer {#step-1--configure-4}

```hcl
# The list REPLACES the default, so restate db-init and chain a second job after it
initialization_jobs = [
  { name = "db-init", image = "postgres:15-alpine", command = ["/bin/sh"],
    script_path = "scripts/db-init.sh", execute_on_apply = true },
  { name = "post-init", image = "busybox:1.36", command = ["sh", "-c"],
    args = ["echo post-init ran"], depends_on_jobs = ["db-init"], execute_on_apply = true },
]
min_instance_count = 1          # Group 4 — REQUIRED for an uptime check; scale-to-zero services get none
startup_probe_config = {
  enabled = true, type = "HTTP", path = "/healthz",     # probes bypass the front end: /healthz is fine here
  initial_delay_seconds = 15, timeout_seconds = 5, period_seconds = 10, failure_threshold = 12
}
# "/" NOT "/healthz": the uptime check goes THROUGH Cloud Run's front end, which answers /healthz itself (404)
uptime_check_config = { enabled = true, path = "/", check_interval = "60s", timeout = "10s" }
alert_policies = [{
  name               = "high-latency"
  metric_type        = "run.googleapis.com/request_latencies"
  comparison         = "COMPARISON_GT"
  threshold_value    = 1000          # ms
  duration_seconds   = 300
  aggregation_period = "60s"
  per_series_aligner = "ALIGN_PERCENTILE_99"   # REQUIRED: latency is a DISTRIBUTION metric
}]
```

#### Étape 2 — Appliquer {#step-2--apply-4}

**Update**. Exécute `db-init` puis `post-init`, crée une nouvelle révision (modification de sonde), un test de disponibilité et son alerte d'échec, ainsi que la stratégie d'alerte (~4 min).

#### Étape 3 — Vérifier {#step-3--verify-4}

```bash
# Both init jobs exist and ran, post-init after db-init
gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE-(db-init|post-init)$"
gcloud run jobs executions list --job="$SERVICE-post-init" --project="$PROJECT" --region="$REGION" \
  --format="table(metadata.name,status.succeededCount,status.completionTime)"
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-post-init\"" \
  --project="$PROJECT" --limit=5 --format="value(textPayload)"          # expect: post-init ran

# Probe settings on the live revision
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].startupProbe,spec.template.spec.containers[0].livenessProbe)"
# expect startupProbe failureThreshold 12, initialDelaySeconds 15, httpGet path /healthz

# Uptime check exists, probing "/" on the run.app host
gcloud monitoring uptime list-configs --project="$PROJECT" \
  --format="table(displayName,httpCheck.path,period,monitoredResource.labels.host)" | grep -i "$SERVICE"

# Alert policies
gcloud alpha monitoring policies list --project="$PROJECT" --format="table(displayName,enabled)" | grep -iE "high-latency|$SERVICE"
```

Comparez les `completionTime` des dernières exécutions de `$SERVICE-db-init` et `$SERVICE-post-init` : `post-init` se termine après `db-init`. L'application compte toujours les visiteurs (`curl -s "$SERVICE_URL/"`), prouvant que `db-init` a survécu au remplacement. Dans la console, **Monitoring → Uptime checks** devrait passer au vert en quelques minutes. Vous pouvez confirmer l'importance du chemin depuis votre poste : `curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"` renvoie 200 tandis que `…/healthz` renvoie 404.

#### Explorer davantage {#explore-further-4}

- Définissez `min_instance_count = 0` avec le test de disponibilité toujours activé et appliquez : le test de disponibilité est **supprimé**. C'est délibéré — un test ciblant un service réduisant ses instances à zéro soit le signale indisponible à chaque démarrage à froid, soit le maintient chaud et en modifie discrètement le coût.
- Faites échouer la sonde de démarrage exprès (`path = "/does-not-exist"`) : la nouvelle révision ne devient jamais prête, le trafic reste sur l'ancienne, et l'apply signale l'échec. Effectuez le retour arrière immédiatement.
- Basculez la sonde de démarrage sur `type = "TCP"` — le choix privilégié pour les applications sans point de terminaison HTTP de santé léger.
- Définissez `execute_on_apply = false` sur `post-init` : le job est toujours créé, mais l'apply ne l'exécute plus ; exécutez-le vous-même avec `gcloud run jobs execute "$SERVICE-post-init" --project="$PROJECT" --region="$REGION" --wait`.

#### Pièges à éviter {#watch-out-for-4}

- **Fournir `initialization_jobs` sans `db-init` supprime la configuration de la base de données d'exemple** des futurs apply — rien dans le plan ne le signale.
- Les jobs Cloud Run nécessitent au moins 1 vCPU / 512Mi ; les jobs d'initialisation se terminent avant la création du service sur Cloud Run.
- Un test de disponibilité sur `/healthz` via une URL `run.app` échouera en permanence alors même que le service est sain.
- `request_latencies` avec l'aligneur par défaut `ALIGN_MEAN` (ou `ALIGN_DELTA`) est rejeté par Cloud Monitoring — utilisez un aligneur `ALIGN_PERCENTILE_*`. Les seuils sont évalués par révision, et non par service.
- Un point de terminaison de vivacité lent provoque des redémarrages intempestifs ; gardez-le le plus simple possible.
- `prereq_subnet_cidr_override` n'a d'importance que pour un déploiement autonome possédant son propre VPC ; le modifier à cet endroit remplace le sous-réseau.

#### Retour arrière {#revert-4}

```hcl
initialization_jobs  = [{ name = "db-init", image = "postgres:15-alpine", command = ["/bin/sh"],
                          script_path = "scripts/db-init.sh", execute_on_apply = true }]
min_instance_count   = 0
startup_probe_config = { enabled = true, path = "/healthz" }
uptime_check_config  = { enabled = false, path = "/" }
alert_policies       = []
```

Le job `post-init`, le test de disponibilité, son alerte et la stratégie sont supprimés ; le service repasse en mise à l'échelle à zéro.

---

### Lab 7 — Tâches cron, services additionnels et sidecars (Groupe 7) {#lab-7--cron-jobs-additional-services--sidecars-group-7}

> **Objectif :** exécuter des traitements aux côtés du service principal — un job planifié, un service Cloud Run frère et un conteneur sidecar au sein de la révision — et démontrer comment joindre le frère.

**Vous allez :** ajouter un job déclenché par Cloud Scheduler · déployer un service frère et observer l'injection de son URL · ajouter un conteneur sidecar · prouver que le frère est joignable depuis l'intérieur du VPC.
**Durée :** 30–40 min · **Coût :** faible (un service supplémentaire, à mise à l'échelle à zéro) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-5}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `cron_jobs` | `[]` | Oui | Jobs Cloud Run (`$SERVICE-<name>`) déclenchés par Cloud Scheduler (`$SERVICE-<name>-trigger`). `paused = true` conserve le job mais interrompt la planification. |
| `additional_services` | `[]` | Oui | Services Cloud Run distincts nommés `$SERVICE-<name>`. Leur URL est injectée dans le conteneur principal sous `<NAME>_URL` (ou `output_env_var_name`). Le trafic entrant par défaut est interne uniquement. |
| `additional_containers` | `[]` | Oui | Conteneurs sidecar dans la **même** révision, partageant `localhost`. `startup_tcp_port` fait attendre le conteneur principal jusqu'à ce que le sidecar soit prêt. |

#### Étape 1 — Configurer {#step-1--configure-5}

Obtenez d'abord la future structure d'URL du service frère : elle est de la forme `https://$SERVICE-api-$PROJECT_NUMBER.$REGION.run.app`. Affichez-la et collez-la dans le job cron ci-dessous :

```bash
echo "https://${SERVICE}-api-${PROJECT_NUMBER}.${REGION}.run.app/"
```

```hcl
additional_services = [{
  name  = "api"                 # becomes service $SERVICE-api, URL injected as API_URL
  image = "nginx:alpine"
  port  = 80
}]

additional_containers = [{
  name    = "sidecar"           # runs inside the main revision
  image   = "curlimages/curl:8.11.1"
  command = ["sh", "-c"]
  args    = ["while true; do sleep 3600; done"]
}]

cron_jobs = [{
  name     = "sibling-probe"    # job $SERVICE-sibling-probe, trigger $SERVICE-sibling-probe-trigger
  schedule = "0 3 * * *"        # daily 03:00 UTC
  image    = "curlimages/curl:8.11.1"
  command  = ["sh", "-c"]
  # %%{ escapes HCL's template syntax; curl receives %{http_code}
  args     = ["curl -sS -o /dev/null -w 'SIBLING_HTTP=%%{http_code}\\n' --max-time 30 <sibling-url-from-above> || echo SIBLING_UNREACHABLE"]
}]

vpc_egress_setting = "ALL_TRAFFIC"   # Group 15 — REQUIRED for the internal-only sibling to be reachable (see Watch out for)
```

#### Étape 2 — Appliquer {#step-2--apply-5}

**Update**. Crée le service frère, le job cron et son déclencheur Scheduler, ainsi qu'une nouvelle révision à deux conteneurs pour le service principal (~4–6 min).

#### Étape 3 — Vérifier {#step-3--verify-5}

```bash
# The sibling service exists with internal-only ingress
gcloud run services describe "$SERVICE-api" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i "ingress"

# Its URL was injected into the main container
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers)" | grep -A1 API_URL

# The main revision now has two containers
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[].name)"

# Scheduler trigger and job
gcloud scheduler jobs describe "$SERVICE-sibling-probe-trigger" --project="$PROJECT" --location="$REGION" \
  --format="value(schedule,state)"                    # expect 0 3 * * *   ENABLED

# Run the job now and read its result
gcloud run jobs execute "$SERVICE-sibling-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-sibling-probe\"" \
  --project="$PROJECT" --limit=5 --format="value(textPayload)"     # expect SIBLING_HTTP=200
```

Depuis votre poste de travail, le service frère n'est **pas** accessible — il est exclusivement interne : `curl -s -o /dev/null -w "%{http_code}\n" "https://${SERVICE}-api-${PROJECT_NUMBER}.${REGION}.run.app/"` renvoie 404.

#### Explorer davantage {#explore-further-5}

- Définissez `vpc_egress_setting = "PRIVATE_RANGES_ONLY"` (valeur par défaut), refaites un apply et relancez le job : il affiche désormais `SIBLING_HTTP=404`. L'URL injectée correspond au nom d'hôte public `run.app` du frère, donc avec une sortie vers les plages privées (private-ranges egress), l'appel n'entre jamais dans le VPC et le frère réservé au trafic interne le rejette.
- Définissez `paused = true` sur le job cron et vérifiez que l'état du planificateur devient `PAUSED` tandis que le job peut toujours être exécuté manuellement.

#### Pièges à éviter {#watch-out-for-5}

- Les jobs d'initialisation (exécutés une fois par apply, avant le service) relèvent du Groupe 6 — voir Lab 6. Les jobs cron traités ici s'exécutent selon un planning et ne bloquent jamais l'apply.
- Les `additional_services` héritent de `cpu_always_allocated` ; avec l'allocation continue de CPU, ils requièrent au moins 1000m/512Mi (valeurs par défaut).
- Dans les chaînes HCL, `%{` démarre une directive de template — échappez-la en `%%{`.
- Un sidecar avec `mount_nfs = true` monte le partage sur **son propre** `nfs_mount_path` (par défaut `/data/db`), et non sur le chemin du conteneur principal.

#### Retour arrière {#revert-5}

```hcl
additional_services   = []
additional_containers = []
cron_jobs             = []
vpc_egress_setting    = "PRIVATE_RANGES_ONLY"
```

Le service frère, le job et le déclencheur sont supprimés, et la révision principale revient à un seul conteneur.

---

### Lab 8 — CI/CD et intégration GitHub (Groupe 8) {#lab-8--cicd--github-integration-group-8}

> **Objectif :** appliquer Binary Authorization sur le service et comprendre (ou exécuter) le pipeline de build piloté par GitHub et de promotion Cloud Deploy.

**Vous allez :** activer Binary Authorization et vérifier son application sur le service et ses frères · observer un garde-fou au moment du plan sur les options Cloud Deploy · *(externe)* connecter un dépôt GitHub et compiler à chaque push · *(externe)* promouvoir une version à travers dev → staging → prod.
**Durée :** 20 min (Binary Authorization) / 40+ min (CI/CD) · **Coût :** aucun (les étapes Cloud Deploy ajoutent des services) · **Prérequis / configuration externe :** **[Configuration externe requise]** pour CI/CD uniquement — un dépôt GitHub que vous contrôlez et soit un Personal Access Token (scopes `repo`, `admin:repo_hook`) soit un identifiant d'installation de la Cloud Build GitHub App. Binary Authorization ne nécessite rien d'externe.

#### Paramètres de ce groupe {#settings-in-this-group-6}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Oui | Crée une connexion Cloud Build v2 GitHub et un déclencheur au push. Nécessite `github_repository_url` (contrôle au plan) et un jeton ou un jeton stocké existant. |
| `github_repository_url` | `""` | Oui | `https://github.com/ORG/REPO`. |
| `github_token` | `""` | Oui | PAT utilisé pour créer la connexion ; stocké sous `secret-$SERVICE-github-token` et réutilisé ensuite. Sensible. |
| `github_app_installation_id` | `""` | Oui | Installation de la Cloud Build GitHub App (recommandé pour les organisations). |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Oui | `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `description`, `substitutions`. |
| `enable_cloud_deploy` | `false` | Oui | Crée un pipeline Cloud Deploy et un service par étape. Requiert `enable_cicd_trigger` (contrôle au plan). |
| `cicd_enable_cloud_deploy` | `false` | Oui | Le déclencheur crée des releases Cloud Deploy au lieu de mettre à jour le service. Requiert `enable_cloud_deploy` (contrôle au plan). |
| `cloud_deploy_stages` | dev, staging, prod (prod requiert approbation) | Oui | Étapes ordonnées : `name`, `target_name`, `service_name`, `project_id`, `region`, `require_approval`, `auto_promote`. |
| `enable_binary_authorization` | `false` | Non | Définit Binary Authorization sur le service **et** chaque frère `additional_services` ; crée l'attestateur, la clé KMS et la stratégie si absents et atteste l'image compilée. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Oui | `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY` (uniquement quand `Services_GCP` n'a pas configuré la stratégie). |

#### Étape 1 — Configurer {#step-1--configure-6}

Binary Authorization (sans configuration externe) :

```hcl
enable_binary_authorization = true
binauthz_evaluation_mode    = "ALWAYS_ALLOW"   # observe first; REQUIRE_ATTESTATION / ALWAYS_DENY block by design
```

CI/CD (externe — uniquement si vous disposez d'un dépôt et des identifiants) :

```hcl
enable_cicd_trigger   = true
github_repository_url = "https://github.com/<your-org>/<your-repo>"
github_token          = "<your-github-pat>"        # or github_app_installation_id = "<installation-id>"
cicd_trigger_config   = { branch_pattern = "^main$", ignored_files = ["**.md"] }
```

#### Étape 2 — Appliquer {#step-2--apply-6}

**Update**. `enable_binary_authorization` n'est pas update-safe : le service est mis à jour avec une référence de stratégie Binary Authorization et l'image est signée (~5 min). Le CI/CD ajoute la connexion, le lien vers le dépôt et le déclencheur (~3 min).

#### Étape 3 — Vérifier {#step-3--verify-6}

```bash
# Binary Authorization is set on the service (and on any additional_services sibling)
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i "binary-authorization"
# expect run.googleapis.com/binary-authorization: default

# The project policy and its evaluation mode
gcloud container binauthz policy export --project="$PROJECT"
gcloud container binauthz attestors list --project="$PROJECT"
```

Si vous avez configuré le CI/CD :

```bash
gcloud builds triggers list --project="$PROJECT" --region="$REGION" --format="table(name,disabled)"
# push a commit to the matching branch, then:
gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5 --format="table(id,status,createTime)"
```

Attendez-vous à un déclencheur dont le nom contient votre tenant et le nom de l'application, ainsi qu'à un nouveau build (et une nouvelle révision) à chaque push sur la branche.

#### Explorer davantage {#explore-further-6}

- **Garde-fous.** Soumettez `cicd_enable_cloud_deploy = true` seul, puis `enable_cloud_deploy = true` sans `enable_cicd_trigger` : les deux échouent dès le plan avec un message explicite.
- **Cloud Deploy** *(externe)* : avec le déclencheur fonctionnel, définissez `enable_cloud_deploy = true` et `cicd_enable_cloud_deploy = true`. Inspectez `gcloud deploy delivery-pipelines list --project="$PROJECT" --region="$REGION"` et les services des étapes `$SERVICE-dev`, `$SERVICE-staging`, `$SERVICE-prod`. La promotion vers `prod` reste en attente d'approbation (`require_approval = true`).

#### Pièges à éviter {#watch-out-for-6}

- `REQUIRE_ATTESTATION` sans un pipeline attestant chaque image bloque toute nouvelle révision, y compris les retours arrière ; `ALWAYS_DENY` bloque tout.
- Cloud Deploy constitue un **second chemin de code** : chaque étape possède son propre service, sa propre base de données et ses propres jobs. Un déploiement précompilé Cloud Deploy met son image en miroir tout comme le chemin direct.
- Le jeton GitHub n'est requis que pour la première connexion ; il est ensuite conservé dans Secret Manager.

#### Retour arrière {#revert-6}

Définissez `enable_binary_authorization = false` (et `enable_cicd_trigger = false`, `enable_cloud_deploy = false`, `cicd_enable_cloud_deploy = false` si vous les aviez configurés). Le service retire sa référence à la stratégie ; le déclencheur et le pipeline sont supprimés. L'attestateur et la stratégie au niveau du projet créés par le module s'ils étaient absents sont des ressources partagées et ne sont pas supprimés.

---

### Lab 9 — Stockage et système de fichiers — NFS (Groupe 9) {#lab-9--storage--filesystem--nfs-group-9}

> **Objectif :** monter un stockage partagé NFS à l'emplacement souhaité et prouver que les données qui y sont écrites survivent au renouvellement d'un conteneur.

**Vous allez :** déplacer le chemin de montage NFS et le nom de volume · exécuter un test écriture-redémarrage-lecture avec un job montant le même partage · localiser le serveur NFS découvert par le module.
**Durée :** 20–30 min · **Coût :** aucun (utilise le serveur NFS partagé) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-7}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_nfs` | `true` | Non | Monte le serveur NFS `Services_GCP` découvert (une VM intégrée seulement si aucun `Services_GCP` n'existe). Nécessite `gen2`. |
| `nfs_mount_path` | `"/mnt/nfs"` | Oui | Chemin de montage dans le conteneur principal et dans les jobs avec `mount_nfs = true`. |
| `nfs_volume_name` | `"nfs-data-volume"` | Oui | Nom de volume utilisé sur la révision. |
| `nfs_instance_name` | `""` | Oui | Cibler une VM NFS spécifique au lieu de la découverte automatique. |
| `nfs_instance_base_name` | `"app-nfs"` | Oui | Nom de base pour une VM NFS intégrée (inline) (mode autonome uniquement). |

Chaque application obtient sa propre sous-arborescence sur le serveur : `/share/$SERVICE`.

#### Étape 1 — Configurer {#step-1--configure-7}

```hcl
enable_nfs      = true
nfs_mount_path  = "/srv/appdata"          # move the mount off the generic default
nfs_volume_name = "lab-nfs-vol"
cron_jobs = [{                            # a paused job used only as a probe; replaces any Lab 7 cron_jobs
  name      = "nfs-probe"
  schedule  = "0 0 1 1 *"
  paused    = true
  image     = "busybox:1.36"
  command   = ["sh", "-c"]
  args      = ["date >> /srv/appdata/probe.log; echo CONTENTS:; cat /srv/appdata/probe.log"]
  mount_nfs = true                        # mounts the SAME share at nfs_mount_path
}]
```

#### Étape 2 — Appliquer {#step-2--apply-7}

**Update**. Nouvelle révision avec le montage déplacé, plus le job de test (~3 min). Rien sur le partage n'est supprimé.

#### Étape 3 — Vérifier {#step-3--verify-7}

```bash
# The mount moved
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -B1 -A3 -E "lab-nfs-vol|/srv/appdata"

# The NFS server the module bound to
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A1 NFS_SERVER_IP
gcloud compute instances list --project="$PROJECT" --filter="name~nfs" --format="table(name,zone,status,networkInterfaces[0].networkIP)"

# Write-restart-read: two executions = two fresh containers on the same share
gcloud run jobs execute "$SERVICE-nfs-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud run jobs execute "$SERVICE-nfs-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-nfs-probe\"" \
  --project="$PROJECT" --limit=10 --format="value(timestamp,textPayload)"
```

La seconde exécution affiche **deux** horodatages après `CONTENTS:` — le premier a été écrit par un conteneur qui n'existe plus. C'est cela, et non la simple présence d'un point de montage, qui prouve la persistance des données.

#### Explorer davantage {#explore-further-7}

- Définissez `enable_nfs = false` alors que le job de test contient toujours `mount_nfs = true` : le plan échoue, car un job tenterait de monter un volume qui n'existe pas.
- Définissez `enable_nfs = false` et `execution_environment = "gen1"` ensemble — accepté — puis réactivez `enable_nfs` : rejeté (gen1 ne peut pas monter NFS).

#### Pièges à éviter {#watch-out-for-7}

- Montez là où l'application **écrit** réellement. Un montage au mauvais endroit constitue un partage sain mais vide tandis que les données restent sur le disque éphémère ; seul un test écriture-redémarrage-lecture permet de le déceler.
- Ne placez pas sur NFS des bases de données dépendant du verrouillage de fichiers (SQLite WAL, LevelDB, bbolt, LMDB).
- Avec `enable_redis = true` et aucun `redis_host`, Redis correspond à la VM NFS — désactiver NFS peut également supprimer l'instance Redis de l'application (Lab 11).
- `enable_nfs` n'est pas update-safe : le désactiver supprime le volume du service.

#### Retour arrière {#revert-7}

```hcl
nfs_mount_path  = "/mnt/nfs"
nfs_volume_name = "nfs-data-volume"
cron_jobs       = []
```

Le fichier de test reste sur le partage sous `/share/$SERVICE` jusqu'au démantèlement, qui exécute un job de nettoyage NFS pour la sous-arborescence de l'application.

---

### Lab 10 — Stockage, système de fichiers et registre d'images (Groupe 10) {#lab-10--storage-filesystem--image-registry-group-10}

> **Objectif :** provisionner un bucket applicatif, le monter dans le conteneur avec GCS Fuse et prouver que les écritures via le point de montage parviennent bien dans le bucket.

**Vous allez :** créer un bucket versionné · le monter sur un chemin · écrire via le montage depuis un job et lire l'objet avec `gcloud` · observer quels paramètres de registre s'appliquent sur un socle.
**Durée :** 20–30 min · **Coût :** faible (stockage du bucket) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-8}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `create_cloud_storage` | `true` | Non | Interrupteur principal pour `storage_buckets`. |
| `storage_buckets` | `[]` | **Non** | Buckets nommés `gcs-$SERVICE-<name_suffix>` : `location`, `storage_class`, `force_destroy` (true), `versioning_enabled`, `lifecycle_rules`, `public_access_prevention` (enforced), `uniform_bucket_level_access` (true), `cors`. **Supprimer une entrée détruit ce bucket.** |
| `gcs_volumes` | `[]` | Oui | Montages GCS Fuse : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Un `bucket_name` vide correspond à l'entrée `storage_buckets` dont le `name_suffix` égale le volume `name`. Requiert `gen2`. |
| `manage_storage_kms_iam` | `false` | Non | Crée le trousseau de clés/`storage-key` CMEK du projet si absent et accorde au compte de service les droits encrypt/decrypt dessus. |
| `enable_artifact_registry_cmek` | `false` | Non | Crée une clé KMS Artifact Registry et l'accorde à l'identité de service du registre. **[Externe]** au sens où cela modifie l'état KMS du projet. |
| `max_images_to_retain` | `7` | Oui | Règle KEEP de nettoyage du registre. |
| `delete_untagged_images` | `true` | Oui | Règle DELETE de nettoyage du registre pour les images non taguées. |
| `image_retention_days` | `30` | Oui | Règle DELETE de nettoyage du registre basée sur l'âge. |

#### Étape 1 — Configurer {#step-1--configure-8}

```hcl
create_cloud_storage = true
storage_buckets = [{
  name_suffix        = "assets"            # bucket gcs-$SERVICE-assets
  versioning_enabled = true
}]
gcs_volumes = [{
  name       = "assets"                    # same as name_suffix, so bucket_name can be left empty
  mount_path = "/mnt/assets"
}]
cron_jobs = [{                             # a paused probe job that writes through the mount
  name              = "gcs-probe"
  schedule          = "0 0 1 1 *"
  paused            = true
  image             = "busybox:1.36"
  command           = ["sh", "-c"]
  args              = ["date > /mnt/assets/written-by-job.txt; ls -l /mnt/assets"]
  mount_gcs_volumes = ["assets"]
}]
```

#### Étape 2 — Appliquer {#step-2--apply-8}

**Update**. Crée le bucket et ses autorisations IAM, une nouvelle révision avec le montage Fuse et le job de test (~3 min).

#### Étape 3 — Vérifier {#step-3--verify-8}

```bash
# The bucket exists with the derived app-scoped name and versioning on
gcloud storage buckets describe "gs://gcs-$SERVICE-assets" --format=yaml | grep -iE "^name|versioning|public_access|uniform"

# The revision mounts it
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -B2 -A4 "gcs-$SERVICE-assets"

# Write through the mount, then read the object directly from the bucket
gcloud run jobs execute "$SERVICE-gcs-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud storage cat "gs://gcs-$SERVICE-assets/written-by-job.txt"     # expect the job's timestamp
```

#### Explorer davantage {#explore-further-8}

- Téléversez un fichier avec `gcloud storage cp` et réexécutez le job : il apparaît dans la sortie `ls` du job — le montage voit bien les objets écrits par d'autres clients.
- Définissez `readonly = true` sur le volume et réexécutez le job : l'écriture échoue.
- Ajoutez `manage_storage_kms_iam = true` et vérifiez le trousseau de clés : `gcloud kms keys list --keyring="$PROJECT-cmek-keyring" --location="$REGION" --project="$PROJECT"`.

#### Pièges à éviter {#watch-out-for-8}

- **`storage_buckets` n'est pas update-safe.** Supprimer ou renommer une entrée détruit ce bucket, et avec `force_destroy = true` (par défaut), son contenu disparaît avec lui. Définissez `force_destroy = false` pour les données que vous devez impérativement conserver.
- Une entrée `gcs_volumes` dont le `name` ne correspond à aucun `name_suffix` et ne comporte pas de `bucket_name` ne monte rien d'utile. Ne construisez jamais un nom de bucket à la main à partir du préfixe de tenant — les buckets ont une portée propre à chaque application (`gcs-$SERVICE-…`).
- GCS Fuse ne propose aucun verrouillage POSIX et introduit une latence plus élevée ; il convient aux éléments statiques (assets) et aux journaux, pas aux bases de données.
- Sur un socle `Services_GCP`, l'image est poussée vers le registre **partagé**, qui n'est pas géré par ce module ; par conséquent, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` n'y ont aucun effet. Ils ne s'appliquent qu'au registre créé par le module en mode autonome.

#### Retour arrière {#revert-8}

Définissez d'abord `gcs_volumes = []` et `cron_jobs = []` et appliquez ; puis définissez `storage_buckets = []` et appliquez — le formulaire vous avertit que cette action détruit `gcs-$SERVICE-assets` et son contenu, ce qui est attendu ici.

---

### Lab 11 — Cache Redis (Groupe 11) {#lab-11--redis-cache-group-11}

> **Objectif :** observer précisément ce que le module transmet à l'application concernant Redis, et comment la définition d'un mot de passe modifie cette configuration.

**Vous allez :** lire les variables Redis injectées · changer le port · définir `redis_auth` et observer ce qui est ajouté et retiré.
**Durée :** 15 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun (la VM NFS partagée héberge également Redis).

#### Paramètres de ce groupe {#settings-in-this-group-9}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_redis` | `true` | Non | Injecte `REDIS_HOST`, `REDIS_PORT` et (sans authentification) `REDIS_URL`. Sans `redis_host`, l'hôte est la VM NFS (qui exécute Redis). |
| `redis_host` | `""` | Oui | Hôte Redis explicite (ex. une adresse IP Memorystore). Memorystore n'est jamais découvert automatiquement. |
| `redis_port` | `"6379"` | Oui | Injecté sous `REDIS_PORT`. |
| `redis_auth` | `""` | Oui | Stocké sous forme de secret `secret-$SERVICE-redis-auth` et injecté sous `REDIS_AUTH`. **Le définir empêche le module d'injecter `REDIS_URL`.** |

#### Étape 1 — Configurer {#step-1--configure-9}

```hcl
enable_redis = true
redis_port   = "6380"                     # changes only what is injected; it does not reconfigure Redis
redis_auth   = "lab-redis-secret"         # injected as a SECRET; REDIS_URL is withdrawn
```

#### Étape 2 — Appliquer {#step-2--apply-9}

**Update**. Crée le secret d'authentification Redis et une nouvelle révision (~2 min).

#### Étape 3 — Vérifier {#step-3--verify-9}

Lisez les variables avant et après :

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A3 REDIS
```

| `redis_auth` | Injecté |
|---|---|
| `""` (référence) | `REDIS_HOST` = IP de la VM NFS, `REDIS_PORT` = 6379, `REDIS_URL` = `redis://<ip>:6379` |
| défini | `REDIS_HOST`, `REDIS_PORT` = 6380, `REDIS_AUTH` en tant que référence de secret — **pas de `REDIS_URL`** |

`REDIS_HOST` est égal à `NFS_SERVER_IP` quand `redis_host` est vide — vérifiez les deux dans la même sortie.

#### Explorer davantage {#explore-further-9}

- Définissez `enable_redis = true`, `redis_host = ""` et `enable_nfs = false` dans un projet sans serveur NFS découvrable : le plan échoue, car il n'y a aucun hôte de repli disponible.

#### Pièges à éviter {#watch-out-for-9}

- Une application qui ne lit que `REDIS_URL` perd sa configuration Redis dès que vous définissez `redis_auth` ; une telle application doit construire elle-même l'URL à partir de `REDIS_HOST`, `REDIS_PORT` et `REDIS_AUTH`.
- `redis_port` et `redis_auth` décrivent le serveur ; ils ne le modifient pas. Une mauvaise configuration produira une application incapable de se connecter alors même que le déploiement réussit.
- Définissez `enable_redis = false` pour les applications qui n'utilisent pas Redis.

#### Retour arrière {#revert-9}

```hcl
redis_port = "6379"
redis_auth = ""
```

`REDIS_URL` réapparaît et le secret d'authentification est supprimé.

---

### Lab 12 — Backend de base de données (Groupe 12) {#lab-12--database-backend-group-12}

> **Objectif :** trouver et exploiter l'identité de base de données de l'application, l'exposer sous les noms attendus par l'application et effectuer une rotation automatique de mot de passe sans interrompre le service.

**Vous allez :** confirmer quelles variables nomment réellement la base de données · ajouter des alias de variables d'environnement et les comparer avec `DB_HOST` · activer la rotation automatique de mot de passe et l'exécuter de bout en bout.
**Durée :** 30–40 min · **Coût :** faible (un job de rotation et un petit service répartiteur) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-10}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | Oui (indicateur) — voir *Pièges à éviter* | `POSTGRES`, `MYSQL` (et variantes épinglées) ou `NONE`. Avec `Services_GCP`, seuls une base de données et un utilisateur sont créés au sein de l'instance partagée de ce moteur. |
| `sql_instance_name` | `""` | Oui | Cibler une instance spécifique au lieu de la découverte automatique. |
| `sql_instance_base_name` | `"app-sql"` | Oui | Nom de base pour une instance intégrée (inline) (mode autonome uniquement). |
| `application_database_name` | `"crappdb"` | Oui | **Inerte.** La base de données est toujours nommée d'après `$SERVICE` (tirets → underscores). |
| `application_database_user` | `"crappuser"` | Oui | **Inerte.** L'utilisateur est toujours nommé d'après `$SERVICE`. |
| `database_password_length` | `32` | **Non** | Longueur du mot de passe généré (16–64). Le modifier sur un déploiement actif casse la connexion à la base de données — voir *Pièges à éviter*. |
| `db_password_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour le mot de passe (même secret que `DB_PASSWORD`). |
| `db_host_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour l'hôte — sur Cloud Run, il s'agit de l'**IP privée** de l'instance, pas du chemin du socket. |
| `db_user_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour l'utilisateur. |
| `db_name_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour le nom de base de données. |
| `db_port_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour le port. |
| `service_url_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour l'URL du service (`CLOUDRUN_SERVICE_URL`). |
| `enable_postgres_extensions` | `false` | Oui | Validation uniquement lors du déploiement direct de `App_CloudRun` — les extensions ne sont installées que lorsqu'un module englobant (wrapper) les fournit. |
| `enable_mysql_plugins` | `false` | Oui | Identique au point précédent pour les plugins MySQL. |
| `enable_auto_password_rotation` | `false` | Oui | Déploie un job de rotation (`$SERVICE-pw-rotator`), un service répartiteur et un déclencheur Eventarc activé par la planification de rotation du secret (`secret_rotation_period`, Lab 5). |
| `rotation_propagation_delay_sec` | `90` | Oui | Délai d'attente entre l'écriture de la nouvelle version du secret et la désactivation de l'ancienne. |

(`postgres_extensions` et `mysql_plugins` relèvent du Groupe 0 — définis par les modules wrappers, pas sur le formulaire.)

#### Étape 1 — Configurer {#step-1--configure-10}

```hcl
db_host_env_var_name     = "MYAPP_DB_HOST"
db_user_env_var_name     = "MYAPP_DB_USER"
db_name_env_var_name     = "MYAPP_DB_NAME"
db_port_env_var_name     = "MYAPP_DB_PORT"
db_password_env_var_name = "MYAPP_DB_PASSWORD"
service_url_env_var_name = "APP_PUBLIC_URL"
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 90
```

#### Étape 2 — Appliquer {#step-2--apply-10}

**Update**. Ajoute les alias (nouvelle révision) ainsi que le job de rotation, le service répartiteur, le déclencheur Eventarc et un compte de service dédié à la rotation (~4 min).

#### Étape 3 — Vérifier {#step-3--verify-10}

```bash
# Aliases next to the canonical variables
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A2 -E "DB_HOST|DB_IP|MYAPP_|APP_PUBLIC_URL"
```

Attendez-vous à voir `DB_HOST = /cloudsql/<project>:<region>:<instance>` mais `MYAPP_DB_HOST = <private IP>` (égal à `DB_IP`). **Ils diffèrent intentionnellement** : une application reliée à l'alias se connecte en TCP sur l'IP privée et a besoin de `sslmode=require` ; une application lisant `DB_HOST` utilise le socket. `MYAPP_DB_PASSWORD` est une référence vers le secret.

À présent, effectuez la rotation du mot de passe de bout en bout :

```bash
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state,createTime)"   # before
gcloud run jobs execute "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --wait
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-pw-rotator\"" \
  --project="$PROJECT" --limit=20 --format="value(textPayload)" | grep -E "Step|Rotation complete"
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state,createTime)"   # after
curl -s "$SERVICE_URL/db"
```

Attendez-vous à voir `=== Rotation complete. New=… Old=… ===`, une nouvelle version `ENABLED` avec la précédente marquée `DISABLED` (conservée en cas de retour arrière), et `/db` toujours à `connected`. Les instances lisent le mot de passe au démarrage ; pour prouver qu'une instance *neuve* utilise bien le nouveau mot de passe, forcez-en une : appliquez un **Update** avec un changement anodin (par exemple `environment_variables = { ROTATION_CHECK = "1" }`) et interrogez à nouveau `/db`.

La rotation s'exécute également selon son propre calendrier : `gcloud eventarc triggers list --project="$PROJECT" --location="$REGION" --filter="name~$SERVICE"`.

#### Explorer davantage {#explore-further-10}

- Définissez `application_database_name = "labdb"` et appliquez : aucune base de données `labdb` n'apparaît (`gcloud sql databases list --instance="$SQL_INSTANCE" --project="$PROJECT"`) et `DB_NAME` reste inchangé. Un bloc de validation sur une variable ne prouve pas qu'elle soit effectivement consommée.
- `database_type = "NONE"` : soumettez-le avec `enable_cloudsql_volume` toujours à `true` et lisez l'erreur au plan ; définissez ensuite les deux (`database_type = "NONE"`, `enable_cloudsql_volume = false`). L'exemple `db-init` se termine immédiatement avec `No database configured`, et `/` répond par `(DB unavailable: …)`. Ne faites cela que si vous prévoyez de revenir en arrière aussitôt — voir ci-après.

#### Pièges à éviter {#watch-out-for-10}

- **`database_password_length` casse la connexion s'il est modifié sur un déploiement actif.** Il écrit un nouveau mot de passe dans Secret Manager et détruit l'ancienne version alors que la base de données attend toujours l'ancien mot de passe. Rétablissez la situation en réexécutant le job idempotent de base de données : `gcloud run jobs execute "$SERVICE-db-create" --project="$PROJECT" --region="$REGION" --wait`. Utilisez `enable_auto_password_rotation` pour changer les mots de passe.
- **Ne modifiez pas `database_type` sur un déploiement actif.** Le formulaire l'autorise, mais cela bascule l'application vers un autre moteur (ou aucun), et l'application d'exemple ne supporte que PostgreSQL. Sur un socle `Services_GCP`, `MYSQL` requiert également que le socle fournisse une instance MySQL — sinon le plan échoue.
- Lors du diagnostic d'un échec de connexion, une ligne `pg_hba.conf … no encryption` sous `password authentication failed` correspond à la tentative sans SSL de psql, et non à un problème TLS — corrigez l'identifiant.

#### Retour arrière {#revert-10}

Rétablissez les six champs `*_env_var_name` à `""` et `enable_auto_password_rotation = false`, puis appliquez. Le job de rotation, le répartiteur, le déclencheur et le compte dédié sont supprimés ; la base de données conserve le mot de passe le plus récent, qui correspond à la dernière version du secret. Si vous avez testé `database_type = "NONE"`, définissez `database_type = "POSTGRES"` et `enable_cloudsql_volume = true` puis appliquez ; `db-init` recrée l'utilisateur et le schéma si nécessaire.

---

### Lab 13 — Sauvegarde et maintenance (Groupe 13) {#lab-13--backup--maintenance-group-13}

> **Objectif :** planifier des sauvegardes de base de données, en déclencher une à la demande et restaurer un dump dans la base de données.

**Vous allez :** modifier la planification et la rétention des sauvegardes · exécuter une sauvegarde à la demande et localiser le fichier · restaurer le dump de validation fourni avec le module et vérifier les données créées.
**Durée :** 20–30 min · **Coût :** faible (stockage du bucket) · **Prérequis / configuration externe :** aucun pour le dump d'exemple fourni, que le module téléverse lui-même sur `gs://gcs-$SERVICE-backups/backup.sql`. Pour restaurer votre propre dump, téléversez-le préalablement à cet endroit.

#### Paramètres de ce groupe {#settings-in-this-group-11}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Oui | Cron (UTC) pour le job planifié `$SERVICE-backup-schedule`, qui lance le job d'export `$SERVICE-db-export`. |
| `backup_retention_days` | `7` | Oui | Âge de suppression par cycle de vie sur `gcs-$SERVICE-backups`. |
| `enable_backup_import` | `false` | Non | Exécute `$SERVICE-backup-import` pendant l'apply pour restaurer `backup_file`. Rejeté au plan avec `database_type = "NONE"`. |
| `backup_source` | `"gcs"` | Non | `gcs` (le bucket de sauvegarde) ou `gdrive`. |
| `backup_file` | `"backup.sql"` | Non | Un simple **nom de fichier** — le module construit `gs://gcs-$SERVICE-backups/<file>` lui-même. |
| `backup_format` | `"sql"` | Oui | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto` (`auto` pas avec `gdrive`). |

#### Étape 1 — Configurer {#step-1--configure-11}

```hcl
backup_schedule       = "30 4 * * *"    # daily 04:30 UTC
backup_retention_days = 21
enable_backup_import  = true            # restore once during this apply
backup_source         = "gcs"
backup_file           = "backup.sql"    # bare filename; the shipped validation dump
backup_format         = "sql"
```

Le fichier `backup.sql` fourni est non destructif : il crée une table `platform_validation` et y insère une ligne.

#### Étape 2 — Appliquer {#step-2--apply-11}

**Update**. Met à jour le planificateur ainsi que le cycle de vie du bucket et exécute le job d'importation ; l'apply échoue de manière explicite si l'importation se termine avec un code non nul (~3–5 min).

#### Étape 3 — Vérifier {#step-3--verify-11}

```bash
# Schedule and retention
gcloud scheduler jobs describe "$SERVICE-backup-schedule" --project="$PROJECT" --location="$REGION" --format="value(schedule)"
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format=yaml | grep -A6 -i lifecycle    # expect age: 21

# The restore ran and created data (not merely "succeeded")
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-backup-import\"" \
  --project="$PROJECT" --limit=30 --format="value(textPayload)" | grep -E "CREATE TABLE|INSERT|validation table"

# Take a backup now and find the file
gcloud run jobs execute "$SERVICE-db-export" --project="$PROJECT" --region="$REGION" --wait
gcloud storage ls -l "gs://gcs-$SERVICE-backups/"
```

Attendez-vous à voir `CREATE TABLE`, `INSERT 0 1` et `Platform validation table is ready.` dans les journaux d'importation, ainsi qu'un nouveau fichier de dump à côté de `backup.sql`. Pour visualiser la ligne elle-même, ouvrez **Cloud SQL → your instance → Cloud SQL Studio**, connectez-vous à la base `$SERVICE` en tant qu'utilisateur `$SERVICE` avec le mot de passe issu de `gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"`, et exécutez `SELECT * FROM platform_validation;`.

#### Explorer davantage {#explore-further-11}

- Déclenchez le chemin planifié au lieu du job : `gcloud scheduler jobs run "$SERVICE-backup-schedule" --project="$PROJECT" --location="$REGION"`.
- Restaurez l'un de vos propres exports : téléchargez-le, renommez-le, téléversez-le sur le bucket de sauvegarde, puis attribuez ce nom à `backup_file`.

#### Pièges à éviter {#watch-out-for-11}

- **Une restauration s'exécute sur la base de données active.** Laisser `enable_backup_import = true` réimportera le dump lors des apply ultérieurs ; désactivez-le dès qu'une restauration a réussi.
- `backup_file` est un nom de fichier, pas une URI. Un mauvais nom fait échouer le job d'importation, et l'apply avec lui.
- Une importation qui échoue avec `password authentication failed` signifie généralement que le mot de passe de base de données et le secret ont divergé (voir Lab 12, `database_password_length`) ; réexécutez `$SERVICE-db-create`.

#### Retour arrière {#revert-11}

```hcl
enable_backup_import  = false
backup_schedule       = "0 2 * * *"
backup_retention_days = 7
```

La table `platform_validation` reste dans la base de données ; elle est sans danger.

---

### Lab 14 — Initialisation personnalisée et SQL (Groupe 14) {#lab-14--custom-initialisation--sql-group-14}

> **Objectif :** exécuter vos propres scripts SQL ordonnés sur la base de données applicative lors d'un déploiement.

**Vous allez :** déposer deux scripts interdépendants dans un bucket · les exécuter via le job du module · prouver qu'ils se sont exécutés dans l'ordre lexicographique avec les privilèges de l'utilisateur applicatif.
**Durée :** 20–30 min · **Coût :** aucun · **Prérequis / configuration externe :** un bucket contenant vos fichiers `.sql` — ce lab réutilise le bucket du Lab 10 (`gcs-$SERVICE-assets`) ; recréez-le depuis l'Étape 1 du Lab 10 si vous aviez fait un retour arrière, ou utilisez n'importe quel bucket du projet.

#### Paramètres de ce groupe {#settings-in-this-group-12}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | Non | Exécute le job `$SERVICE-custom-sql`, lançant chaque `.sql` sous le chemin dans l'ordre lexicographique. Requiert un bucket, un chemin et une base de données (vérifications au plan). |
| `custom_sql_scripts_bucket` | `""` | Oui | Nom du bucket ; le compte de service obtient un accès en lecture dessus. |
| `custom_sql_scripts_path` | `""` | Oui | Préfixe dans le bucket, ex. `sqlscripts`. |
| `custom_sql_scripts_use_root` | `false` | Oui | `true` s'exécute en tant qu'utilisateur root de l'instance plutôt que l'utilisateur de l'application. |

#### Étape 1 — Configurer {#step-1--configure-12}

Déposez deux scripts où le second dépend du premier, de sorte qu'un mauvais ordre d'exécution échouerait immédiatement :

```bash
printf 'CREATE TABLE IF NOT EXISTS lab_order (id SERIAL PRIMARY KEY, note TEXT);\n' > 01-create.sql
printf "INSERT INTO lab_order (note) VALUES ('ran second');\n"                   > 02-insert.sql
gcloud storage cp 01-create.sql 02-insert.sql "gs://gcs-$SERVICE-assets/sqlscripts/"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "gcs-<service>-assets"   # paste the real bucket name ($SERVICE expanded)
custom_sql_scripts_path     = "sqlscripts"
custom_sql_scripts_use_root = false                    # prove the app user has enough privilege
```

#### Étape 2 — Appliquer {#step-2--apply-12}

**Update**. Crée et exécute le job (~2–3 min).

#### Étape 3 — Vérifier {#step-3--verify-12}

```bash
gcloud run jobs executions list --job="$SERVICE-custom-sql" --project="$PROJECT" --region="$REGION" \
  --format="table(metadata.name,status.succeededCount,status.failedCount)"
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-custom-sql\"" \
  --project="$PROJECT" --limit=30 --format="value(textPayload)" | grep -E "Found|\.sql|CREATE|INSERT|ERROR"
```

Attendez-vous à voir `Found 2 SQL script(s)`, puis `01-create.sql` → `CREATE TABLE` avant `02-insert.sql` → `INSERT 0 1`, sans aucun `relation does not exist`.

#### Explorer davantage {#explore-further-12}

- Ajoutez `03-grant.sql` avec `CREATE EXTENSION IF NOT EXISTS pg_trgm;` et réexécutez avec `use_root = false`, puis `true`, pour observer quelles instructions nécessitent l'utilisateur root.
- Définissez `enable_custom_sql_scripts = true` avec un chemin vide et observez l'erreur au moment du plan (un préfixe vide n'exécuterait silencieusement rien).

#### Pièges à éviter {#watch-out-for-12}

- Chaque `.sql` situé sous le préfixe s'exécute à chaque apply où le job est lancé — écrivez des scripts idempotents (`IF NOT EXISTS`).
- `use_root = true` exécute du SQL arbitraire avec des privilèges étendus à toute l'instance sur une instance **partagée**.

#### Retour arrière {#revert-12}

Définissez `enable_custom_sql_scripts = false` et videz le bucket/chemin ; appliquez. Supprimez les fichiers déposés : `gcloud storage rm "gs://gcs-$SERVICE-assets/sqlscripts/**"`. La table `lab_order` reste dans la base de données.

---

### Lab 15 — Accès et réseau (Groupe 15) {#lab-15--access--networking-group-15}

> **Objectif :** contrôler qui peut joindre le service et comment il émet ses requêtes vers l'extérieur, et interpréter correctement les erreurs 404 de Cloud Run.

**Vous allez :** restreindre le trafic entrant (ingress) à l'interne et observer la 404 spécifique à l'ingress interne · router tout le trafic sortant (egress) via le VPC · épingler le réseau par son nom · reconnaître les trois formats de 404.
**Durée :** 20–30 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-13}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `ingress_settings` | `"all"` | Oui | `all`, `internal`, `internal-and-cloud-load-balancing`. Forcé sur cette dernière valeur lorsque Cloud Armor/CDN est activé (Lab 17). |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Oui | `PRIVATE_RANGES_ONLY` ou `ALL_TRAFFIC` via le VPC (et son Cloud NAT). |
| `network_name` | `""` | Oui | VPC auquel s'attacher ; vide = découvrir le réseau `Services_GCP`. |

#### Étape 1 — Configurer {#step-1--configure-13}

Trouvez le réseau utilisé aujourd'hui par le service, puis épinglez-le explicitement et restreignez le trafic entrant :

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -A3 network-interfaces
```

```hcl
ingress_settings   = "internal"                  # no direct internet access
vpc_egress_setting = "ALL_TRAFFIC"               # all outbound traffic through the VPC
network_name       = "<services-gcp-network>"    # the network shown above, e.g. vpc-network-<tenant-prefix>
```

#### Étape 2 — Appliquer {#step-2--apply-13}

**Update**. Met à jour le trafic entrant du service et crée une nouvelle révision pour la modification de réseau/trafic sortant (~2 min).

#### Étape 3 — Vérifier {#step-3--verify-13}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -E "ingress|vpc-access-egress|network-interfaces" -A2
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"     # expect 404
curl -s "$SERVICE_URL/" | grep -o "<title>[^<]*</title>"     # expect <title>404 Page not found</title>
```

Trois erreurs 404 différentes se présentent sous la forme « 404 sans journaux de conteneur » — le titre permet de les distinguer :

| Titre | Signification | Correction |
|---|---|---|
| `404 Not Found` (page de l'application) | Le chemin n'existe pas dans l'application | Utilisez un chemin valide |
| `Error 404 (Not Found)!!1` (page de Google) | `run.invoker` manquant pour l'appelant, ou chemin géré par le front-end (`/healthz`) | Vérifiez `gcloud run services get-iam-policy` ; évitez `/healthz` depuis l'extérieur |
| `404 Page not found` | Le paramètre d'ingress a rejeté la requête (interne uniquement) | Appelez depuis l'intérieur du VPC ou assouplissez `ingress_settings` |

#### Explorer davantage {#explore-further-13}

- Avec un ingress à `internal`, ajoutez le job de test du Lab 7 pointant vers `$SERVICE_URL/` : depuis l'intérieur du VPC avec une sortie `ALL_TRAFFIC`, il obtient un 200.
- Comparez la sortie de `/whoami` avant et après `ALL_TRAFFIC` : les en-têtes entrants ne changent pas — la configuration de sortie n'affecte que les appels émis par le conteneur.

#### Pièges à éviter {#watch-out-for-13}

- `PRIVATE_RANGES_ONLY` envoie les appels vers les adresses *publiques* — y compris l'URL `run.app` d'un autre service — directement sur Internet, hors du VPC. Les cibles internes uniquement les rejettent alors (Lab 7).
- `ALL_TRAFFIC` modifie l'adresse IP sortante de l'application pour utiliser celle du Cloud NAT du VPC.
- Épingler `network_name` sur un réseau qui n'est pas celui de `Services_GCP` désactive la découverte de la base de données et du serveur NFS partagés, et le plan échoue si l'application en dépend.

#### Retour arrière {#revert-13}

```hcl
ingress_settings   = "all"
vpc_egress_setting = "PRIVATE_RANGES_ONLY"
network_name       = ""
```

---

### Lab 16 — Identity-Aware Proxy (Groupe 16) {#lab-16--identity-aware-proxy-group-16}

> **Objectif :** exiger une authentification Google devant le service et contrôler précisément qui y accède.

**Vous allez :** observer le déclenchement des deux garde-fous au moment du plan · configurer l'écran de consentement OAuth · activer IAP pour vous-même et un groupe · vérifier que l'accès anonyme est refusé.
**Durée :** 20–30 min · **Coût :** aucun · **Prérequis / configuration externe :** **[Configuration externe requise]** — le projet nécessite une marque OAuth IAP (écran de consentement). Sur les projets récents, elle ne peut être créée que dans la Console, et **une marque ne peut plus être supprimée une fois créée**. Vous pouvez vous contenter de lire ce lab sans exécuter cette démarche.

#### Paramètres de ce groupe {#settings-in-this-group-14}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_iap` | `false` | Non | Active l'IAP intégré de Cloud Run et retire l'autorisation publique d'appel `allUsers`. |
| `iap_authorized_users` | `[]` | Oui | Utilisateurs/comptes de service autorisés à traverser (préfixe `user:` ajouté si absent). L'auteur du déploiement est ajouté automatiquement. |
| `iap_authorized_groups` | `[]` | Oui | Groupes Google autorisés à traverser (`group:…`). |

#### Étape 1 — Configurer {#step-1--configure-14}

1. *(Test de garde-fou — facultatif.)* Soumettez `enable_iap = true` avec les deux listes vides. Le plan échoue sur **deux** conditions préalables : aucune identité autorisée, et (si le projet n'en possède pas) aucune marque OAuth. Rien n'est créé — cela est délibéré, car activer IAP révoque l'accès public dans le même apply, et un échec plus tard dans cet apply laisserait le service inaccessible à quiconque.
2. Créez la marque : **Google Auth Platform / APIs & Services → OAuth consent screen**, choisissez *Internal* (ou *External*), saisissez un nom d'application et un e-mail de support, puis enregistrez. (`gcloud iap oauth-brands create` est signalé comme indisponible pour les nouveaux projets.)
3. Définissez :

```hcl
enable_iap            = true
iap_authorized_users  = ["<your-email>"]                 # "user:" is added automatically
iap_authorized_groups = ["group:<team>@<your-domain>"]   # optional
```

Ne combinez **pas** IAP avec `enable_cdn` (Lab 17) — ils sont mutuellement exclusifs.

#### Étape 2 — Appliquer {#step-2--apply-14}

**Update**. Active IAP sur le service, accorde à l'agent de service IAP le rôle `run.invoker`, accorde à chaque compte `run.invoker` et `iap.httpsResourceAccessor`, et retire `allUsers` (~2 min).

#### Étape 3 — Vérifier {#step-3--verify-14}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i "iap"
gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="table(bindings.role,bindings.members)"              # no allUsers; gcp-sa-iap and your principals present
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.role=roles/iap.httpsResourceAccessor" --format="value(bindings.members)"
curl -s -o /dev/null -w "anonymous: %{http_code}\n" "$SERVICE_URL/"   # expect 403
```

Ouvrez ensuite `$SERVICE_URL` dans un navigateur connecté avec un utilisateur autorisé : vous franchissez l'authentification Google et visualisez le compteur de visites. Un compte non présent dans les listes est rejeté.

#### Explorer davantage {#explore-further-14}

- Retirez-vous de `iap_authorized_users` mais conservez un groupe auquel vous appartenez — l'accès fonctionne toujours via le groupe (l'adhésion est gérée dans Google Groups, aucun redéploiement requis).

#### Pièges à éviter {#watch-out-for-14}

- Activer IAP rend l'URL `run.app` privée. Les tests de disponibilité et tout système automatisé requièrent désormais une identité autorisée.
- Les marques constituent un état permanent du projet ; n'en créez une qu'en connaissance de cause.

#### Retour arrière {#revert-14}

Définissez `enable_iap = false` et appliquez. L'attribution du rôle d'appel `allUsers` est restaurée et un `curl` anonyme renvoie à nouveau 200. La marque OAuth subsiste (elle ne peut pas être supprimée).

---

### Lab 17 — Cloud Armor et CDN (Groupe 17) {#lab-17--cloud-armor--cdn-group-17}

> **Objectif :** placer un Global HTTPS Load Balancer avec WAF Cloud Armor et CDN devant le service, et prouver que le WAF bloque les attaques.

**Vous allez :** observer le déclenchement du garde-fou CDN sans Armor · provisionner l'équilibreur de charge, la stratégie et un certificat nip.io sans configuration préalable · confirmer l'association de la stratégie et l'activation du CDN · voir une sonde XSS bloquée par une 403 · constater la fermeture de l'URL directe `run.app`.
**Durée :** 30–40 min (l'émission du certificat prend 10–30 min) · **Coût :** **oui** — les règles de transfert, l'IP globale et la stratégie Cloud Armor sont facturées tant qu'elles existent · **Prérequis / configuration externe :** aucun ; un domaine personnalisé est facultatif et requiert la maîtrise d'une zone DNS.

#### Paramètres de ce groupe {#settings-in-this-group-15}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_cloud_armor` | `false` | Non | Crée l'équilibreur de charge mondial (NEG serverless `$SERVICE-neg`, backend `$SERVICE-backend`, mappage d'URL, IP `$SERVICE-lb-ip`, redirection HTTP→HTTPS) et la stratégie `$SERVICE-waf-policy` ; force le trafic entrant à `internal-and-cloud-load-balancing`. |
| `admin_ip_ranges` | `[]` | Oui | Plages CIDR autorisées avant les règles WAF (priorité 100). Également utilisées comme niveaux d'accès administrateur VPC-SC (Lab 18). |
| `application_domains` | `[]` | Oui | Domaines personnalisés avec certificats gérés par Google. Vide = `<ip-dashed>.nip.io`. |
| `enable_cdn` | `false` | Oui | Cloud CDN sur le backend. Requiert `enable_cloud_armor` (contrôle au plan). |

#### Étape 1 — Configurer {#step-1--configure-15}

1. *(Test de garde-fou.)* Soumettez `enable_cdn = true` seul : le plan échoue — il n'y a aucun équilibreur de charge auquel rattacher le CDN.
2. Définissez :

```hcl
enable_cloud_armor = true
enable_cdn         = true
admin_ip_ranges    = ["203.0.113.0/24"]   # a SPECIFIC trusted range (documentation range here) — never 0.0.0.0/0
# application_domains = ["app.<your-domain>"]   # optional: then add a DNS A record to the LB IP
```

#### Étape 2 — Appliquer {#step-2--apply-15}

**Update**. Crée environ 17 ressources (~5–8 min). L'ingress du service change, fermant ainsi l'accès par l'URL `run.app`.

#### Étape 3 — Vérifier {#step-3--verify-15}

```bash
export LB_IP=$(gcloud compute addresses describe "$SERVICE-lb-ip" --global --project="$PROJECT" --format="value(address)")
export LB_HOST="${LB_IP//./-}.nip.io"
echo "https://$LB_HOST"

# 1. Policy exists and 2. is ATTACHED to the backend; 3. CDN is on
gcloud compute backend-services describe "$SERVICE-backend" --global --project="$PROJECT" \
  --format="yaml(securityPolicy,enableCDN)"                         # expect …/$SERVICE-waf-policy, enableCDN: true
# 4. Rules: admin allow at 100, WAF 1000–1003, rate-based ban at 2000, default allow last
gcloud compute security-policies describe "$SERVICE-waf-policy" --project="$PROJECT" \
  --format="table(rules.priority,rules.action,rules.match.config.srcIpRanges)"

# Certificate status (PROVISIONING until it is ACTIVE)
gcloud compute ssl-certificates list --project="$PROJECT" --filter="name~$SERVICE" \
  --format="table(name,managed.domains,managed.status)"

# Through the LB (once the certificate is ACTIVE)
curl -s "https://$LB_HOST/"                                         # expect the visitor counter
curl -s -o /dev/null -w "direct run.app: %{http_code}\n" "$SERVICE_URL/"   # expect 404 (ingress)
```

Testez ensuite le WAF. Attendez **5 à 10 minutes après l'apply** pour que les règles prennent effet :

```bash
curl -s -o /dev/null -w "XSS:  %{http_code}\n" "https://$LB_HOST/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"   # expect 403
curl -s -o /dev/null -w "SQLi: %{http_code}\n" "https://$LB_HOST/?id=1%27%20OR%20%271%27%3D%271"          # expect 403
curl -s -o /dev/null -w "OK:   %{http_code}\n" "https://$LB_HOST/"                                        # expect 200
```

Une réponse 200 avec le contenu réel (le compteur) via l'équilibreur de charge prouve l'intégrité de toute la chaîne — LB → Cloud Armor → NEG serverless → Cloud Run → Cloud SQL. Les contrôles de santé backend n'étant pas pris en charge pour les NEG serverless, la réponse HTTP constitue le seul signal disponible.

#### Explorer davantage {#explore-further-15}

- `curl -sI "http://$LB_HOST/"` renvoie une redirection vers `https://$LB_HOST/` — en préservant le nom d'hôte. Un appel sur l'IP brute génère une discordance de certificat ; utilisez toujours le nom d'hôte nip.io.
- `curl -s "https://$LB_HOST/whoami"` : `X-Forwarded-For` transmet désormais votre adresse IP suivie de l'ajout effectué par le LB. Seule l'entrée **la plus à droite** est digne de confiance.
- Récupérez la même réponse statique deux fois et recherchez un en-tête `Age` pour observer la mise en cache CDN (l'application d'exemple n'envoyant aucun en-tête de cache, la plupart des réponses ne sont pas mises en cache).

#### Pièges à éviter {#watch-out-for-15}

- Ne conservez pas une requête vers l'URL directe `run.app` comme signal de santé — elle est fermée par conception dès que le LB est en place.
- Le certificat d'un domaine personnalisé reste à l'état `PROVISIONING` tant que son enregistrement DNS A ne pointe pas vers `$LB_IP`.
- Ne placez jamais `0.0.0.0/0` dans `admin_ip_ranges` ; cela exempterait tout le monde du WAF.

#### Retour arrière {#revert-15}

```hcl
enable_cdn         = false
enable_cloud_armor = false
admin_ip_ranges    = []
```

L'équilibreur de charge, le certificat, l'IP et la stratégie sont détruits et l'ingress revient à votre valeur `ingress_settings` (`all`), rouvrant l'URL `run.app`. Si vous aviez configuré un domaine personnalisé, supprimez son enregistrement DNS manuellement.

---

### Lab 18 — VPC Service Controls et journaux d'audit (Groupe 18) {#lab-18--vpc-service-controls--audit-logging-group-18}

> **Objectif :** activer la journalisation d'audit détaillée, et demander un périmètre VPC-SC tout en vérifiant honnêtement s'il a bien été créé.

**Vous allez :** activer les journaux d'audit DATA_READ/DATA_WRITE/ADMIN_READ et relire la configuration du projet · demander un périmètre VPC-SC en mode simulation (dry-run) · comparer ce que vous avez demandé avec les sorties du module.
**Durée :** 20–30 min · **Coût :** oui — les journaux d'audit détaillés augmentent le volume de Cloud Logging · **Prérequis / configuration externe :** **[Configuration externe requise]** pour VPC-SC : le projet doit appartenir à une **organisation** GCP, l'auteur du déploiement doit avoir les droits Access Context Manager au niveau de l'organisation, un projet imbriqué dans un dossier requiert `organization_id`, et `admin_ip_ranges` ne doit pas être vide. La journalisation d'audit ne nécessite rien d'externe. Dans les projets gérés par RAD, les champs VPC-SC sont masqués.

#### Paramètres de ce groupe {#settings-in-this-group-16}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Oui | Crée une stratégie d'accès (ou réutilise celle de l'organisation), quatre niveaux d'accès et un périmètre standard autour des API utilisées par le module. S'ignore avec un avertissement en cas d'impossibilité. |
| `vpc_sc_dry_run` | `true` | Oui | Journalise les violations sans bloquer. Conservez `true` tant que les journaux ne sont pas exempts d'erreurs. |
| `vpc_cidr_ranges` | `[]` | Oui | Plages CIDR pour le niveau d'accès réseau ; vide = découvrir les sous-réseaux du VPC. |
| `organization_id` | `""` | Oui | Identifiant numérique de l'organisation ; requis pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Non | Configurations d'audit du projet : `allServices` ADMIN_READ/DATA_READ/DATA_WRITE plus surcharges Secret Manager et KMS. |

#### Étape 1 — Configurer {#step-1--configure-16}

```hcl
enable_audit_logging = true
enable_vpc_sc        = true
vpc_sc_dry_run       = true              # observe, never enforce on first enable
vpc_cidr_ranges      = ["10.0.0.0/8"]
admin_ip_ranges      = ["<your-admin-cidr>"]   # Group 17 variable; VPC-SC skips when empty
# organization_id    = "<your-org-id>"   # required if the project sits under a folder
```

#### Étape 2 — Appliquer {#step-2--apply-16}

**Update** (~3–5 min). Dans un projet sans organisation, ou imbriqué dans un dossier sans `organization_id`, le journal affiche `WARNING: VPC Service Controls skipped — …` et aucun périmètre n'est créé ; l'apply réussit néanmoins.

#### Étape 3 — Vérifier {#step-3--verify-16}

```bash
# Audit logging is real
gcloud projects get-iam-policy "$PROJECT" --format="yaml(auditConfigs)"
# expect allServices with ADMIN_READ, DATA_READ, DATA_WRITE, plus secretmanager and cloudkms entries

# Did a perimeter actually get created?
gcloud access-context-manager policies list --organization="<your-org-id>" 2>/dev/null
gcloud access-context-manager perimeters list --policy="<policy-id>" 2>/dev/null | grep -i "$PROJECT"
```

Comparez avec les sorties du déploiement sur la page de déploiement RAD : `vpc_sc_enabled`, `vpc_sc_perimeter_name`, `vpc_sc_dry_run_mode`, `audit_logging_enabled`. Lorsque VPC-SC a été ignoré, `vpc_sc_enabled = false` et `vpc_sc_perimeter_name` restent vides **bien que vous ayez défini `enable_vpc_sc = true`** — le module rend compte de ce qui s'est réellement produit, et non de ce qui a été demandé. Fiez-vous aux sorties et à la liste des périmètres, pas aux entrées.

Si un périmètre en mode simulation existe, consultez ses refus prévisionnels :

```bash
gcloud logging read 'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project="$PROJECT" --limit=20 --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

#### Explorer davantage {#explore-further-16}

- Lisez un secret (`gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"`) et trouvez son entrée DATA_READ correspondante dans Logs Explorer — elle n'existe que si la journalisation d'audit est activée.

#### Pièges à éviter {#watch-out-for-16}

- Activer `vpc_sc_dry_run = false` d'emblée peut bloquer Cloud Build, les déploiements et l'application active en même temps si une identité ou une adresse IP manque dans les niveaux d'accès.
- Avec un `admin_ip_ranges` vide, VPC-SC est ignoré afin d'éviter de bloquer les administrateurs hors du projet.

#### Retour arrière {#revert-16}

```hcl
enable_vpc_sc        = false
enable_audit_logging = false
admin_ip_ranges      = []
```

---

### Lab I — Isolation dans un projet partagé (sans groupe) {#lab-i--isolation-in-a-shared-project-no-group}

> **Objectif :** donner à l'application son propre périmètre au sein d'un projet partagé — son propre compte de service, uniquement les rôles additionnels nécessaires, et une barrière d'isolation protégeant ses secrets, ses données, son service et ses jobs contre toute autre identité.

**Vous allez :** basculer l'application sur un compte de service dédié et vérifier que chaque job s'exécute sous son identité · attribuer un rôle supplémentaire et voir où il est appliqué · activer la barrière d'isolation (si vous avez le rôle au niveau de l'organisation) et prouver que le compte partagé se voit refuser l'accès.
**Durée :** 30–40 min · **Coût :** aucun · **Prérequis / configuration externe :** le compte dédié ne requiert rien d'externe. La barrière nécessite `roles/resourcemanager.tagAdmin` sur le projet **ainsi que `roles/iam.denyAdmin`, qui ne peut être accordé qu'au niveau de l'organisation (ou du dossier)** — un Owner de projet sans accès à l'organisation ne peut pas satisfaire cette exigence, et le plan le signale. Tester la barrière depuis l'extérieur requiert également `roles/iam.serviceAccountTokenCreator` sur le compte partagé.

Ces variables ne portant pas de groupe UIMeta, elles s'affichent sur le formulaire sans en-tête de groupe.

#### Paramètres de ce lab {#settings-in-this-lab}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `dedicated_service_account_id` | `""` | Non | Exécute l'application sous son propre compte (6–30 car.). Elle n'obtient que les rôles réseau, client Cloud SQL, accès VPC et journalisation sur le projet, ainsi que ses propres secrets, buckets et jobs ; Cloud Scheduler exécute ses jobs sous cette identité. |
| `additional_cloudrun_sa_roles` | `[]` | Non | Rôles de projet supplémentaires pour le compte sous lequel tourne l'application (partagé ou dédié). Les rôles Owner/Editor/IAM/resource-manager/org-policy/billing sont refusés. |
| `fence_enabled` | `false` | Non | Clé de tag `fence-$SERVICE` = `fenced` sur le service, chaque job, les buckets, le secret du mot de passe DB et `fence_secret_ids`/`fence_resources`, plus la stratégie de refus IAM `fence-$SERVICE` sur le projet. Requiert un compte dédié. |
| `fence_administrators` | `[]` | Non | Adresses e-mail toujours autorisées à franchir la barrière : l'auteur du déploiement et les administrateurs d'urgence (break-glass). |
| `fence_secret_ids` | `[]` | Non | Secrets supplémentaires possédés par l'application (jamais un secret lu par une autre application). |
| `fence_resources` | `[]` | Non | Autres ressources régionalisées à isoler : `{ name = "//…full resource name", location = "…" }`. |

#### Étape 1 — Configurer {#step-1--configure-17}

Commencez par le compte dédié uniquement :

```hcl
dedicated_service_account_id = "crapp-lab-sa"                 # becomes crapp-lab-sa@<project>.iam.gserviceaccount.com
additional_cloudrun_sa_roles = ["roles/cloudtrace.agent"]     # granted to the account the app runs as
```

Puis, uniquement si vous disposez du rôle au niveau de l'organisation, ajoutez la barrière d'isolation :

```hcl
fence_enabled        = true
fence_administrators = ["<your-email>"]                      # include yourself, or you lock yourself out
```

#### Étape 2 — Appliquer {#step-2--apply-17}

**Update**. Le compte dédié est créé, reçoit ses rôles de projet et ses accès par ressource, et le service ainsi que chaque job basculent dessus (nouvelle révision, ~4–6 min). Avec la barrière, la clé/valeur de tag, les liaisons de tags et la stratégie de refus sont ajoutées en dernier. S'il vous manque `iam.denyAdmin`, le plan échoue en désignant la permission manquante et rien n'est modifié.

#### Étape 3 — Vérifier {#step-3--verify-17}

```bash
export APP_SA="crapp-lab-sa@${PROJECT}.iam.gserviceaccount.com"

# The service and EVERY job run as the dedicated account
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(spec.template.spec.serviceAccountName)"
for j in $(gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE" --format="value(metadata.name)"); do
  echo "$j: $(gcloud run jobs describe "$j" --project="$PROJECT" --region="$REGION" --format="value(spec.template.spec.template.spec.serviceAccountName)")"
done

# Its project-wide roles: only network, Cloud SQL client, VPC access, logging — plus the extra role
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$APP_SA" --format="value(bindings.role)"

# It can read its own DB password secret
gcloud secrets get-iam-policy "$DB_SECRET" --project="$PROJECT" --format="table(bindings.role,bindings.members)"

# And the app still works
curl -s "$SERVICE_URL/db"
```

Avec la barrière :

```bash
gcloud resource-manager tags keys list --parent="projects/$PROJECT" --filter="shortName~fence-"
gcloud iam policies list --attachment-point="cloudresourcemanager.googleapis.com/projects/$PROJECT" --kind=denypolicies
# From OUTSIDE the fence: impersonate the tenant-shared account and try to read the app's secret
gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT" \
  --impersonate-service-account="cloudrun-sa-${TENANT_PREFIX}@${PROJECT}.iam.gserviceaccount.com"
# expect PERMISSION_DENIED — while the app (dedicated account) and you (fence administrator) still succeed
```

#### Explorer davantage {#explore-further-17}

- Ajoutez un job cron (Lab 7) après avoir activé le compte dédié : il est créé directement sous l'identité du compte dédié, et son déclencheur Scheduler peut toujours le lancer.
- Si votre application possède une autre ressource (un trousseau de clés KMS, par exemple), déclarez-la dans `fence_resources` et confirmez l'association du tag.

#### Pièges à éviter {#watch-out-for-17}

- **Procédez dans l'ordre** : compte dédié d'abord, vérifiez l'application et chaque job, puis activez la barrière.
- **Laissez-vous dans `fence_administrators`** ; la stratégie de refus prévaut sur toute autorisation, y compris Owner.
- Ce qu'aucune application individuelle ne peut isoler : le mot de passe root partagé de Cloud SQL (les jobs de base de données de chaque application l'utilisent) et les secrets lus par plusieurs applications.
- **`additional_cloudrun_sa_roles` sur le compte partagé affecte toutes les applications du tenant**, et retirer un rôle de la liste ne le **révoque pas** — retirez-le manuellement avec `gcloud projects remove-iam-policy-binding`. Les rôles attribués à un compte dédié sont supprimés avec ce compte lors de sa destruction.

#### Retour arrière {#revert-17}

Définissez `fence_enabled = false`, `fence_administrators = []` et appliquez (la stratégie de refus et les tags partent en premier). Définissez ensuite `dedicated_service_account_id = ""` et `additional_cloudrun_sa_roles = []` puis appliquez : l'application repasse sur `cloudrun-sa-$TENANT_PREFIX` et le compte dédié ainsi que ses rôles de projet sont supprimés. Si vous aviez accordé un rôle supplémentaire pendant l'utilisation du compte partagé, révoquez-le manuellement :

```bash
gcloud projects remove-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:cloudrun-sa-${TENANT_PREFIX}@${PROJECT}.iam.gserviceaccount.com" --role="roles/cloudtrace.agent"
```

---

## Tâche 3 — Exploiter et maintenir en conditions opérationnelles (Day-2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ajustez la mise à l'échelle** en modifiant les entrées d'instances min/max et en cliquant sur **Update** sur la page des détails du déploiement —
   le module gère la spécification du service, la mise à l'échelle est donc une modification de configuration et non une
   édition manuelle avec `gcloud` (une modification manuelle serait annulée lors du prochain apply). Consultez le Lab 4.

3. **Mettez à jour la version de l'application** en modifiant la version en entrée via **Update** sur la page des détails du déploiement ; une nouvelle image est compilée ou mise en miroir, et une nouvelle révision est déployée. Consultez le Lab 3.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name.basename())"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"   # init + scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"
   ```

5. **Relancez un job de base de données** lorsque les identifiants et la base dérivent (par exemple après une modification de la longueur du mot de passe) : `gcloud run jobs execute "$SERVICE-db-create" --project="$PROJECT" --region="$REGION" --wait`. Les jobs d'initialisation avec `execute_on_apply = true` sont également réexécutés à chaque **Update**.

6. **Effectuez une sauvegarde avant toute modification risquée** : `gcloud run jobs execute "$SERVICE-db-export" --project="$PROJECT" --region="$REGION" --wait` (Lab 13).

7. **Ouvrez une session de base de données** pour inspection ou maintenance. L'instance partagée est généralement accessible uniquement par IP privée, utilisez donc **Cloud SQL Studio** dans la console (base de données et utilisateur `$SERVICE`, mot de passe depuis `gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"`). Si l'instance possède une IP publique, `gcloud sql connect "$SQL_INSTANCE" --project="$PROJECT" --user="$SERVICE" --database="$SERVICE"` fonctionne également.

8. **Attention aux quotas régionaux.** Un service toujours actif mobilise du quota CPU Cloud Run 24 h/24 et 7 j/7. Réduisez la voilure avec `min_instance_count = 0` via **Update** ; n'utilisez jamais `gcloud run services update --scaling=0`, qui fige définitivement le service à zéro instance tout en indiquant toujours `Ready`.

---

## Tâche 4 — Observer : Journaux et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   # a job's logs
   gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-db-init\"" \
     --project="$PROJECT" --limit=50 --format="value(timestamp,textPayload)"
   ```

   Filtres de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"` et
   `resource.type="cloud_run_job" AND resource.labels.job_name="<service>-<job>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) ainsi que l'utilisation CPU
   / mémoire. Le module crée des règles d'alerte CPU et mémoire lorsque la surveillance est configurée (`support_users`, `alert_policies` ou un test de disponibilité). Un **test de disponibilité** (uptime check) n'existe que si vous l'avez activé **et** que le service conserve au moins une instance chaude (Lab 6) ; confirmez qu'il est au vert sous Monitoring → Uptime checks, et passez en revue Alerting → Policies.

3. **Piste d'audit** — avec `enable_audit_logging = true` (Lab 18), les entrées d'accès aux données pour les secrets et KMS apparaissent sous **Logging → Logs Explorer** avec `logName:"cloudaudit.googleapis.com%2Fdata_access"`.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques éprouvées pour les modes de défaillance les plus probables. Ce sont des
diagnostics au niveau de la plateforme qui ne dépendent pas de la charge de travail déployée
dans le conteneur.

- **Révision défaillante / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour détecter les erreurs de démarrage, et confirmez la résolution des variables d'environnement et des secrets. Un `container_port` incorrect ou une sonde de démarrage sur un chemin que l'application ne dessert pas empêche la révision de devenir prête, tandis que le trafic reste sur la révision précédente.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreur 404 sans journaux de conteneur :** lisez le titre de la page (Lab 15) — la 404 de l'application, la 404 de Google (`run.invoker` manquant ou un chemin appartenant au front-end comme `/healthz`), ou la 404 de l'ingress (`404 Page not found`). Vérifiez `gcloud run services get-iam-policy "$SERVICE" …` pour `allUsers` avant de soupçonner l'application.
- **Réponse 200 mais l'application est défaillante :** `/` renvoie 200 même lorsque la base de données est indisponible — lisez le corps de la réponse (`DB unavailable: …`) ou appelez `/db`.
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de base de données existe et est accessible au compte de service, et que le job d'initialisation s'est terminé avec succès. Un message `password authentication failed` après un apply ayant modifié `database_password_length` signifie que le secret et la base de données ont divergé — relancez `$SERVICE-db-create`. Une ligne `pg_hba.conf … no encryption` suivante correspond à la nouvelle tentative sans SSL de psql, et non à un problème TLS.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
  gcloud run jobs executions list --job="$SERVICE-db-init" --project="$PROJECT" --region="$REGION"
  ```
  Si vous avez fourni `initialization_jobs` sans `db-init`, l'initialisation de la base de données ne s'exécute plus.
- **Service frère inaccessible (`404` depuis l'intérieur) :** `additional_services` sont exclusivement internes et leur URL injectée est publique — définissez `vpc_egress_setting = "ALL_TRAFFIC"` (Lab 7).
- **L'application a perdu son URL Redis :** la définition de `redis_auth` retire `REDIS_URL` (Lab 11).
- **Échec du test de disponibilité sur un service sain :** il sonde `/healthz` à travers le front-end ; utilisez `/` (Lab 6). Aucun test de disponibilité du tout : le service est mis à l'échelle à zéro.
- **Données manquantes après un redémarrage :** vérifiez où l'application écrit avec un test d'écriture-redémarrage-lecture (Lab 9/10) — un montage sur un mauvais chemin semble sain mais reste vide.
- **Les sondes WAF renvoient toujours 200 :** les règles Cloud Armor mettent 5 à 10 minutes à prendre effet après l'apply (Lab 17).
- **Échec du plan sur IAP, le périmètre (fence) ou une combinaison de fonctionnalités :** lisez le message — ces garde-fous se déclenchent avant que quoi que ce soit ne soit modifié (Labs 16, I, 17).
- **Échec de la compilation ou de la mise en miroir de l'image :** examinez l'historique Cloud Build pour consulter les journaux
  du build en échec sous Cloud Build → History.
- **Erreurs 403 / autorisations :** vérifiez les rôles IAM du compte de service d'exécution et
  assurez-vous que tous les secrets référencés existent dans Secret Manager. Lorsqu'un périmètre de protection est activé, une identité en dehors de `fence_administrators` est refusée par conception.
- **`Quota exceeded` / 503 sans aucun journal lors d'un démarrage à froid :** le quota CPU régional de Cloud Run est épuisé par des services toujours actifs ; réduisez l'échelle des autres services avec `min_instance_count = 0` et attendez quelques minutes.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour connaître les pièges
spécifiques à chaque paramètre.

---

## Tâche 6 — Démantèlement [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône de **corbeille** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des registres de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cette opération supprime tout ce que le module a créé — le service Cloud Run,
la base de données et l'utilisateur de l'application, les secrets Secret Manager, les buckets GCS, les jobs Cloud Run
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL
partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

Les labs de fonctionnalités peuvent laisser des éléments que le module ne possède pas — supprimez-les vous-même :

| Laissé par | Élément | Comment le supprimer |
|---|---|---|
| Lab 5 | Secret `lab-api-key` que vous avez créé | `gcloud secrets delete lab-api-key --project="$PROJECT"` |
| Lab 14 | Fichiers locaux `01-create.sql` / `02-insert.sql` (les copies dans le bucket disparaissent avec le bucket) | supprimer localement |
| Lab 16 | La marque OAuth / écran de consentement | ne peut pas être supprimé ; sans incidence |
| Lab 17 | Enregistrement DNS A pour un domaine personnalisé | à supprimer chez votre fournisseur DNS |
| Lab I | Un rôle supplémentaire accordé au compte **partagé** `cloudrun-sa-…` | `gcloud projects remove-iam-policy-binding` (illustré dans le Lab I) |
| Lab 8 | Attestateur Binary Authorization/clé KMS créés par le module si absents | ressources partagées du projet ; à conserver ou à supprimer délibérément |
| Lab 18 | Une stratégie d'accès VPC-SC réutilisée depuis l'organisation | appartient à l'organisation ; non supprimée |

Si la destruction échoue avec `resourceInUseByAnotherResource` sur le réseau peu après la suppression du service, GCP est encore en train de libérer les réservations d'IP serverless du service — attendez 20 à 30 minutes et relancez **Delete**.

---

## Annexe — Variables d'interconnexion de plateforme du Groupe 0 {#appendix--group-0-platform-wiring-variables}

Celles-ci ne sont jamais affichées sur le formulaire. La plateforme ou un module wrapper les définit ; laissez-les à leurs valeurs par défaut lors du déploiement direct de `App_CloudRun`.

| Variable | Rôle |
|---|---|
| `module_description`, `module_documentation`, `module_dependency`, `module_services` | Métadonnées du catalogue : description, lien vers la documentation, dépendance envers `Services_GCP`, liste des services. |
| `credit_cost`, `require_credit_purchases` | Frais de module et obligation de paiement à partir de crédits achetés. |
| `enable_purge`, `public_access`, `shared_users`, `technical_support_users` | Visibilité dans le catalogue, autorisation de purge, qui peut déployer, qui assure le support. |
| `requires_services` | Quelles options `Services_GCP` `create_*` la plateforme doit activer (Postgres et NFS par défaut). |
| `require_services_gcp_module` | `true` fait échouer le plan lorsqu'aucun réseau `Services_GCP` n'existe ; `false` autorise le mode autonome intégré (inline). |
| `resource_creator_identity`, `impersonation_service_account` | Identités utilisées par Terraform et les scripts utilitaires. |
| `job_execution_wait_timeout` | Nombre de secondes pendant lesquelles un apply attend l'exécution d'un job (valeur par défaut : 900). |
| `module_storage_buckets`, `module_env_vars`, `module_secret_env_vars`, `module_writable_secret_ids`, `module_explicit_secret_values`, `module_service_needs_root_password`, `scripts_dir` | Injectées par les modules wrapper (buckets supplémentaires, variables d'environnement, secrets, répertoire de scripts). |
| `postgres_extensions`, `mysql_plugins` | Listes d'extensions/plugins, fournies par les modules wrapper. |
| `application_config` | Mappage de configuration applicative du module wrapper ; remplace la présélection d'application d'exemple intégrée lorsque `App_CloudRun` est appelé en tant que module enfant. |

---

## Résumé {#summary}

| Tâche / Lab | Type | Résultat |
|---|---|---|
| 1 — Déployer la configuration de référence | Automatisé | Le module se lie au socle `Services_GCP` ; compile l'application d'exemple ; crée le service, la base de données et l'utilisateur, le secret, le raccordement NFS/Redis, le bucket de sauvegarde et les jobs |
| 2 — Accéder et vérifier | Manuel | Le compteur de visites et `/db` confirment la chaîne ; liaison au socle, variables d'environnement injectées, base de données, secret, job d'initialisation, NFS et labels de plateforme relus |
| Lab 2 — Utilisateurs de support et labels de ressources | Fonctionnalité | Canal d'alerte e-mail créé ; labels personnalisés sur le service, les jobs, les buckets et les secrets ; clés réservées appliquées |
| Lab 3 — Identité de l'application | Fonctionnalité | Incrémentation de version suivie jusqu'à un nouveau tag d'image, `APP_VERSION` et une nouvelle révision |
| Lab 4 — Runtime et mise à l'échelle | Fonctionnalité | Instance chaude, montée en charge, CPU toujours actif, ressources, nettoyage des révisions, version canary taguée |
| Lab 5 — Variables d'environnement et secrets | Fonctionnalité | Variables d'environnement en clair et secrètes ; variable nommée comme un identifiant déplacée automatiquement dans Secret Manager |
| Lab 6 — Jobs d'initialisation et tests de santé | Fonctionnalité | Job d'initialisation chaîné ajouté avec conservation de `db-init` ; sondes ajustées, test de disponibilité opérationnel sur `/`, alerte de latence ; aucun test pour la mise à l'échelle à zéro |
| Lab 7 — Tâches Cron, services additionnels et sidecars | Fonctionnalité | Job Cron, service frère (accessible uniquement avec la sortie `ALL_TRAFFIC`) et sidecar |
| Lab 8 — Intégration CI/CD et GitHub | Fonctionnalité | Binary Authorization relu depuis le service ; garde-fous et pipeline CI/CD et Cloud Deploy |
| Lab 9 — Stockage et système de fichiers — NFS | Fonctionnalité | Point de montage déplacé ; persistance prouvée par écriture-redémarrage-lecture |
| Lab 10 — Stockage, système de fichiers et registre d'images | Fonctionnalité | Bucket versionné dédié à l'application monté avec GCS Fuse ; les écritures du job atterrissent dans le bucket |
| Lab 11 — Cache Redis | Fonctionnalité | Variables Redis injectées ; `redis_auth` remplace `REDIS_URL` par un secret `REDIS_AUTH` |
| Lab 12 — Backend de base de données | Fonctionnalité | Identité et alias de la base de données (socket vs IP privée) ; rotation automatique du mot de passe de bout en bout |
| Lab 13 — Sauvegarde et maintenance | Fonctionnalité | Planification et rétention modifiées ; sauvegarde à la demande ; dump de validation restauré et vérifié |
| Lab 14 — Initialisation personnalisée et SQL | Fonctionnalité | Scripts SQL ordonnancés exécutés depuis un bucket en tant qu'utilisateur applicatif |
| Lab 15 — Accès et réseau | Fonctionnalité | Ingress interne, egress vers tout le trafic, réseau épinglé ; distinction entre les trois types de 404 |
| Lab 16 — Identity-Aware Proxy | Fonctionnalité | Garde-fous de plan observés ; connexion Google imposée ; accès anonyme en 403 |
| Lab 17 — Cloud Armor et CDN | Fonctionnalité | LB + WAF + CDN rattachés et vérifiés ; XSS/SQLi bloqués ; `run.app` fermé |
| Lab 18 — VPC Service Controls et journalisation d'audit | Fonctionnalité | Configurations d'audit actives ; résultat VPC-SC lu fidèlement depuis les sorties |
| Lab I — Isolation dans un projet partagé | Fonctionnalité | Compte de service dédié sur le service et chaque job ; rôles supplémentaires ; le périmètre interdit le compte partagé |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer secrets/jobs/stockage, relancer les jobs de base de données, sauvegarder, accès base de données, gestion rigoureuse des quotas |
| 4 — Observer | Manuel | Journaux de service et de job ; métriques Cloud Run, règles d'alerte, test de disponibilité, journaux d'audit |
| 5 — Dépannage | Manuel | Diagnostiquer les révisions, les trois 404, la dérive des identifiants de base de données, les jobs d'initialisation, les services frères, Redis, les chemins de stockage, les délais WAF, IAM |
| 6 — Démantèlement | Automatisé | Delete (corbeille) supprime toutes les ressources du module ; les ressources partagées détenues par `Services_GCP` subsistent ; résidus de labs supprimés manuellement |
