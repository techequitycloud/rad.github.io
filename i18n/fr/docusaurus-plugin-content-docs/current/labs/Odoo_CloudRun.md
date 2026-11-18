---
title: "Odoo sur Cloud Run — Guide de lab"
description: "Labs pratiques : déployez une configuration de base, puis choisissez des labs de fonctionnalités pour chaque groupe de configuration — chacun avec un objectif, des paramètres testés, une vérification, des pièges et des étapes de restauration — plus les opérations, l'observabilité et le démantèlement."
---

<!-- translated-from: docs/labs/Odoo_CloudRun.md @ 2be24ed1 sha256:d6d7efe92bbb -->

# Odoo sur Cloud Run — Guide de lab {#odoo-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Odoo_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** parcours principal (tâches 1 et 2) environ 45 à 60 minutes, la majeure partie consistant à attendre le premier
déploiement ; chaque lab de fonctionnalités 10 à 40 minutes ; l'ensemble des labs de bout en bout environ 8 à 9 heures.

Odoo est une suite ERP open source complète couvrant le CRM, la comptabilité, les stocks, la
production, les RH et l'e-commerce. Le module **Odoo on Cloud Run** déploie Odoo Community
Edition sous la forme d'un service Cloud Run v2 (gen2) adossé à Cloud SQL for PostgreSQL, avec le
filestore d'Odoo, ses sessions et sa configuration sur un partage NFS partagé et un bucket Cloud Storage `addons`
monté pour les modules supplémentaires. Il s'agit d'un wrapper léger : les éléments spécifiques à Odoo (l'image de conteneur,
le script de démarrage qui écrit et réconcilie `odoo.conf`, ainsi que les jobs
`nfs-init` et `db-init`) proviennent de la configuration d'application Odoo partagée, et tout le reste — réseau,
secrets, jobs, sauvegardes, sécurité et surveillance — provient du socle App_CloudRun.

Ce lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, non sur les fonctionnalités
métier d'Odoo. Il s'agit de plusieurs labs en un : chacun déploie et vérifie une configuration de base, puis vous
choisissez les labs de fonctionnalités qui vous intéressent dans le menu ci-dessous.

### Organisation de ce lab {#how-this-lab-is-organised}

- **Partie 1 — Cœur (tâches 1 et 2).** Déployez une configuration de base avec les valeurs par défaut et vérifiez-la, y compris
  la première connexion à Odoo. Tout le monde effectue cette étape.
- **Partie 2 — Labs de fonctionnalités.** Un lab par groupe de variables sur le formulaire de déploiement, numéroté par
  groupe (Lab 4 = Groupe 4). Après la configuration de base, ils sont indépendants les uns des autres et peuvent être exécutés
  dans n'importe quel ordre. Chacun indique son objectif, sa durée, son coût et ses prérequis, puis vous guide à travers les étapes
  configurer → appliquer → vérifier → explorer → restaurer.
- **Partie 3 — Exploiter, observer, dépanner, démanteler (tâches 3 à 6).**

### Menu des labs {#lab-menu}

| Lab | Groupe | Objectif (ce que vous serez en mesure de faire) | Durée | Coût supplémentaire ? | Configuration externe |
|---|---|---|---|---|---|
| Tâche 1 | 1 | Déployer Odoo avec les valeurs par défaut et localiser chaque ressource créée | 30–40 min | De base | Aucune |
| [Lab 2](#lab-2--deployment-environment--isolation-group-2) | 2 | Ajouter des destinataires d'alertes et des étiquettes de coût, et exécuter Odoo sous son propre compte de service au lieu de celui partagé par le tenant | 20–25 min | Non | Cloisonnement uniquement : un rôle IAM au niveau de l'organisation |
| [Lab 3](#lab-3--application-identity--version-group-3) | 3 | Renommer le texte d'affichage du service et reconstruire Odoo sur un autre canal de version | 15–30 min | Non | Aucune |
| [Lab 4](#lab-4--runtime--scaling-group-4) | 4 | Dimensionner le CPU/la mémoire, maintenir les actions planifiées d'Odoo actives, éliminer les démarrages à froid et répartir le trafic entre les révisions | 30–40 min | Oui (instance toujours active) | Aucune |
| [Lab 5](#lab-5--ingress-vpc--iap-group-5) | 5 | Contrôler qui peut accéder à l'URL `run.app` et placer une authentification Google devant Odoo | 15–30 min | Non | IAP uniquement : un écran de consentement OAuth |
| [Lab 6](#lab-6--environment-variables--secrets-group-6) | 6 | Injecter des variables d'environnement simples et adossées à Secret Manager, et voir les valeurs nommées comme des identifiants être déplacées automatiquement dans Secret Manager | 20 min | Négligeable | Aucune |
| [Lab 7](#lab-7--backup--maintenance-group-7) | 7 | Planifier des sauvegardes nocturnes de la base de données et du filestore, en exécuter une à la demande et (facultatif) restaurer un dump | 20–30 min | Faible (stockage) | Import uniquement : un fichier de sauvegarde préparé |
| [Lab 8](#lab-8--cicd--binary-authorization-group-8) | 8 | Appliquer Binary Authorization sur le service ; comprendre le câblage du push-to-deploy et de la promotion Cloud Deploy | 15 min (+30 avec GitHub) | Faible | CI/CD uniquement : un dépôt GitHub et un jeton ou une installation d'application |
| [Lab 9](#lab-9--custom-sql-scripts-group-9) | 9 | Exécuter vos propres scripts SQL ordonnés sur la base de données d'Odoo depuis un bucket | 20 min | Négligeable | Un bucket que vous créez (étapes incluses) |
| [Lab 10](#lab-10--cloud-armor-domains--artifact-registry-group-10) | 10 | Placer Odoo derrière un équilibreur de charge HTTPS global, un WAF et un CDN, sur un domaine nip.io ou personnalisé | 30–45 min | Oui (équilibreur de charge, Cloud Armor) | Domaine personnalisé uniquement : un DNS que vous contrôlez |
| [Lab 11](#lab-11--cloud-storage--nfs-group-11) | 11 | Ajouter des buckets et un point de montage GCS Fuse, et prouver que le filestore survit à un redémarrage | 25 min | Faible | Options CMEK : un trousseau de clés KMS (créé automatiquement) |
| [Lab 12](#lab-12--database-backend-group-12) | 12 | Activer la rotation automatique du mot de passe de base de données et observer une rotation atteindre Odoo | 25–30 min | Négligeable | Aucune |
| [Lab 13](#lab-13--jobs--scheduled-tasks-group-13) | 13 | Ajouter votre propre job d'initialisation chaîné et un job planifié qui rapporte la taille du filestore | 25 min | Faible | Aucune |
| [Lab 14](#lab-14--observability--health-group-14) | 14 | Ajuster les sondes d'Odoo, créer un test de disponibilité et une règle d'alerte personnalisée | 20 min | Faible | Aucune |
| [Lab 21](#lab-21--redis-cache-group-21) | 21 | Relier Odoo au serveur Redis co-hébergé sur la VM NFS partagée | 15 min | Non | Aucune |
| [Lab 22](#lab-22--vpc-service-controls--audit-logging-group-22) | 22 | Activer les journaux d'audit détaillés ; exécuter en mode simulation (dry-run) un périmètre VPC Service Controls | 15–20 min | Oui (volume de logs) | VPC-SC uniquement : une organisation |

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser chaque ressource qu'il provisionne.
- Effectuer la première connexion à Odoo et confirmer que la base de données, le filestore et les secrets sont bien raccordés.
- Modifier n'importe quel groupe de paramètres avec **Update**, prédire ce que le changement va créer, modifier ou
  remplacer, et vérifier le résultat sur la ressource déployée plutôt que de faire aveuglément confiance à un apply vert.
- Exploiter le service au quotidien — révisions, mise à l'échelle, versions, secrets, sauvegardes, jobs.
- L'observer avec Cloud Logging et Cloud Monitoring, et diagnostiquer les modes de défaillance courants.
- Démanteler proprement le déploiement, y compris tout ce que les labs de fonctionnalités ont pu laisser derrière eux.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Filestore, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe
  déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir
  Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement à l'intérieur, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Project Owner, puis **Verify**) et d'attribuer au compte de service de déploiement RAD le rôle **Owner**. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé pour vous par RAD, guère plus que le nom du tenant et la région). Chaque autre paramètre du guide de configuration — y compris les paramètres de mise à l'échelle et de version dans les tâches Day-2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, accessible à tout compte tant que les builds sont inclus dans le prix (sur un environnement de lab, seul un administrateur peut l'utiliser). Les mises à jour n'entraînent jamais de frais de module.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- `curl` et (facultatif) `jq` sur votre poste de travail.

Définissez ces variables de shell une seule fois ; chaque tâche ci-dessous les réutilise. `SERVICE` et les noms dérivés
sont découverts après la tâche 1.

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"          # the region you deploy into

# After Task 1 completes:
export SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
  --filter="metadata.name~^odoo" --format="value(metadata.name)" --limit=1)
export SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format="value(status.url)")
echo "Service: $SERVICE"; echo "URL: $SERVICE_URL"
```

Chaque ressource propre à l'application est nommée à partir de `SERVICE`, qui correspond à `application_name` + `tenant_id` +
un hash de 8 caractères (par exemple `odoodemo1a2b3c4d`) :

| Ressource | Nom |
|---|---|
| Service Cloud Run | `$SERVICE` |
| Jobs d'initialisation / utilitaires | `$SERVICE-nfs-init`, `$SERVICE-db-init`, `$SERVICE-db-create`, `$SERVICE-nfs-setup` |
| Job de sauvegarde et planification | `$SERVICE-db-export`, Cloud Scheduler `$SERVICE-backup-schedule` |
| Buckets | `gcs-$SERVICE-addons`, `gcs-$SERVICE-data`, `gcs-$SERVICE-backups` |
| Base de données et utilisateur | `$SERVICE` avec les tirets remplacés par des traits de soulignement |
| Secret du mot de passe maître Odoo | `secret-<tenant><hash>-<application_name>-master-password` |
| Secret du mot de passe de la BDD | `secret-<sql-instance>-$SERVICE` |
| Sous-arborescence NFS sur le serveur partagé | `/share/$SERVICE`, montée sur `/mnt` |

## Comment modifier les paramètres dans les labs de fonctionnalités {#how-to-change-settings-in-the-feature-labs}

- **Mise à jour en mode avancé.** Ouvrez **Deployments**, ouvrez votre déploiement Odoo, cliquez sur
  **Update**, cochez **Enable advanced mode**, modifiez les entrées indiquées par le lab (elles sont regroupées
  exactement comme dans les titres du lab), puis soumettez. La page de statut diffuse les logs du plan et de l'apply.
  Les mises à jour n'entraînent jamais de frais de module ; les builds sont inclus dans le prix (5 mises à jour gratuites par mois,
  puis un petit coût de build).
- **Compatible avec les mises à jour (update-safe) ou non.** Les champs signalés comme *update-safe* peuvent être modifiés sur un déploiement en cours d'exécution.
  Les champs sans cette mention affichent un avertissement avant que vous ne soumettiez, car les modifier peut détruire ou
  remplacer une ressource (par exemple, supprimer un bucket de `storage_buckets` supprime ce bucket).
  Si **Enforce Update Safe** est activé sur le déploiement, les champs non signalés sont en lecture seule et les labs
  qui en ont besoin (marqués « Non » dans la colonne *Update-safe*) ne peuvent pas être exécutés tant qu'il n'est pas désactivé.
- **La validation au moment du plan fait partie de l'apprentissage.** De nombreuses combinaisons invalides sont refusées avant
  que quoi que ce soit ne soit créé — `min_instance_count` supérieur à `max_instance_count`, CDN sans Cloud Armor,
  IAP sans utilisateurs autorisés ou sans écran de consentement OAuth, SQL personnalisé sans bucket ni chemin,
  `fence_enabled` sans le bon rôle IAM. Lisez l'erreur : elle indique la variable et le correctif.
- **Un lab à la fois.** Appliquez un groupe, vérifiez-le, puis choisissez soit **Revert** (chaque lab indique
  exactement ce qu'il faut restaurer), soit conservez-le si un lab ultérieur s'appuie dessus.
- **Vérifiez l'objet déployé, pas seulement l'apply vert.** Un apply réussi prouve que Terraform s'est exécuté ;
  cela ne prouve pas que le paramètre a fait ce que vous attendiez. Chaque étape de vérification relit la ressource —
  `gcloud ... describe`, les variables d'environnement de la révision, un `curl` du point de terminaison ou un cycle
  écriture-redémarrage-lecture pour le stockage.
- Les **extraits de configuration** dans les labs sont écrits sous forme de lignes `name = value`, de la même manière que le
  guide de configuration les documente ; saisissez chaque valeur dans le champ du même nom sur le formulaire.

---

## Tâche 1 — Déployer la configuration de base [Automatisé] {#task-1--deploy-the-baseline-automated}

Le groupe 1 (**Project & Identity** : `project_id`, `tenant_id`, `region`) est défini ici, sur le formulaire de création ;
il n'y a pas de lab de fonctionnalités distinct pour celui-ci. Conservez les valeurs par défaut pour tout le reste.

**Paramètres de base :**

```hcl
project_id = "<your-project-id>"  # the only required input
tenant_id  = "demo"               # 1–7 lowercase letters/digits; shared by every app in the tenant
region     = "us-central1"        # must match the region Services_GCP uses
# Defaults you get: application_name = "odoo", application_version = "18.0" (custom build),
# 1 vCPU / 2Gi, min 0 / max 1 instances (scale to zero), request-based CPU,
# ingress "all", NFS on, addons bucket + "data" bucket, nightly backup at 02:00 UTC.
```

> **Choisissez `tenant_id` avec soin.** Il est limité à 7 caractères (les noms de comptes de service ont une limite
> de 30 caractères) et ne peut pas être modifié ultérieurement. Si vous déployez également **Odoo on GKE** dans le
> même projet, attribuez aux deux des tenants différents (par exemple `cr` et `gke`) ou des
> valeurs de `application_name` différentes — les deux variantes dérivent chaque nom des mêmes entrées et entreraient
> autrement en collision sur la base de données, les secrets et les buckets.

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Odoo (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, puis passez en revue les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Odoo_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page de statut du déploiement avec les logs en temps réel.

2. La plateforme provisionne (ou découvre) les services partagés, puis construit l'image Odoo à partir
   du package nightly officiel avec Cloud Build, crée le service Cloud Run (gen2), la
   base de données et son utilisateur sur l'instance Cloud SQL partagée, les secrets Secret Manager (mot de passe
   de base de données et mot de passe maître Odoo), les buckets `addons` et `data` ainsi que le bucket de sauvegarde,
   et exécute les jobs ponctuels : `nfs-init` (qui crée `/mnt/filestore`, `/mnt/sessions` et
   `/mnt/extra-addons`, appartenant à l'uid 101 d'Odoo) et `db-init` (qui crée ou resynchronise le
   rôle et la base de données PostgreSQL ; il s'exécute à chaque apply et est idempotent). Les premiers déploiements prennent
   environ **20 à 35 minutes** lorsque Services_GCP est créé au cours de la même exécution (Cloud SQL prend le plus de temps),
   et environ 10 à 15 minutes dans un projet où il existe déjà.

3. Une fois terminé, définissez les variables de shell indiquées dans les *Prérequis* et confirmez les ressources créées :

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud storage buckets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
   gcloud secrets list --project="$PROJECT" --format="value(name)" | grep -E "$SERVICE|master-password"
   gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" | grep "$SERVICE"
   ```

   Résultat attendu : un service ; des jobs incluant `nfs-init`, `db-init`, `db-create`, `nfs-setup` et
   `db-export` ; trois buckets (`addons`, `data`, `backups`) ; les deux secrets ; et le
   job Cloud Scheduler `$SERVICE-backup-schedule`.

---

## Tâche 2 — Accéder à la configuration de base et la vérifier [Manuel] {#task-2--access--verify-the-baseline-manual}

1. **Santé.** Odoo répond `/web/health` dès que son serveur HTTP est opérationnel, et `/web/login` uniquement lorsqu'il
   peut lire sa base de données, vérifiez donc les deux :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/health"   # expect 200
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"    # expect 200
   ```

   > Au premier démarrage, Odoo installe le module `base` dans une base de données flambant neuve, ce qui prend
   > plusieurs minutes. La sonde de démarrage est une vérification TCP sur le port 8069 (délai de 60 s, 3 × 30 s), et
   > la sonde de vivacité appelle `/web/health` après 120 s. Avec le scale-to-zero, la première requête
   > après une période d'inactivité subit également un démarrage à froid de 30 à 60 s — réessayez avant de poser un diagnostic.

2. **Confirmez le bon déroulement des jobs d'initialisation** — Odoo ne peut pas démarrer correctement sans eux :

   ```bash
   for J in nfs-init db-init; do
     gcloud run jobs executions list --job="$SERVICE-$J" --project="$PROJECT" --region="$REGION" \
       --limit=1 --format="table(name,status.conditions[0].type,status.conditions[0].status,status.succeededCount)"
   done
   ```

3. **Première connexion (premier lancement d'Odoo).** Vous ne créez pas de base de données manuellement sur ce module :
   la commande de démarrage lance Odoo avec `-i base` sur la base de données nommée dans `odoo.conf`
   (`DB_NAME`, qui correspond à `$SERVICE` avec les tirets convertis en traits de soulignement), la base de données est
   donc créée et initialisée dès le premier démarrage.
   - Ouvrez `$SERVICE_URL/web/login` dans un navigateur.
   - Connectez-vous en tant que **`admin`**. Une base de données initialisée en ligne de commande utilise le mot de passe administrateur
     par défaut intégré à Odoo, **`admin`**.
   - **Changez-le immédiatement** : avatar (en haut à droite) → **My Profile / Preferences** →
     **Account Security** → **Change Password**. Toute personne pouvant accéder à l'URL pourrait sinon se connecter
     en tant qu'administrateur — le Lab 5 (IAP) et le Lab 10 (WAF) expliquent comment restreindre cela.
   - Définissez ensuite le nom de l'entreprise, le fuseau horaire et la langue sous **Settings**, puis installez les applications
     dont vous avez besoin depuis **Apps**.

4. **Le gestionnaire de bases de données est désactivé — à dessein.** Le fichier généré `odoo.conf` définit
   `list_db = False`, de sorte que `$SERVICE_URL/web/database/manager` indique que le gestionnaire de bases de données
   a été désactivé. Cela bloque l'accès à la page qui permettrait de supprimer ou de dupliquer la base de données. Le
   **mot de passe maître** d'Odoo (`admin_passwd`) est toujours généré et conservé dans Secret Manager, et il est
   réécrit dans `odoo.conf` à chaque démarrage ; récupérez-le si vous en avez un jour besoin :

   ```bash
   MASTER_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~-master-password$" --format="value(name)" | grep -i odoo | head -1)
   gcloud secrets versions access latest --secret="$MASTER_SECRET" --project="$PROJECT"
   ```

5. **Consultez ce que la configuration de base a provisionné :**

   ```bash
   # Runtime: image, CPU/memory, scaling, probes, mounts, env (names only)
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
     | grep -E "image:|cpu:|memory:|minScale|maxScale|execution-environment|mountPath|tcpSocket|path: /web" 

   # Database and user on the shared instance
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --filter="databaseVersion~POSTGRES" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" | grep -i odoo
   gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" | grep -i odoo

   # NFS server VM and buckets
   gcloud compute instances list --project="$PROJECT" --filter="name~nfs"
   gcloud storage ls "gs://gcs-$SERVICE-addons/"
   ```

   Le service monte le partage NFS sur `/mnt` (le filestore, les sessions et `odoo.conf` s'y trouvent),
   le bucket `addons` sur `/mnt/extra-addons` via GCS Fuse (il se trouve sur le chemin des extensions d'Odoo), et
   le socket Cloud SQL sur `/cloudsql`.

---

## Partie 2 — Labs de fonctionnalités {#part-2--feature-labs}

Chaque lab part d'une configuration de base saine. Exécutez `curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"`
avant de commencer ; la commande doit renvoyer `200`.

---

### Lab 2 — Environnement de déploiement et isolation (Groupe 2) {#lab-2--deployment-environment--isolation-group-2}

> **Objectif :** router les alertes vers votre équipe, étiqueter chaque ressource pour le suivi des coûts et exécuter
> Odoo sous son propre compte de service au moindre privilège au sein d'un projet partagé.

**Vous allez :** ajouter des utilisateurs de support et des étiquettes · basculer l'identité d'exécution vers un compte de service
dédié · comprendre le fonctionnement du cloisonnement facultatif par refus IAM (IAM-deny fence) et pourquoi il nécessite un accès au niveau organisation.
**Durée :** 20–25 min · **Coût :** aucun · **Prérequis / configuration externe :** le cloisonnement nécessite
`roles/iam.denyAdmin` et `roles/resourcemanager.tagAdmin`, et `iam.denyAdmin` ne peut être
accordé qu'au niveau de l'**organisation** (ou du dossier) — un Project Owner seul ne peut pas l'activer.

#### Paramètres de ce groupe {#settings-in-this-group}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `support_users` | `[]` | Oui | Adresses e-mail autorisées à accéder au projet et ajoutées comme canaux de notification ; active également les règles d'alerte intégrées pour le CPU, la mémoire et les erreurs 5xx |
| `resource_labels` | `{}` | Oui | Étiquettes appliquées à chaque ressource créée par le module |
| `dedicated_service_account_id` | `""` | Non | Exécute Odoo (et ses jobs) avec ce compte réservé à l'application au lieu du compte partagé du tenant `cloudrun-sa-...` ; il n'obtient que les rôles réseau, client Cloud SQL et logging sur tout le projet, plus les secrets, buckets et jobs propres à cette application |
| `fence_enabled` | `false` | Non | Applique des tags aux secrets, buckets, services et jobs de cette application et ajoute une règle de refus IAM pour que seuls son propre compte et `fence_administrators` puissent y accéder. Nécessite `dedicated_service_account_id` |
| `fence_administrators` | `[]` | Non | Personnes qui conservent l'accès aux ressources cloisonnées (le déployeur et les administrateurs d'urgence) |

#### Étape 1 — Configurer {#step-1--configure}

```hcl
support_users                = ["<your-email>"]                     # alerts + project access
resource_labels              = { environment = "lab", team = "erp" } # lowercase keys/values
dedicated_service_account_id = "odoo-lab-sa"   # 6–30 chars: lowercase, digits, hyphens
fence_enabled                = false            # true only if you hold the org-level roles
fence_administrators         = ["<your-email>"] # used only when fence_enabled = true
```

#### Étape 2 — Appliquer {#step-2--apply}

Le résultat attendu inclut de nouvelles liaisons IAM et le compte dédié (créé lors de la première utilisation), des canaux de notification
et trois règles d'alerte, la mise à jour des étiquettes sur les ressources existantes, ainsi qu'une **nouvelle révision** (le
compte de service fait partie du modèle de révision). Environ 5 à 8 minutes.

#### Étape 3 — Vérifier {#step-3--verify}

```bash
# The revision runs as the dedicated account
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.serviceAccountName)"
# expect: odoo-lab-sa@<your-project-id>.iam.gserviceaccount.com

# Its project-level roles are the narrow set
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members~odoo-lab-sa@" --format="value(bindings.role)"
# expect roles such as cloudsql.client, compute.networkUser, logging.logWriter, vpcaccess.user

# Labels landed
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(metadata.labels)"
gcloud storage buckets describe "gs://gcs-$SERVICE-addons" --format="value(labels)"

# Alert channels and policies for this service
gcloud alpha monitoring policies list --project="$PROJECT" --format="value(displayName)" | grep "$SERVICE"

# Odoo still works under the new identity (secrets + DB + NFS all reachable)
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"   # expect 200
```

#### Pour aller plus loin {#explore-further}

- Comparez avec le compte partagé du tenant : listez les rôles de `cloudrun-sa-*` de la même façon. Le
  compte partagé a un accès à l'échelle du projet aux secrets de toutes les applications du tenant ; le compte dédié
  est limité aux secrets de cette application, il ne peut donc pas lire les identifiants d'une autre application.
- Lisez la stratégie IAM du secret pour voir l'autorisation accordée spécifiquement :
  `gcloud secrets get-iam-policy "$MASTER_SECRET" --project="$PROJECT"`.
- **Cloisonnement (survol informatif si vous n'avez pas les rôles de l'organisation).** Avec `fence_enabled = true`,
  le plan vérifie d'abord les autorisations de l'identité qui déploie ; s'il manque `iam.denyAdmin` ou `tagAdmin`, il
  **échoue dès l'étape du plan** avec un message précisant l'autorisation manquante, avant
  que quoi que ce soit ne soit créé. En cas de succès, vous verrez une clé de tag `fence-$SERVICE` associée aux
  ressources de l'application et une stratégie de refus (deny policy) qui bloque tous les comptes à l'exception du compte dédié et
  de `fence_administrators`.

#### Points d'attention {#watch-out-for}

- Modifier `dedicated_service_account_id` après coup réoriente chaque job et le service ; procédez-y
  durant une période d'inactivité. Supprimer cette valeur fait repasser Odoo sur le compte partagé.
- Le compte dédié et ses rôles sur le projet **sont supprimés lors du démantèlement (destroy)** (sa portée est limitée à l'application) ; le
  compte partagé du tenant ne l'est pas.
- Les entrées de `support_users` sont de véritables attributions IAM sur le projet, pas simplement des destinataires de messages.

#### Restauration {#revert}

```hcl
dedicated_service_account_id = ""
fence_enabled                = false
fence_administrators         = []
# keep support_users and resource_labels if you want alerts and labels for later labs
```

La réinitialisation du compte crée une nouvelle révision s'exécutant sous le compte partagé ; le compte
dédié est supprimé par le nouvel apply.

---

### Lab 3 — Identité de l'application et version (Groupe 3) {#lab-3--application-identity--version-group-3}

> **Objectif :** modifier ce que les opérateurs voient pour ce service et reconstruire Odoo sur un autre
> canal de distribution.

**Vous allez :** modifier le nom d'affichage et la description · basculer entre différents canaux de version d'Odoo et
observer Cloud Build générer une nouvelle image et une nouvelle révision.
**Durée :** 15–30 min (un changement de version reconstruit l'image) · **Coût :** aucun · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-1}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `application_name` | `odoo` | Oui (mais voir *Points d'attention*) | Base du nom de chaque ressource (`$SERVICE` = nom + tenant + hash). 1 à 20 caractères, commence par une lettre |
| `application_display_name` | `Odoo ERP` | Oui | Nom convivial affiché dans la plateforme et la console |
| `application_description` | `Odoo ERP on Cloud Run` | Oui | Description du service Cloud Run |
| `application_version` | `18.0` | Oui | Canal nightly d'Odoo intégré dans l'image (`18.0`, `17.0`, ...). `latest` construit la version 18.0 |

#### Étape 1 — Configurer {#step-1--configure-1}

```hcl
application_display_name = "Odoo ERP (Lab)"
application_description  = "Odoo on Cloud Run - feature lab instance"
application_version      = "18.0"   # leave as-is first; see Explore further for a channel change
```

#### Étape 2 — Appliquer {#step-2--apply-1}

Les modifications textuelles mettent à jour le service sur place. Un changement de version déclenche une compilation d'image par Cloud Build
(5 à 10 min) et génère une nouvelle révision. Comptez entre 3 et 15 minutes.

#### Étape 3 — Vérifier {#step-3--verify-1}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -iE "description|APP_VERSION" -A1
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[0].image)"
gcloud builds list --project="$PROJECT" --region="$REGION" --limit=3 \
  --format="table(id,status,createTime.date(),substitutions)"
```

Résultat attendu : la description reprend le nouveau texte, `APP_VERSION` correspond à `application_version`, et le
tag de l'image se termine par la version.

#### Pour aller plus loin {#explore-further-1}

- **Version d'Odoo dans l'interface :** connectez-vous, ouvrez **Settings** et faites défiler jusqu'en bas — la version
  du serveur s'y trouve. Elle doit correspondre au canal que vous avez compilé.
- Compilez une version nightly plus récente du même canal : l'image télécharge la dernière nightly du canal
  à chaque compilation, donc une nouvelle génération intègre les correctifs apportés à la version.

#### Points d'attention {#watch-out-for-1}

- **Le retour à une version antérieure (downgrade) n'est pas pris en charge par Odoo.** Migrer une base de données existante de 18.0 vers 17.0
  échouera ; une mise à niveau majeure (17.0 → 18.0) nécessite le processus de migration d'Odoo, ce que `-i base`
  n'effectue pas. Testez les changements de canal uniquement sur un déploiement de lab neuf.
- **Ne modifiez pas `application_name` sur un déploiement en cours d'exécution.** Bien que le formulaire le permette,
  tous les noms de l'application en découlent ; l'apply suivant créera donc un nouveau service, une nouvelle base de données,
  de nouveaux secrets et de nouveaux buckets, tout en supprimant les anciens.
- Un canal invalide fait échouer l'étape Cloud Build (le téléchargement du paquet nightly renvoie une erreur 404).

#### Restauration {#revert-1}

```hcl
application_display_name = "Odoo ERP"
application_description  = "Odoo ERP on Cloud Run"
application_version      = "18.0"
```

---

### Lab 4 — Runtime et mise à l'échelle (Groupe 4) {#lab-4--runtime--scaling-group-4}

> **Objectif :** dimensionner correctement Odoo, maintenir l'exécution de ses actions planifiées, éliminer les démarrages à froid,
> et déployer en toute sécurité avec la répartition de trafic.

**Vous allez :** augmenter le CPU/la mémoire · passer au CPU toujours alloué et à une instance préchauffée (warm instance) · autoriser une
seconde instance · étiqueter et répartir le trafic entre les révisions · observer quels champs d'exécution sont actifs.
**Durée :** 30–40 min · **Coût :** oui — `min_instance_count = 1` avec du CPU alloué en continu facture
une instance en permanence (environ 40 $ US supplémentaires par mois pour 1 vCPU) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-2}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `deploy_application` | `true` | Non | `false` provisionne tout à l'exception du service Cloud Run |
| `container_image_source` | `custom` | Oui | `custom` compile Odoo depuis le Dockerfile du module ; `prebuilt` déploie `container_image` en l'état |
| `container_image` | `""` | Oui | URI de l'image pour `prebuilt` |
| `enable_image_mirroring` | `true` | Oui | Copier l'image dans Artifact Registry avant de déployer |
| `cpu_limit` | `1000m` | Oui | vCPU par instance (remplace `container_resources`) |
| `memory_limit` | `2Gi` | Oui | Mémoire par instance (remplace `container_resources`) ; doit rester supérieure à la limite stricte de 1536 Mo d'Odoo |
| `container_resources` | `null` | Oui | Format objet du CPU/mémoire (`cpu_limit`, `memory_limit`, requêtes facultatives) |
| `min_instance_count` | `0` | Oui | Instances préchauffées (warm) (0 = scale-to-zero) |
| `max_instance_count` | `1` | Oui | Plafond d'instances ; doit être ≥ min |
| `cpu_always_allocated` | `false` | Oui | `true` = CPU alloué tant qu'une instance existe (facturation basée sur l'instance) |
| `container_port` | `8069` | Oui | Port d'écoute d'Odoo — laisser à 8069 |
| `container_protocol` | `http1` | Oui | `http1` ou `h2c` |
| `execution_environment` | `gen2` | Oui | Doit rester à `gen2` (nécessaire pour NFS et GCS Fuse ; le plan rejette `gen1` avec NFS) |
| `timeout_seconds` | `300` | Oui | Délai d'expiration par requête (0–3600) |
| `enable_cloudsql_volume` | `true` | Oui | Monte le socket Cloud SQL ; Odoo s'y connecte via ce socket |
| `cloudsql_volume_mount_path` | `/cloudsql` | Oui | Fixé à `/cloudsql` par la configuration Odoo — ce champ n'a aucun effet ici |
| `traffic_split` | `[]` | Oui | Pourcentage de répartition entre révisions ; le total des entrées doit valoir 100 |
| `service_annotations` | `{}` | Oui | Annotations supplémentaires sur le service |
| `service_labels` | `{}` | Oui | Étiquettes supplémentaires sur le service |

#### Étape 1 — Configurer {#step-1--configure-2}

```hcl
cpu_limit            = "2000m"   # 2 vCPU: faster module installs and reports
memory_limit         = "4Gi"     # headroom above Odoo's 1.5 GiB per-worker hard limit
cpu_always_allocated = true      # Odoo's in-process cron (2 threads) needs CPU between requests
min_instance_count   = 1         # no cold starts; scheduled actions keep running
max_instance_count   = 2         # a second instance during bursts or rollouts
timeout_seconds      = 600       # long reports and imports
service_labels       = { tier = "erp" }
service_annotations  = { "lab/owner" = "<your-email>" }
```

#### Étape 2 — Appliquer {#step-2--apply-2}

Le service est mis à jour sur place avec la génération d'**une nouvelle révision**. Comptez environ 3 à 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-2}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "cpu:|memory:|minScale|maxScale|cpu-throttling|timeoutSeconds|tier:|lab/owner"
```

Résultat attendu : `cpu: 2000m` (ou `'2'`), `memory: 4Gi`, `minScale: '1'`, `maxScale: '2'`,
`cpu-throttling: 'false'` (alloué en permanence), `timeoutSeconds: 600`, ainsi que votre étiquette et
votre annotation. Vérifiez ensuite qu'une instance reste active : attendez 20 minutes sans envoyer de trafic et mesurez le temps de réponse d'une requête —
elle doit répondre en bien moins d'une seconde, sans temps de démarrage à froid.

```bash
time curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"
```

#### Pour aller plus loin {#explore-further-2}

- **Répartition du trafic / déploiement canari.** Listez les révisions, puis envoyez 10 % du trafic vers la plus récente tout en conservant 90 % sur
  la précédente, avec un tag stable pour chacune :

  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION" --limit=2
  ```

  ```hcl
  traffic_split = [
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent = 10, tag = "canary" },
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision = "<previous-revision-name>", percent = 90, tag = "stable" },
  ]
  ```

  Vérifiez avec `gcloud run services describe "$SERVICE" ... --format="yaml(status.traffic)"` ;
  chaque tag reçoit sa propre URL (`https://canary---...run.app`). Des entrées dont le total ne fait pas 100, ou une
  entrée REVISION sans `revision`, font échouer le plan.
- **CPU alloué par requête avec une instance préchauffée.** Définissez `cpu_always_allocated = false` mais conservez
  `min_instance_count = 1` : l'instance reste active, mais le CPU est bridé entre les requêtes, ce qui ralentit
  ou bloque les actions planifiées d'Odoo (récupération des e-mails, factures récurrentes). Vérifiez
  **Settings → Technical → Scheduled Actions** pour voir la date de *Last run* de chaque action.
- Testez `min_instance_count = 3` avec `max_instance_count = 2` pour observer la validation au moment du plan.

#### Points d'attention {#watch-out-for-2}

- Une valeur de `memory_limit` inférieure à environ 2 Gio empêche le `limit_memory_hard` propre à Odoo (1536 Mo) de
  se déclencher avant que Cloud Run n'arrête le conteneur ; maintenez l'invariant `soft < hard < container cap`.
- `container_port` doit rester à 8069 — Odoo est configuré pour écouter sur ce port.
- `execution_environment = "gen1"` est refusé dès l'étape du plan lorsque NFS est activé.
- `min_instance_count = 1` est ce qui rend possible le test de disponibilité dans le Lab 14 ; le ramener à 0
  supprime ce test de disponibilité.
- Avant de faire passer `max_instance_count` au-delà de 1, consultez le Lab 21 et prenez une décision concernant Redis ; les
  recommandations du module associent l'utilisation de plusieurs instances à Redis.

#### Restauration {#revert-2}

```hcl
cpu_limit            = "1000m"
memory_limit         = "2Gi"
cpu_always_allocated = false
min_instance_count   = 0
max_instance_count   = 1
timeout_seconds      = 300
traffic_split        = []
service_labels       = {}
service_annotations  = {}
```

La restauration génère une nouvelle révision et met fin à la facturation de l'instance permanente.

---

### Lab 5 — Entrée (Ingress), VPC et IAP (Groupe 5) {#lab-5--ingress-vpc--iap-group-5}

> **Objectif :** contrôler les réseaux pouvant accéder à l'URL `run.app` d'Odoo et exiger une authentification Google
> avant que quiconque n'accède à la page de connexion d'Odoo.

**Vous allez :** restreindre le trafic entrant (ingress) et observer le code 404 spécifique · choisir un mode de sortie (egress) · découvrir (ou
appliquer) IAP et examiner les garde-fous validés au niveau du plan.
**Durée :** 15 min (ingress/egress) ; +15 min pour IAP · **Coût :** aucun · **Prérequis / configuration
externe :** IAP nécessite un **écran de consentement OAuth (marque OAuth)** dans le projet, créé depuis la
console Cloud (APIs & Services → OAuth consent screen) — gcloud ne permet plus d'en créer sur les nouveaux
projets. Une marque ne peut pas être supprimée une fois créée.

#### Paramètres de ce groupe {#settings-in-this-group-3}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `ingress_settings` | `all` | Oui | `all`, `internal`, ou `internal-and-cloud-load-balancing` (crée également un équilibreur de charge — voir Lab 10) |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Oui | Router uniquement le trafic RFC 1918 à travers le VPC (`PRIVATE_RANGES_ONLY`) ou l'ensemble du trafic (`ALL_TRAFFIC`, via Cloud NAT) |
| `enable_iap` | `false` | Non | IAP natif de Cloud Run : authentification Google devant le service |
| `iap_authorized_users` | `[]` | Oui | Membres `user:` / `serviceAccount:` autorisés par IAP |
| `iap_authorized_groups` | `[]` | Oui | Membres `group:` autorisés par IAP |

#### Étape 1 — Configurer {#step-1--configure-3}

Commencez par le trafic entrant (sans configuration externe) :

```hcl
ingress_settings   = "internal"           # only VPC / Google-internal callers
vpc_egress_setting = "PRIVATE_RANGES_ONLY"
```

#### Étape 2 — Appliquer {#step-2--apply-3}

Mise à jour sur place, environ 2 minutes. Aucun changement sur la base de données ou le stockage.

#### Étape 3 — Vérifier {#step-3--verify-3}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(metadata.annotations['run.googleapis.com/ingress'])"   # expect internal
curl -s "$SERVICE_URL/web/login" | grep -o "<title>[^<]*</title>"
# expect: <title>404 Page not found</title>  (the internal-ingress rejection)
```

Rétablissez ensuite `ingress_settings = "all"` et confirmez que `/web/login` renvoie un code 200.

#### Pour aller plus loin {#explore-further-3}

- **IAP** (nécessite l'écran de consentement) :

  ```hcl
  enable_iap            = true
  iap_authorized_users  = ["user:<your-email>"]
  iap_authorized_groups = []
  ```

  Vérification : un appel `curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"` non authentifié
  renvoie désormais un code **403**, tandis qu'un navigateur connecté avec un utilisateur autorisé atteint la mire de connexion d'Odoo.
  `gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION"` indique
  l'agent de service IAP comme invoker et aucun `allUsers`.
- **Garde-fous sans marque :** configurez `enable_iap = true` sans utilisateurs, ou dans un projet dépourvu
  d'écran de consentement. Le plan échoue avant toute modification. Ce comportement est volontaire : activer IAP
  supprime l'accès public au cours du même apply, donc un échec ultérieur rendrait Odoo totalement inaccessible.
- `vpc_egress_setting = "ALL_TRAFFIC"` achemine les requêtes sortantes d'Odoo (SMTP, prestataires de paiement)
  par Cloud NAT. Vérifiez que le service renvoie toujours un code 200.

#### Points d'attention {#watch-out-for-3}

- Les trois codes 404 se ressemblent mais ont des causes distinctes : `404 Page not found` = trafic entrant interne ;
  la page `Error 404 (Not Found)!!1` de Google = droits d'appel (invoker) manquants ; la page 404 propre à Odoo =
  chemin d'accès incorrect.
- IAP et Cloud CDN s'excluent mutuellement — ne combinez pas IAP avec le `enable_cdn` du Lab 10.
- IAP ajoute une authentification en amont d'Odoo ; Odoo demande toujours ses propres identifiants en arrière-plan.

#### Restauration {#revert-3}

```hcl
ingress_settings      = "all"
vpc_egress_setting    = "PRIVATE_RANGES_ONLY"
enable_iap            = false
iap_authorized_users  = []
iap_authorized_groups = []
```

Désactiver IAP rétablit la liaison publique de l'invoker.

---

### Lab 6 — Variables d'environnement et secrets (Groupe 6) {#lab-6--environment-variables--secrets-group-6}

> **Objectif :** transmettre la configuration et les identifiants à Odoo en toute sécurité, et observer comment le module
> empêche les valeurs ressemblant à des identifiants d'apparaître en clair.

**Vous allez :** ajouter des variables d'environnement en texte brut · référencer un secret existant dans Secret Manager · observer la conversion
automatique d'une variable nommée comme un identifiant vers un secret.
**Durée :** 20 min · **Coût :** négligeable (un ou deux secrets) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-4}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `environment_variables` | `{}` | Oui | Variables d'environnement en texte brut sur le service (fusionnées avec celles du module) |
| `secret_environment_variables` | `{}` | Oui | Nom de la variable d'environnement → nom du secret dans Secret Manager, résolu au démarrage de l'instance |
| `protect_sensitive_environment_variables` | `true` | Oui | Déplace les éléments non vides de `environment_variables` dont le NOM ressemble à un identifiant (`*PASSWORD`, `*SECRET`, `*TOKEN`, `*API_KEY`, ...) vers Secret Manager et les injecte sous forme de références à des secrets. Masqué dans les projets gérés par RAD |
| `secret_rotation_period` | `2592000s` | Oui | Période de notification pour la rotation des secrets du module ; pilote la rotation automatique du Lab 12 |
| `secret_propagation_delay` | `30` | Oui | Secondes d'attente après la création/mise à jour de secrets avant d'exécuter les étapes dépendantes |
| `explicit_secret_values` | `{}` | Oui | Clés de `secret_environment_variables` dont les secrets sont créés dans le même apply, afin d'ignorer la vérification d'existence au moment du plan. N'écrit pas de valeurs directement dans Secret Manager |

#### Étape 1 — Configurer {#step-1--configure-4}

Créez le secret que vous allez référencer (ancré dans votre région, ce qui est requis dans les projets gérés par RAD) :

```bash
printf 'lab-secret-value' | gcloud secrets create odoo-lab-marker --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

```hcl
environment_variables = {
  TZ                = "UTC"
  ODOO_LAB_MARKER   = "group-6"
  SMTP_PASSWORD     = "not-a-real-password"   # credential-named: will be moved to Secret Manager
}
secret_environment_variables            = { ODOO_LAB_SECRET = "odoo-lab-marker" }
protect_sensitive_environment_variables = true
secret_propagation_delay                = 60
```

#### Étape 2 — Appliquer {#step-2--apply-4}

Le résultat attendu comprend un nouveau secret (pour `SMTP_PASSWORD`), les autorisations IAM sur les secrets et une nouvelle révision.
Comptez environ 3 à 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-4}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "name: (TZ|ODOO_LAB_MARKER|ODOO_LAB_SECRET|SMTP_PASSWORD)" -A4
gcloud secrets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE-env-smtp-password"
```

Résultat attendu : `TZ` et `ODOO_LAB_MARKER` possèdent des lignes `value:` en clair ; `ODOO_LAB_SECRET` et
`SMTP_PASSWORD` possèdent des blocs `secretKeyRef` (aucun texte en clair) ; un secret nommé
`secret-$SERVICE-env-smtp-password-...` existe.

#### Pour aller plus loin {#explore-further-4}

- Définissez `protect_sensitive_environment_variables = false` et réappliquez : `SMTP_PASSWORD` apparaît
  désormais en clair pour toute personne ayant un accès en lecture au service — raison pour laquelle la valeur par défaut est `true`.
- Référencez un secret qui n'existe pas : le plan affiche un avertissement indiquant son nom (sans échouer),
  puis la révision ne démarre pas car le secret ne peut être résolu.
- **Courrier sortant.** Le serveur d'envoi de courrier d'Odoo se configure dans l'interface (**Settings → Technical
  → Outgoing Mail Servers**) ; conservez le mot de passe dans Secret Manager plutôt que dans des variables d'environnement en clair.

#### Points d'attention {#watch-out-for-4}

- Les secrets sont lus au démarrage d'une instance. L'ajout d'une nouvelle version d'un secret référencé ne parvient
  à Odoo qu'à la prochaine révision ou lors du redémarrage de l'instance.
- Dans un projet géré par RAD, les secrets doivent être restreints à la région de déploiement ; un secret avec
  une réplication automatique (globale) est rejeté par la stratégie de localisation.

#### Restauration {#revert-4}

```hcl
environment_variables                   = {}
secret_environment_variables            = {}
protect_sensitive_environment_variables = true
secret_propagation_delay                = 30
```

Supprimez ensuite le secret que vous avez créé : `gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet`.

---

### Lab 7 — Sauvegarde et maintenance (Groupe 7) {#lab-7--backup--maintenance-group-7}

> **Objectif :** planifier des sauvegardes qui capturent à la fois la base de données et le filestore d'Odoo, en exécuter une
> à la demande, et comprendre la procédure de restauration.

**Vous allez :** modifier la fréquence et la rétention · déclencher une sauvegarde immédiatement et inspecter l'archive ·
découvrir (ou exécuter) l'import d'une base de données.
**Durée :** 20–30 min · **Coût :** faible (stockage des sauvegardes) · **Prérequis / configuration externe :**
l'import nécessite un fichier de sauvegarde préalablement déposé et **écrase la base de données en production**.

#### Paramètres de ce groupe {#settings-in-this-group-5}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `backup_schedule` | `0 2 * * *` | Oui | Cron (UTC) pour le job `$SERVICE-db-export` ; vide désactive les sauvegardes planifiées |
| `backup_retention_days` | `7` | Oui | Règle de cycle de vie sur le bucket de sauvegarde supprimant les sauvegardes plus anciennes |
| `enable_backup_import` | `false` | Non | Exécute un job d'importation ponctuel pendant l'apply |
| `backup_source` | `gcs` | Non | `gcs` (le bucket de sauvegarde du déploiement) ou `gdrive` (un ID de fichier Google Drive) |
| `backup_file` | `backup.sql` | Non | Nom simple du fichier dans le bucket de sauvegarde, ou identifiant de fichier Drive |
| `backup_format` | `sql` | Oui | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip` ou `auto` (`auto` interdit avec `gdrive`) |

#### Étape 1 — Configurer {#step-1--configure-5}

```hcl
backup_schedule       = "30 3 * * *"   # 03:30 UTC daily
backup_retention_days = 14             # raise to 90+ for financial records
enable_backup_import  = false          # see Explore further
```

#### Étape 2 — Appliquer {#step-2--apply-5}

Met à jour sur place le job Cloud Scheduler et la règle de cycle de vie du bucket ; environ 2 minutes.

#### Étape 3 — Vérifier {#step-3--verify-5}

```bash
gcloud scheduler jobs describe "$SERVICE-backup-schedule" --location="$REGION" --project="$PROJECT" \
  --format="value(schedule,timeZone)"                      # expect 30 3 * * *  UTC
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format="yaml(lifecycle_config)"
# expect a Delete rule with age: 14

# Run a backup now and inspect the result
gcloud run jobs execute "$SERVICE-db-export" --project="$PROJECT" --region="$REGION" --wait
gcloud storage ls -l "gs://gcs-$SERVICE-backups/backups/"
```

L'archive contient `database.sql` et une copie `nfs_files/` du partage NFS, c'est-à-dire le
filestore d'Odoo et `odoo.conf` — les deux éléments nécessaires à la restauration d'Odoo.

#### Pour aller plus loin {#explore-further-5}

- **Déroulement d'une restauration (import).** Pour tester sans dépendre de fichiers externes, téléchargez l'archive que
  vous venez de créer, extrayez `database.sql`, et déposez-le à la racine du bucket de sauvegarde :

  ```bash
  gcloud storage cp "gs://gcs-$SERVICE-backups/backups/<archive-name>" .
  tar -xzf <archive-name>        # look for database.sql inside
  gcloud storage cp database.sql "gs://gcs-$SERVICE-backups/odoo-backup.sql"
  ```

  ```hcl
  enable_backup_import = true
  backup_source        = "gcs"
  backup_file          = "odoo-backup.sql"   # bare filename; the module builds the gs:// URI
  backup_format        = "sql"
  ```

  L'apply exécute `$SERVICE-backup-import` et échoue explicitement si l'import échoue. Étant donné qu'il écrit
  dans la base de données **active**, effectuez cela uniquement sur un déploiement de lab, puis remettez
  `enable_backup_import = false`. Rappelez-vous que les pièces jointes d'Odoo se trouvent dans le filestore, pas
  dans la base de données — une restauration de la base de données seule nécessite le `nfs_files/filestore` correspondant.
- Importation Google Drive : `backup_source = "gdrive"`, `backup_file` = l'identifiant du fichier Drive, avec un
  format parmi `sql`, `tar` ou `zip`.

#### Points d'attention {#watch-out-for-5}

- Un bucket de sauvegarde réside à l'intérieur du déploiement et est détruit en même temps ; copiez tout ce que vous désirez
  garder ailleurs avant la tâche 6.
- Si un import échoue avec `password authentication failed`, le mot de passe de la base de données et le secret
  ont dérivé (voir Lab 12) ; une ligne `pg_hba ... no encryption` située dessous correspond à une tentative non-SSL de psql,
  non à un incident TLS.

#### Restauration {#revert-5}

```hcl
backup_schedule       = "0 2 * * *"
backup_retention_days = 7
enable_backup_import  = false
backup_file           = "backup.sql"
```

Supprimez le dump préparé : `gcloud storage rm "gs://gcs-$SERVICE-backups/odoo-backup.sql"`.

---

### Lab 8 — CI/CD et Binary Authorization (Groupe 8) {#lab-8--cicd--binary-authorization-group-8}

> **Objectif :** exiger des images attestées pour Odoo, et comprendre la configuration d'un pipeline push-to-deploy
> et d'une promotion par étapes.

**Vous allez :** activer Binary Authorization et vérifier sa présence sur le service · explorer les paramètres
du déclencheur GitHub et du pipeline Cloud Deploy.
**Durée :** 15 min (Binary Authorization) ; +30 min avec un dépôt GitHub · **Coût :** faible
(clé de signature KMS) · **Prérequis / configuration externe :** le CI/CD nécessite un dépôt GitHub ainsi qu'un
jeton d'accès personnel ou l'identifiant d'installation de la GitHub App Cloud Build.

#### Paramètres de ce groupe {#settings-in-this-group-6}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Oui | Déclencheur Cloud Build : compile et déploie à chaque push |
| `github_repository_url` | `""` | Oui | URL HTTPS du dépôt (requise avec le déclencheur) |
| `github_token` | `""` | Oui | Jeton d'accès personnel (sensible) ; ou utilisez l'installation de l'application |
| `github_app_installation_id` | `""` | Oui | Identifiant d'installation de la GitHub App Cloud Build |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Oui | Filtres de branches/fichiers, nom du déclencheur, substitutions |
| `enable_cloud_deploy` | `false` | Oui | Router les déploiements via un pipeline Cloud Deploy (nécessite le déclencheur) |
| `cloud_deploy_stages` | dev → staging → prod (approbation pour prod) | Oui | Étapes de promotion ; chacune dispose de son propre service |
| `enable_binary_authorization` | `false` | Non | Appliquer la stratégie Binary Authorization du projet sur le service |

#### Étape 1 — Configurer {#step-1--configure-6}

```hcl
enable_binary_authorization = true
enable_cicd_trigger         = false   # set true only with a repository and credential
enable_cloud_deploy         = false
```

#### Étape 2 — Appliquer {#step-2--apply-6}

Le résultat attendu comprend une dizaine de nouvelles ressources (clé de signature et IAM pour l'attestation Cloud Build) et une nouvelle
révision. Comptez environ 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-6}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -i "binary-authorization"            # expect run.googleapis.com/binary-authorization: default
gcloud container binauthz policy export --project="$PROJECT" | grep -i evaluationMode
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"   # still 200
```

La stratégie du projet reste calée sur son mode d'évaluation configuré (`ALWAYS_ALLOW` à moins que Services_GCP
n'ait défini autre chose), de sorte que le service continue de fonctionner avec le point de contrôle actif.

#### Pour aller plus loin {#explore-further-6}

- **CI/CD (configuration externe).** Avec un dépôt contenant le contexte de build d'Odoo :

  ```hcl
  enable_cicd_trigger   = true
  github_repository_url = "https://github.com/<you>/<odoo-repo>"
  github_token          = "<token>"            # or github_app_installation_id = "<id>"
  cicd_trigger_config   = { branch_pattern = "^main$", included_files = ["addons/**"] }
  ```

  Vérifiez avec `gcloud builds triggers list --project="$PROJECT" --region="$REGION"`, poussez un
  commit et observez `gcloud builds list` générer un build et une nouvelle révision.
- **Cloud Deploy** (`enable_cloud_deploy = true`, nécessite le déclencheur) crée
  les services `$SERVICE-dev`, `-staging` et `-prod`, chacun doté de sa propre base de données ; promouvez avec
  `gcloud deploy releases promote`. L'activer sans le déclencheur fait échouer le plan.

#### Points d'attention {#watch-out-for-6}

- `enable_binary_authorization` n'est pas modifiable à chaud (not update-safe) ; changer sa valeur recrée la révision.
- Un jeton GitHub est enregistré dans Secret Manager ; privilégiez l'installation d'application pour les dépôts d'organisation.

#### Restauration {#revert-6}

```hcl
enable_binary_authorization = false
enable_cicd_trigger         = false
enable_cloud_deploy         = false
github_token                = ""
```

---

### Lab 9 — Scripts SQL personnalisés (Groupe 9) {#lab-9--custom-sql-scripts-group-9}

> **Objectif :** exécuter votre propre code SQL sur la base de données d'Odoo de manière contrôlée et ordonnée dans le cadre
> d'un déploiement.

**Vous allez :** déposer deux scripts interdépendants dans un bucket · les exécuter en tant qu'utilisateur de l'application ou
en tant que root · vérifier qu'ils se sont exécutés dans l'ordre lexicographique.
**Durée :** 20 min · **Coût :** négligeable · **Prérequis :** un bucket créé par vos soins (ci-dessous).

#### Paramètres de ce groupe {#settings-in-this-group-7}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | Non | Exécute chaque fichier `.sql` sous le chemin, par ordre lexicographique, via `$SERVICE-custom-sql` |
| `custom_sql_scripts_bucket` | `""` | Oui | Nom du bucket (sans `gs://`) ; requis si activé |
| `custom_sql_scripts_path` | `""` | Oui | Préfixe dans le bucket ; requis si activé (un chemin vide ne trouverait rien) |
| `custom_sql_scripts_use_root` | `false` | Oui | Exécuter en tant qu'utilisateur root de l'instance plutôt qu'utilisateur applicatif |

#### Étape 1 — Configurer {#step-1--configure-7}

Déposez les scripts (le second dépendant du premier, un mauvais ordre provoquera une erreur immédiate) :

```bash
BUCKET="odoo-lab-sql-$PROJECT"
gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
cat > 01-create.sql <<'EOF'
CREATE TABLE IF NOT EXISTS lab_sql_order (id serial PRIMARY KEY, note text, at timestamptz DEFAULT now());
EOF
cat > 02-insert.sql <<'EOF'
INSERT INTO lab_sql_order (note) VALUES ('custom SQL ran after 01-create');
EOF
gcloud storage cp 01-create.sql 02-insert.sql "gs://$BUCKET/sql/"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "odoo-lab-sql-<your-project-id>"
custom_sql_scripts_path     = "sql"
custom_sql_scripts_use_root = false   # the app user owns Odoo's database, which is enough here
```

#### Étape 2 — Appliquer {#step-2--apply-7}

Crée le job `$SERVICE-custom-sql` (ainsi que les droits de lecture sur votre bucket si un compte de service
dédié a été configuré au Lab 2), puis l'exécute. Comptez environ 3 à 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-7}

```bash
gcloud run jobs executions list --job="$SERVICE-custom-sql" --project="$PROJECT" --region="$REGION" --limit=1
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-custom-sql\"" \
  --project="$PROJECT" --limit=50 --format="value(textPayload)" | grep -E "Found|\.sql|CREATE|INSERT"
```

Résultat attendu : `Found 2 SQL script(s)`, puis `01-create.sql` → `CREATE TABLE` et `02-insert.sql` →
`INSERT 0 1`. Pour inspecter la ligne vous-même, connectez-vous comme indiqué à l'étape 5 de la tâche 3 et lancez
`SELECT * FROM lab_sql_order;`.

#### Pour aller plus loin {#explore-further-7}

- Ajoutez `03-fail.sql` contenant une erreur de syntaxe et appliquez à nouveau : le job échoue et l'apply le signale.
- Définissez `custom_sql_scripts_use_root = true` pour les instructions nécessitant des privilèges élevés (extensions,
  rôles). Privilégiez sinon l'utilisateur applicatif.

#### Points d'attention {#watch-out-for-7}

- Ne créez jamais de tables entrant en collision avec celles d'Odoo (`res_*`, `ir_*`, ...). Odoo gère son propre
  schéma ; utilisez le SQL personnalisé pour des vues de reporting ou des ajustements de données bien identifiés.
- Le bucket vous appartient ; il n'est pas supprimé lors du démantèlement du module.

#### Restauration {#revert-7}

```hcl
enable_custom_sql_scripts   = false
custom_sql_scripts_bucket   = ""
custom_sql_scripts_path     = ""
custom_sql_scripts_use_root = false
```

Supprimez la table si vous le souhaitez (`DROP TABLE lab_sql_order;`) et supprimez le bucket :
`gcloud storage rm -r "gs://$BUCKET"`.

---

### Lab 10 — Cloud Armor, domaines et Artifact Registry (Groupe 10) {#lab-10--cloud-armor-domains--artifact-registry-group-10}

> **Objectif :** placer Odoo derrière un équilibreur de charge HTTPS global doté d'un pare-feu applicatif web (WAF),
> d'un CDN optionnel et d'un nom d'hôte avec certificat géré.

**Vous allez :** activer Cloud Armor (ce qui configure l'équilibreur de charge et modifie le trafic entrant) · accéder à
Odoo via un nom d'hôte automatique en `nip.io` · vérifier le blocage de tests XSS et d'injections SQL · activer
le CDN.
**Durée :** 30–45 min (l'approvisionnement du certificat prend le plus de temps) · **Coût :** oui — une règle de transfert
globale, une IP statique et une stratégie Cloud Armor sont facturées tant qu'elles existent · **Prérequis / configuration
externe :** aucun pour `nip.io` ; un domaine personnalisé requiert une zone DNS sous votre contrôle.

#### Paramètres de ce groupe {#settings-in-this-group-8}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `enable_cloud_armor` | `false` | Non | Crée la règle WAF et un équilibreur de charge HTTPS global (NEG serverless → service) et définit l'entrée sur `internal-and-cloud-load-balancing` |
| `admin_ip_ranges` | `[]` | Oui | Plages CIDR admises par une règle d'autorisation prioritaire dans la stratégie |
| `application_domains` | `[]` | Oui | Noms d'hôte pour les certificats gérés par Google ; vide = `<ip-dashed>.nip.io` automatique |
| `enable_cdn` | `false` | Oui | Cloud CDN sur le backend ; nécessite `enable_cloud_armor = true` |
| `max_images_to_retain` | `7` | Oui | Plafond du nombre d'images pour un registre intégré (inline) |
| `delete_untagged_images` | `true` | Oui | Nettoyage des images sans tag pour un registre intégré (inline) |
| `image_retention_days` | `30` | Oui | Nettoyage basé sur l'âge pour un registre intégré (inline) |

Les trois réglages de rétention d'images ne concernent qu'un registre créé directement par ce déploiement. Dans un
projet doté de Services_GCP, l'Artifact Registry partagé et sa stratégie de nettoyage dépendent de
Services_GCP, ces valeurs sont donc acceptées mais sans effet.

#### Étape 1 — Configurer {#step-1--configure-8}

```hcl
enable_cloud_armor  = true
admin_ip_ranges     = ["203.0.113.0/24"]   # replace with your office/VPN range
application_domains = []                    # empty: use the automatic nip.io hostname
enable_cdn          = true                  # static assets cached at the edge
```

#### Étape 2 — Appliquer {#step-2--apply-8}

Le résultat attendu comprend environ 15 à 17 nouvelles ressources (stratégie de sécurité, NEG, service backend, mappage d'URL, IP globale,
certificat, proxy HTTPS, règles de transfert) ainsi qu'un changement de configuration de l'ingress du service. L'apply dure
de 5 à 10 minutes ; le certificat géré doit ensuite passer à l'état `ACTIVE`, ce qui peut réclamer
15 à 60 minutes de plus.

#### Étape 3 — Vérifier {#step-3--verify-8}

```bash
LB_IP=$(gcloud compute addresses describe "$SERVICE-lb-ip" --global --project="$PROJECT" --format="value(address)")
LB_HOST="$(echo "$LB_IP" | tr . -).nip.io"; echo "https://$LB_HOST"

# Policy exists and is ATTACHED to the backend (an unattached policy protects nothing)
gcloud compute backend-services describe "$SERVICE-backend" --global --project="$PROJECT" \
  --format="value(securityPolicy,enableCDN)"
gcloud compute security-policies describe "$SERVICE-waf-policy" --project="$PROJECT" \
  --format="table(rules[].priority,rules[].action,rules[].match.config.srcIpRanges)"

# Odoo through the load balancer (after the certificate is ACTIVE)
curl -s -o /dev/null -w "%{http_code}\n" "https://$LB_HOST/web/login"                      # 200
curl -s -o /dev/null -w "%{http_code}\n" "https://$LB_HOST/web/login?q=%3Cscript%3Ealert(1)%3C/script%3E"  # 403
curl -s -o /dev/null -w "%{http_code}\n" "https://$LB_HOST/web/login?id=1%27%20OR%20%271%27=%271"          # 403

# The run.app URL is now closed (ingress is LB-only)
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"                            # 404
```

Résultat attendu : `securityPolicy` pointe vers `$SERVICE-waf-policy`, `enableCDN` est `True`, les règles
englobent votre plage d'administration, les règles préconfigurées SQLi/XSS/LFI/RCE et un blocage basé sur le taux de requêtes, et les deux
URL d'évaluation renvoient **403**.

#### Pour aller plus loin {#explore-further-8}

- **Domaine personnalisé :** créez un enregistrement `A` pour `odoo.<your-domain>` pointant vers `LB_IP`, puis configurez
  `application_domains = ["odoo.<your-domain>"]`. Suivez l'état du certificat avec
  `gcloud certificate-manager certificates list --project="$PROJECT"` jusqu'à ce qu'il devienne `ACTIVE`.
- Le port HTTP 80 est redirigé vers HTTPS tout en préservant l'hôte :
  `curl -sI "http://$LB_HOST/web/login" | grep -i location`.
- Examinez les correspondances CDN avec `curl -sI "https://$LB_HOST/web/static/img/favicon.ico" | grep -i -E "age|cache"`
  lors de requêtes répétées.
- `enable_cdn = true` avec Cloud Armor inactif fait échouer le plan ; essayez-le pour constater le garde-fou.

#### Points d'attention {#watch-out-for-8}

- **Les règles WAF demandent environ 5 à 10 minutes pour se propager** après l'apply ; les tests peuvent retourner 200
  d'ici là. Patientez avant d'en déduire que la stratégie ne fonctionne pas.
- Odoo s'exécute avec `proxy_mode = True`, il génère donc ses liens à partir de l'hôte transféré — connectez-vous via
  le nom d'hôte de l'équilibreur de charge, et non via l'URL fermée `run.app`, une fois Cloud Armor activé.
- Le test de disponibilité (Lab 14) bascule sur le nom d'hôte de l'équilibreur de charge quand Cloud Armor est actif.
- Ne combinez pas CDN avec IAP (Lab 5).

#### Restauration {#revert-8}

```hcl
enable_cloud_armor  = false
enable_cdn          = false
admin_ip_ranges     = []
application_domains = []
```

La restauration supprime l'équilibreur de charge, la stratégie, le certificat ainsi que l'IP, et rétablit l'ingress sur votre
valeur de `ingress_settings` (`all`). Supprimez tout enregistrement DNS préalablement créé.

---

### Lab 11 — Cloud Storage et NFS (Groupe 11) {#lab-11--cloud-storage--nfs-group-11}

> **Objectif :** ajouter des buckets et des montages GCS Fuse sans corrompre le point de montage des extensions d'Odoo, et confirmer
> la durabilité du filestore d'Odoo.

**Vous allez :** ajouter un bucket et ajuster le bucket `addons` · ajouter un second montage GCS Fuse · réaliser un cycle
d'écriture-redémarrage-lecture sur le filestore.
**Durée :** 25 min · **Coût :** faible · **Prérequis / configuration externe :** les deux options CMEK
génèrent un trousseau de clés KMS et des clés ; elles n'ont pas été sollicitées lors du test de groupe.

#### Paramètres de ce groupe {#settings-in-this-group-9}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `create_cloud_storage` | `true` | Non | Crée les buckets (`addons` du module plus `storage_buckets`) |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Non | Vos buckets, nommés `gcs-$SERVICE-<suffix>` ; fusionnés par suffixe avec le bucket `addons` du module (votre valeur l'emporte). **Supprimer une entrée détruit le bucket correspondant** |
| `enable_nfs` | `true` | Non | Monter le partage NFS partagé — le filestore d'Odoo, ses sessions et `odoo.conf` y résident ; à maintenir actif |
| `nfs_mount_path` | `/mnt` | Oui | Point de montage ; la configuration d'Odoo attend `/mnt` — ne pas modifier |
| `nfs_instance_name` | `""` | Oui | Exploiter une VM NFS désignée plutôt que le mécanisme de découverte |
| `nfs_instance_base_name` | `app-nfs` | Oui | Nom de base pour une VM NFS intégrée (inline) (déploiements autonomes uniquement) |
| `gcs_volumes` | `[]` | Oui | Montages GCS Fuse. **Renseigner une entrée remplace le montage par défaut `addons` du module** à l'emplacement `/mnt/extra-addons`, il convient donc de le répéter |
| `manage_storage_kms_iam` | `false` | Non | Créer une clé CMEK de stockage et l'utiliser pour chiffrer les buckets |
| `enable_artifact_registry_cmek` | `false` | Non | Créer une clé CMEK pour Artifact Registry |

#### Étape 1 — Configurer {#step-1--configure-9}

```hcl
create_cloud_storage = true
storage_buckets = [
  { name_suffix = "data" },                                   # keep the default bucket
  { name_suffix = "addons", versioning_enabled = true },      # override the module's addons bucket
  { name_suffix = "media", storage_class = "STANDARD" },      # a new bucket for the extra mount
]
gcs_volumes = [
  # 1. Restate the module's default, or Odoo loses /mnt/extra-addons
  { name = "addons", mount_path = "/mnt/extra-addons", readonly = false,
    mount_options = ["implicit-dirs", "metadata-cache-ttl-secs=60"] },
  # 2. A new mount; bucket_name empty = derived from storage_buckets entry "media"
  { name = "media", bucket_name = "", mount_path = "/mnt/gcs-media", readonly = false },
]
```

#### Étape 2 — Appliquer {#step-2--apply-9}

Crée `gcs-$SERVICE-media`, active la gestion des versions sur `addons`, et déploie une nouvelle révision incluant le
volume additionnel. Comptez environ 3 à 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-9}

```bash
gcloud storage buckets list --project="$PROJECT" --format="table(name,versioning_enabled)" | grep "$SERVICE"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "bucketName|mountPath"
# expect gcs-$SERVICE-addons at /mnt/extra-addons, gcs-$SERVICE-media at /mnt/gcs-media,
# the NFS volume at /mnt, and /cloudsql
```

**Écriture-redémarrage-lecture sur le filestore.** Dans Odoo, ouvrez **Contacts**, créez une fiche et joignez
un petit fichier dans la zone d'échange (chatter). Forcez ensuite une nouvelle révision puis vérifiez sa présence :

```bash
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars=LAB_RESTART="$(date +%s)"
```

Rechargez le contact et téléchargez la pièce jointe : elle doit s'ouvrir sans anomalie. Les fichiers joints résident dans
`/mnt/filestore` sur NFS, et non dans le conteneur, de sorte qu'ils persistent après les révisions et le scale-to-zero. (La
prochaine opération **Update** retire la variable `LAB_RESTART` ; cela est sans incidence.)

#### Pour aller plus loin {#explore-further-9}

- Déposez un module Odoo personnalisé dans le bucket des extensions
  (`gcloud storage cp -r my_module "gs://gcs-$SERVICE-addons/"`), redémarrez selon la méthode ci-dessus, puis dans Odoo
  activez le mode développeur et rendez-vous dans **Apps → Update Apps List** — il apparaît car `/mnt/extra-addons`
  se trouve sur le chemin des extensions d'Odoo.
- `manage_storage_kms_iam = true` chiffre les buckets à l'aide d'une clé gérée par le client ; vérifiez-le avec
  `gcloud storage buckets describe "gs://gcs-$SERVICE-data" --format="value(default_kms_key)"`.

#### Points d'attention {#watch-out-for-9}

- Omettre `addons` dans `gcs_volumes` retire silencieusement `/mnt/extra-addons` de la révision ;
  les modules personnalisés cessent d'apparaître dans Odoo.
- Supprimer une entrée de `storage_buckets` (y compris la valeur par défaut `data`) détruit ce bucket ainsi que
  son contenu (`force_destroy` étant vrai par défaut).
- Ne désactivez pas `enable_nfs` et ne déplacez pas `nfs_mount_path` : le script d'initialisation écrit `odoo.conf`
  et le filestore sous `/mnt`, et sans ce partage, chaque fichier joint est perdu lors d'un redémarrage.

#### Restauration {#revert-9}

```hcl
storage_buckets = [{ name_suffix = "data" }]
gcs_volumes     = []
```

Cela supprime `gcs-$SERVICE-media` et ramène le montage des extensions aux valeurs d'origine du module (la gestion des versions
sur `addons` revient à désactivée).

---

### Lab 12 — Backend de base de données (Groupe 12) {#lab-12--database-backend-group-12}

> **Objectif :** renouveler automatiquement le mot de passe de base de données d'Odoo et confirmer que la rotation
> est prise en compte sans provoquer d'interruption.

**Vous allez :** activer le mécanisme de rotation · déclencher une rotation à la demande · appliquer une nouvelle
révision et vous assurer qu'Odoo aligne sa configuration · identifier les champs de base de données non modifiables.
**Durée :** 25–30 min · **Coût :** négligeable (un dispatcher scale-to-zero et un job) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-10}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Oui | Figé pour Odoo : la configuration Odoo impose PostgreSQL, ce champ ne change donc pas le moteur (il sert seulement aux contrôles du plan). Odoo ne fonctionne pas sous MySQL |
| `application_database_name` | `odoo` | Oui | Conservé par compatibilité et inopérant : le véritable nom de la base découle de `$SERVICE` |
| `application_database_user` | `odoo` | Oui | Conservé par compatibilité et inopérant : le véritable utilisateur découle de `$SERVICE` |
| `database_password_length` | `32` | Non | Longueur du mot de passe généré (16 à 64). Le modifier sur une instance en cours d'exécution renouvelle le mot de passe |
| `enable_auto_password_rotation` | `false` | Oui | Déploie un job de rotation (`$SERVICE-pw-rotator`) et un dispatcher, activés sur `secret_rotation_period` (Lab 6) |
| `rotation_propagation_delay_sec` | `90` | Oui | Secondes attendues par le système de rotation après l'écriture de la nouvelle version avant d'invalider l'ancienne |

#### Étape 1 — Configurer {#step-1--configure-10}

```hcl
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 120
# secret_rotation_period (Group 6) stays "2592000s" = every 30 days
```

#### Étape 2 — Appliquer {#step-2--apply-10}

Environ 15 à 20 nouvelles ressources : le job de rotation et son compte de service, un service de répartition
scale-to-zero (`$SERVICE-rot-dispatch`), un déclencheur Eventarc et le câblage Pub/Sub. Comptez environ 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-10}

```bash
gcloud run jobs describe "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --format="value(name)"
DB_SECRET=$(gcloud secrets list --project="$PROJECT" --format="value(name)" --filter="name~$SERVICE$" | head -1)
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT"        # note the current version

# Rotate now instead of waiting 30 days
gcloud run jobs execute "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --wait
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT"        # a new ENABLED version; the old one DISABLED
```

Le mécanisme de rotation ajuste le mot de passe Cloud SQL et crée une nouvelle version du secret ; il ne redémarre pas
Odoo pour autant. Une instance active conserve le mot de passe chargé à son lancement, initiez donc une nouvelle révision et contrôlez
qu'Odoo a bien réconcilié `odoo.conf` avec le nouveau secret :

```bash
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars=LAB_RESTART="$(date +%s)"
gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
  | grep -E "Reconciled database connection settings|password authentication failed"
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"     # expect 200
```

Résultat attendu : `Reconciled database connection settings in /mnt/odoo.conf.` et aucune
ligne `password authentication failed`.

#### Pour aller plus loin {#explore-further-10}

- Consultez le journal du rotator pour visualiser le détail des étapes séquencées (identifier la version courante → générer → mettre à jour
  Cloud SQL → consigner le secret → temporiser → désactiver l'ancienne version) :
  `gcloud logging read "resource.labels.job_name=\"$SERVICE-pw-rotator\"" --project="$PROJECT" --limit=30 --format="value(textPayload)"`.
- Constatez que `application_database_name` est inopérant : la base de données ciblée par Odoo est
  `gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" | grep -i odoo`, désignée
  d'après `$SERVICE` quelle que soit la valeur de ce champ.

#### Points d'attention {#watch-out-for-10}

- **`database_password_length` n'est pas modifiable à chaud (not update-safe).** Changer cette valeur génère un nouveau mot de passe et
  détruit l'ancienne version du secret. Avec Odoo, `db-init` s'exécute à chaque apply et redéfinit le mot de passe
  du rôle, garantissant l'alignement de la base de données ; l'instance en cours requiert toutefois une nouvelle révision (comme illustré plus haut).
  Si l'authentification échoue par la suite, réexécutez `gcloud run jobs execute "$SERVICE-db-init" ... --wait`.
- Après chaque rotation, déployez une nouvelle révision (ou laissez le scale-to-zero recycler l'instance) avant
  que les connexions de l'ancienne version ne soient à nouveau requises.
- Ne paramétrez jamais `database_type` sur MySQL ou `NONE` avec Odoo.

#### Restauration {#revert-10}

```hcl
enable_auto_password_rotation  = false
rotation_propagation_delay_sec = 90
```

Les ressources associées à la rotation sont retirées ; le mot de passe en cours reste inchangé.

---

### Lab 13 — Jobs et tâches planifiées (Groupe 13) {#lab-13--jobs--scheduled-tasks-group-13}

> **Objectif :** greffer vos propres jobs ponctuels et récurrents autour d'Odoo sans altérer les jobs
> indispensables du module : `nfs-init` et `db-init`.

**Vous allez :** redéclarer les jobs d'initialisation par défaut et chaîner un job après eux · créer un job nocturne
qui consigne la taille du filestore · exécuter le job planifié à la demande.
**Durée :** 25 min · **Coût :** faible · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-11}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `initialization_jobs` | `[]` | Oui | Jobs ponctuels (`$SERVICE-<name>`). Vide = `nfs-init` + `db-init` du module. **Toute saisie remplace ces valeurs par défaut**, pensez donc à les redéclarer |
| `cron_jobs` | `[]` | Oui | Jobs récurrents : un job Cloud Run `$SERVICE-<name>` déclenché via Cloud Scheduler `$SERVICE-<name>-trigger` (UTC) |

#### Étape 1 — Configurer {#step-1--configure-11}

```hcl
initialization_jobs = [
  { # restated default 1
    name = "nfs-init", description = "Initialize NFS directories with correct UID for Odoo"
    image = "alpine:3.19", mount_nfs = true, execute_on_apply = true
    command = ["/bin/sh", "-c"]
    args = ["mkdir -p /mnt/filestore /mnt/sessions /mnt/extra-addons && chown -R 101:101 /mnt/filestore /mnt/sessions /mnt/extra-addons && chmod -R 777 /mnt/filestore /mnt/sessions /mnt/extra-addons"]
    cpu_limit = "1000m", memory_limit = "512Mi"
  },
  { # restated default 2
    name = "db-init", description = "Create Odoo Database and User"
    image = "postgres:15-alpine", script_path = "../Odoo_Common/scripts/db-init.sh"
    depends_on_jobs = ["nfs-init"], execute_on_apply = true
    secret_env_vars = { DB_PASSWORD = "DB_PASSWORD", ROOT_PASSWORD = "ROOT_PASSWORD" }
    cpu_limit = "1000m", memory_limit = "512Mi", timeout_seconds = 600, max_retries = 1
  },
  { # your job, chained after db-init
    name = "lab-marker", description = "Write a marker to the NFS share"
    image = "alpine:3.19", mount_nfs = true, depends_on_jobs = ["db-init"], execute_on_apply = true
    command = ["/bin/sh", "-c"]
    args = ["date -u > /mnt/lab-marker.txt && echo 'lab init job ran' && cat /mnt/lab-marker.txt"]
    cpu_limit = "1000m", memory_limit = "512Mi"   # Cloud Run Jobs floor: 1 vCPU / 512Mi
  },
]
cron_jobs = [{
  name = "filestore-size", schedule = "17 3 * * *", image = "alpine:3.19"
  command = ["/bin/sh", "-c"], args = ["du -sh /mnt/filestore && ls /mnt/filestore"]
  mount_nfs = true, cpu_limit = "1000m", memory_limit = "512Mi"
}]
```

#### Étape 2 — Appliquer {#step-2--apply-11}

Génère `$SERVICE-lab-marker`, `$SERVICE-filestore-size` et le déclencheur du planificateur, puis exécute la
chaîne d'initialisation dans l'ordre imparti. Environ 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-11}

```bash
for J in nfs-init db-init lab-marker; do
  gcloud run jobs executions list --job="$SERVICE-$J" --project="$PROJECT" --region="$REGION" \
    --limit=1 --format="value(name,status.succeededCount,status.completionTime)"
done
gcloud logging read "resource.labels.job_name=\"$SERVICE-lab-marker\"" --project="$PROJECT" \
  --limit=10 --format="value(textPayload)"                       # "lab init job ran" + a timestamp

gcloud scheduler jobs describe "$SERVICE-filestore-size-trigger" --location="$REGION" --project="$PROJECT" \
  --format="value(schedule,state)"
gcloud scheduler jobs run "$SERVICE-filestore-size-trigger" --location="$REGION" --project="$PROJECT"
# after a minute:
gcloud logging read "resource.labels.job_name=\"$SERVICE-filestore-size\"" --project="$PROJECT" \
  --limit=10 --format="value(textPayload)"                       # the filestore size
```

Résultat attendu : chaque job d'initialisation a réussi selon la séquence (`lab-marker` se termine après `db-init`), le
planificateur affiche l'état `ENABLED` avec votre configuration cron, et l'exécution manuelle consigne la taille du filestore dans les logs.

#### Pour aller plus loin {#explore-further-11}

- Attribuez `paused = true` à l'entrée cron et appliquez de nouveau : le job planifié devient `PAUSED`.
- Attribuez `secret_env_vars` à un job pour lui injecter un secret, à l'image de `db-init`.

#### Points d'attention {#watch-out-for-11}

- Renseigner `initialization_jobs` uniquement avec votre job personnel **écarte `nfs-init` et `db-init`** : un
  déploiement vierge se retrouverait alors sans rôle de base de données et avec des droits NFS erronés. Redéclarez systématiquement les deux.
- Le paramètre `script_path` est relatif au répertoire du module, selon l'exemple fourni.
- Les jobs d'initialisation n'empruntent pas le point d'entrée du conteneur Odoo ; ce sont des conteneurs standards qui exécutent votre commande.
- Les jobs Cloud Run réclament au minimum 1 vCPU / 512Mi ; des valeurs inférieures sont rejetées.

#### Restauration {#revert-11}

```hcl
initialization_jobs = []
cron_jobs           = []
```

Les valeurs par défaut du module sont réappliquées ; vos jobs ainsi que le déclencheur sont détruits. Supprimez le marqueur si vous le
souhaitez en l'intégrant à une future tâche cron, ou laissez-le en place — son empreinte est de quelques octets seulement.

---

### Lab 14 — Observabilité et santé (Groupe 14) {#lab-14--observability--health-group-14}

> **Objectif :** adapter les sondes d'Odoo à son cycle d'amorçage, mettre en place un test de disponibilité envoyant des notifications, et créer
> une règle d'alerte métrique personnalisée.

**Vous allez :** analyser et ajuster les sondes opérationnelles · mettre en place un test de disponibilité sur `/web/health` ·
créer une alerte sur le volume de requêtes.
**Durée :** 20 min · **Coût :** faible (test de disponibilité ; requiert une instance permanente — voir
ci-après) · **Prérequis :** `min_instance_count >= 1` (Lab 4) pour le test de disponibilité, et
`support_users` (Lab 2) pour l'envoi de notifications.

#### Paramètres de ce groupe {#settings-in-this-group-12}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `startup_probe` | TCP, délai 60 s, période 30 s, 3 échecs | Oui | Sonde de démarrage active sur le port 8069 |
| `liveness_probe` | HTTP `/web/health`, délai 120 s, période 120 s, expiration 60 s, 3 échecs | Oui | Sonde de vivacité active |
| `startup_probe_config` | HTTP `/web/health`, délai 180 s | Oui | Non utilisé par ce module — la configuration d'Odoo exploite `startup_probe` |
| `health_check_config` | HTTP `/web/health`, délai 30 s | Oui | Non utilisé par ce module — la configuration d'Odoo exploite `liveness_probe` |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Non | Test de disponibilité Cloud Monitoring (créé uniquement si la ressource déployée a `min_instance_count >= 1`) |
| `alert_policies` | `[]` | Oui | Alertes métriques personnalisées adressées à `support_users` |

#### Étape 1 — Configurer {#step-1--configure-12}

```hcl
min_instance_count  = 1      # Group 4: a scale-to-zero service deliberately gets no uptime check
uptime_check_config = { enabled = true, path = "/web/health", check_interval = "60s", timeout = "10s" }
alert_policies = [{
  name               = "odoo-request-volume"
  metric_type        = "run.googleapis.com/request_count"
  comparison         = "COMPARISON_GT"
  threshold_value    = 10
  duration_seconds   = 300
  aggregation_period = "300s"
}]
liveness_probe = {
  enabled = true, type = "HTTP", path = "/web/health"
  initial_delay_seconds = 120, timeout_seconds = 60, period_seconds = 60, failure_threshold = 3
}
```

#### Étape 2 — Appliquer {#step-2--apply-12}

Configure le test de disponibilité, son alerte sur incident (lorsque `support_users` est défini) ainsi que votre règle d'alerte,
et prépare une nouvelle révision intégrant la modification de sonde. Comptez environ 3 à 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-12}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "startupProbe|livenessProbe|tcpSocket|httpGet|path:|periodSeconds|initialDelaySeconds"
gcloud monitoring uptime list-configs --project="$PROJECT" \
  --format="table(displayName,httpCheck.path,monitoredResource.labels.host,period)" | grep "$SERVICE"
gcloud alpha monitoring policies list --project="$PROJECT" --format="value(displayName,enabled)" | grep "$SERVICE"
```

Résultat attendu : la sonde de vivacité affiche `periodSeconds: 60` ; un test de disponibilité
`$SERVICE-uptime-check` sur `/web/health` ciblant l'hôte du service (ou l'adresse
de l'équilibreur si le Lab 10 est déployé) ; une stratégie `$SERVICE-odoo-request-volume`. Dans la console,
**Monitoring → Uptime checks** affiche le test validé depuis plusieurs régions en l'espace de quelques minutes.

#### Pour aller plus loin {#explore-further-12}

- Configurez `min_instance_count = 0` et appliquez : le test de disponibilité est supprimé. Cela est intentionnel — un
  test ciblant un service soumis au scale-to-zero le qualifierait d'indisponible pendant sa veille ou empêcherait sa mise en veille,
  engendrant une facturation d'instance permanente non souhaitée.
- Modifiez `startup_probe_config` et observez l'absence de modification sur la révision — confirmant ainsi quels champs
  sont réellement appliqués.

#### Points d'attention {#watch-out-for-12}

- Ne faites pas pointer de test de disponibilité vers `/healthz` : la couche frontale de Cloud Run prend en charge cette route elle-même,
  un test externe échouerait donc en continu alors même que le service fonctionne.
- Ne basculez pas la sonde de démarrage en HTTP avec une temporisation courte : lors du démarrage initial, Odoo procède à l'installation de
  `base`, rendant les réponses HTTP instables pendant plusieurs minutes.
- Pour `run.googleapis.com/request_latencies` (métrique de distribution), spécifiez
  `per_series_aligner = "ALIGN_PERCENTILE_99"` (ou un autre centile) dans les critères d'alerte.

#### Restauration {#revert-12}

```hcl
uptime_check_config = { enabled = false, path = "/" }
alert_policies      = []
liveness_probe = {
  enabled = true, type = "HTTP", path = "/web/health"
  initial_delay_seconds = 120, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3
}
min_instance_count  = 0      # only if you are not keeping Lab 4's warm instance
```

---

### Lab 21 — Cache Redis (Groupe 21) {#lab-21--redis-cache-group-21}

> **Objectif :** allouer à Odoo un point d'accès Redis en exploitant le serveur Redis co-hébergé sur la VM NFS partagée,
> et vérifier la nature exacte des éléments raccordés par le module.

**Vous allez :** activer Redis avec l'hôte automatique · vérifier les variables d'environnement et les lignes
`odoo.conf` · appréhender les situations requérant un hôte dédié ou une authentification.
**Durée :** 15 min · **Coût :** aucun (Redis opère sur la VM NFS existante) · **Prérequis :** NFS actif
(valeur par défaut).

#### Paramètres de ce groupe {#settings-in-this-group-13}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `enable_redis` | `false` | Non | Injecte les réglages Redis et consigne `redis_host`/`redis_port` dans `odoo.conf` lors du démarrage |
| `redis_host` | `""` | Oui | Hôte explicite ; vide = adresse IP de la VM NFS (qui héberge Redis) |
| `redis_port` | `6379` | Oui | Port Redis |
| `redis_auth` | `""` | Oui | Mot de passe (sensible). Le définir injecte `REDIS_AUTH` en tant que secret et cesse d'injecter `REDIS_URL` |

#### Étape 1 — Configurer {#step-1--configure-13}

```hcl
enable_redis = true
redis_host   = ""      # use the Redis on the shared NFS VM
redis_port   = "6379"
```

#### Étape 2 — Appliquer {#step-2--apply-13}

Mise à jour directe et déploiement d'une nouvelle révision ; environ 2 à 3 minutes.

#### Étape 3 — Vérifier {#step-3--verify-13}

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "name: (ENABLE_REDIS|REDIS_HOST|REDIS_PORT|REDIS_URL|NFS_SERVER_IP)" -A1
gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
  | grep -E "Configured Redis|Redis disabled"
```

Résultat attendu : `ENABLE_REDIS` prend la valeur `true` ; `REDIS_HOST` correspond à l'IP interne de la VM NFS (par exemple
`10.0.0.2`) ; `REDIS_URL` vaut `redis://<ip>:6379` ; et le journal de démarrage mentionne
`Configured Redis: host=<ip> port=6379`.

#### Pour aller plus loin {#explore-further-13}

- **Quels éléments l'exploitent.** La version standard d'Odoo Community conserve ses sessions dans son répertoire de données — ici
  `/mnt/filestore/sessions` sur l'espace NFS partagé, déjà accessible à l'ensemble des instances. Les
  mentions `redis_host`/`redis_port` au sein de `odoo.conf` ne sont prises en compte que par un module complémentaire exploitant
  ces directives (l'image intègre d'ailleurs le client Python `redis` à cet effet). Adoptez Redis en fonction des exigences de vos
  modules, et non comme un impératif pour le partage.
- Faites pointer `redis_host` vers une instance Memorystore située sur le même VPC et constatez l'alignement de la variable d'environnement ainsi
  que du log d'amorçage.
- Définissez `redis_auth` et comparez les variables d'environnement : `REDIS_URL` s'efface au profit de `REDIS_AUTH` sous
  forme de référence à un secret.

#### Points d'attention {#watch-out-for-13}

- L'activation de `enable_redis = true` sans renseigner `redis_host` implique que NFS soit actif (ou découvrable) ; dans le cas contraire,
  le plan est rejeté puisque la VM NFS fait office d'hôte Redis par défaut.
- En optant pour Filestore à la place de la VM NFS, aucun Redis co-hébergé n'est proposé — il faut déclarer `redis_host` de façon explicite.

#### Restauration {#revert-13}

```hcl
enable_redis = false
redis_host   = ""
redis_auth   = ""
```

Au prochain démarrage, le script d'initialisation élimine les directives obsolètes `redis_*` de `odoo.conf` et consigne
`Redis disabled`.

---

### Lab 22 — VPC Service Controls et journaux d'audit (Groupe 22) {#lab-22--vpc-service-controls--audit-logging-group-22}

> **Objectif :** consigner chaque consultation et écriture de données vers les API du projet, et analyser la manière dont le
> module communique sur le périmètre VPC Service Controls qu'il a pu ou non mettre en place.

**Vous allez :** activer les journaux d'audit approfondis et les examiner · demander un périmètre en mode simulation (dry-run) et constater
les conclusions réelles remontées par le module.
**Durée :** 15–20 min · **Coût :** oui — les journaux d'audit DATA_READ/DATA_WRITE accroissent le volume de données journalisées ·
**Prérequis / configuration externe :** la création d'un périmètre VPC-SC exige que le projet soit rattaché à une
**organisation** dont vous assurez l'administration ; les projets nichés dans des dossiers nécessitent de renseigner `organization_id`. Ces
paramètres sont masqués du formulaire au sein des projets gérés par RAD.

#### Paramètres de ce groupe {#settings-in-this-group-14}

| Variable | Valeur par défaut | Update-safe | Rôle |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Oui | Instancie un niveau d'accès ainsi qu'un périmètre pour ce déploiement |
| `vpc_cidr_ranges` | `[]` | Oui | Plages CIDR pour le niveau d'accès ; vide = détection automatique depuis le VPC |
| `vpc_sc_dry_run` | `true` | Oui | Enregistre les infractions dans les journaux sans bloquer les flux |
| `organization_id` | `""` | Oui | Requis dès lors que le projet est placé dans un dossier |
| `enable_audit_logging` | `false` | Non | Journaux d'audit DATA_READ, DATA_WRITE et ADMIN_READ pour tous les services du projet |

#### Étape 1 — Configurer {#step-1--configure-14}

```hcl
enable_audit_logging = true
enable_vpc_sc        = true    # try it; see what the module reports
vpc_sc_dry_run       = true    # never start with enforcement
vpc_cidr_ranges      = []
organization_id      = ""      # set it if your project is under a folder
```

#### Étape 2 — Appliquer {#step-2--apply-14}

Ajoute la configuration d'audit au niveau du projet et, si l'organisation s'avère accessible, met en place un niveau d'accès ainsi qu'un
périmètre en mode simulation (dry-run). Si l'organisation ne peut être localisée, le processus d'apply consigne
`WARNING: VPC Service Controls skipped — project is nested under a folder` et poursuit son exécution.
Comptez environ 3 à 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-14}

```bash
gcloud projects get-iam-policy "$PROJECT" --format=json | jq '.auditConfigs'
# expect allServices with DATA_READ, DATA_WRITE, ADMIN_READ

gcloud logging read 'logName:"cloudaudit.googleapis.com%2Fdata_access"' \
  --project="$PROJECT" --limit=5 --format="value(protoPayload.methodName)"
```

Comparez par la suite les sorties du module sur la fiche du déploiement : `vpc_sc_enabled` vous informe de la création
effective d'un périmètre (`false` s'il a été ignoré, malgré votre paramétrage), tandis que
`audit_logging_enabled` doit afficher `true`.

#### Pour aller plus loin {#explore-further-14}

- Dans le cadre d'une organisation : listez le périmètre
  (`gcloud access-context-manager perimeters dry-run list --policy=<policy-id>`), sollicitez Odoo,
  puis recherchez les infractions simulées (dry-run) au sein de Logging avant d'envisager d'activer `vpc_sc_dry_run = false`.

#### Points d'attention {#watch-out-for-14}

- La politique d'audit constitue une **ressource unique à l'échelle du projet** partagée par chaque application qui l'active ; la révoquer
  ici revient à la révoquer pour l'ensemble du projet.
- Activer l'application stricte d'un périmètre (`vpc_sc_dry_run = false`) risque de bloquer les requêtes propres à la plateforme ; procédez-y
  uniquement au terme d'une phase de simulation exempte d'anomalies.

#### Restauration {#revert-14}

```hcl
enable_vpc_sc        = false
vpc_sc_dry_run       = true
enable_audit_logging = false
```

---

## Tâche 3 — Exploiter et maintenir en conditions opérationnelles (Day-2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter le service et ses révisions** (chaque déploiement crée une révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ajuster la mise à l'échelle** en modifiant les champs d'instances min/max et en cliquant sur **Update** sur la page des détails du déploiement — le module détient la spécification du service, la mise à l'échelle est donc une modification de configuration et non une édition manuelle de `gcloud` (une modification manuelle serait annulée au prochain apply). Consultez le Lab 4 pour le choix d'allocation de CPU qui maintient l'exécution des actions planifiées d'Odoo.

3. **Mettre à jour la version de l'application** en modifiant la version saisie via **Update** sur la page des détails du déploiement ; une nouvelle image est compilée et une nouvelle révision est déployée (Lab 3).

4. **Gérer les secrets, les sauvegardes et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --format="value(name)" | grep -E "$SERVICE|master-password"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud storage ls -l "gs://gcs-$SERVICE-backups/backups/" | tail -5    # latest backups
   ```

5. **Ouvrir une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" \
     --filter="databaseVersion~POSTGRES" --limit=1)
   # Role and database are named after the service (hyphens → underscores), e.g. odoodemo1a2b3c4d.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^odoo" --limit=1)
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" --format="value(name)" --filter="name~$SERVICE$" | head -1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"   # the password
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_USER" --project="$PROJECT"
   ```

6. **Redémarrer Odoo proprement** (par exemple après une modification de secret) en démarrant une nouvelle révision :

   ```bash
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --update-env-vars=LAB_RESTART="$(date +%s)"
   ```

   À chaque démarrage, le script de démarrage réconcilie `db_host`, `db_port`, `db_user`, `db_password`, `db_name` et `admin_passwd` dans `/mnt/odoo.conf` à partir des valeurs injectées ; les autres paramètres de ce fichier persistent sur le partage NFS entre les révisions.

---

## Tâche 4 — Observer : Journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND severity>=WARNING" \
     --project="$PROJECT" --limit=20
   ```

   Filtre Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

   Ce que vous verrez : les journaux de requêtes Cloud Run ainsi que les lignes du script de démarrage (`Reconciled
   database connection settings`, `Configured Redis` / `Redis disabled`, `Write access to
   /mnt/filestore verified`, `Starting Odoo server...`). Le fichier `odoo.conf` généré définit `logfile = /var/log/odoo/odoo.log`, de sorte que le journal du serveur Odoo lui-même est écrit dans un fichier à l'intérieur du conteneur plutôt que dans Cloud Logging.

2. **Journaux des jobs** — les jobs d'initialisation, de sauvegarde, de SQL personnalisé et de rotation écrivent leurs journaux sous `cloud_run_job` :

   ```bash
   gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name~\"^$SERVICE\"" \
     --project="$PROJECT" --limit=30 --format="table(timestamp,resource.labels.job_name,textPayload)"
   ```

3. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) ainsi que l'utilisation du CPU et de la mémoire. Avec `support_users` défini (Lab 2), le module crée également des règles d'alerte sur le CPU, la mémoire et les erreurs 5xx ; avec `min_instance_count >= 1` et `uptime_check_config.enabled` (Lab 14), il crée un **test de disponibilité** — confirmez qu'il est au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance les plus fréquents.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses journaux pour détecter d'éventuelles erreurs au démarrage, et confirmez que les variables d'environnement et les secrets ont bien été résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Premier démarrage lent / santé hors 200 :** Odoo est en train d'installer `base` ; la sonde de démarrage est en TCP sur le port 8069 (délai de 60 s) et la sonde de vivacité appelle `/web/health` après 120 s. Attendez que les deux jobs d'initialisation réussissent avant d'espérer une réponse de `/web/login`.
- **`ERROR: Cannot write to /mnt/filestore` :** le partage NFS est manquant ou possède des droits incorrects. Vérifiez que la dernière exécution de `$SERVICE-nfs-init` a réussi (et, si vous avez renseigné `initialization_jobs`, que vous avez redéclaré `nfs-init` — Lab 13).
- **`password authentication failed` :** le rôle de base de données et le secret ne concordent pas (modification de la longueur du mot de passe, rotation sans redémarrage, ou restauration). Réexécutez `db-init`, puis déployez une nouvelle révision :
  ```bash
  gcloud run jobs execute "$SERVICE-db-init" --project="$PROJECT" --region="$REGION" --wait
  gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --update-env-vars=LAB_RESTART="$(date +%s)"
  ```
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-nfs-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Une erreur 404 sans journaux de conteneur** — distinguez les trois cas par le titre de la page : `404 Page not
  found` = l'ingress est configuré sur `internal` ou LB-only (Lab 5/10) ; l'erreur `Error 404 (Not Found)!!1` de Google = la liaison de l'invoker `allUsers` est manquante (`gcloud run services get-iam-policy`) ; la page 404 propre à Odoo = chemin incorrect.
- **Les modules personnalisés ont disparu de Apps :** `gcs_volumes` a été défini sans redéclarer le montage de `addons` (Lab 11).
- **Les sondes Cloud Armor renvoient toujours 200 :** les règles WAF nécessitent 5 à 10 minutes après l'apply (Lab 10).
- **Plan refusé :** lisez le message de précondition — il indique les paramètres en conflit (min > max, CDN sans Cloud Armor, IAP sans utilisateurs ou sans écran de consentement, cloisonnement sans `iam.denyAdmin`, SQL personnalisé sans bucket/chemin, montage NFS sans NFS).
- **Quota dépassé sur une nouvelle révision** (`Error code 9`) : le quota CPU ou mémoire Cloud Run de la région est saturé par des services toujours actifs ; réduisez `min_instance_count` ailleurs et réessayez après quelques minutes. N'utilisez pas `--scaling=0` pour libérer du quota — cela fige définitivement un service à zéro.
- **Échec du build de l'image :** examinez l'historique de Cloud Build pour obtenir le journal du build en échec (`gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5`) ; une valeur invalide pour `application_version` fait échouer le téléchargement nocturne des paquets.
- **Erreurs 403 / de permission :** vérifiez les rôles IAM du compte de service d'exécution — avec un compte dédié (Lab 2), l'accès est accordé par secret et par bucket.

Consultez la section *Configuration Pitfalls* du guide de configuration pour connaître les pièges spécifiques à certains paramètres.

---

## Tâche 6 — Détruire [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône de **corbeille** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des registres de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cette opération supprime tout ce que le module a créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, le sous-arbre NFS de l'application, les buckets GCS (y compris le bucket de sauvegarde), les jobs et planifications, tout équilibreur de charge et règle Cloud Armor éventuels, le mécanisme de rotation, ainsi que le compte de service dédié avec ses rôles sur le projet. Les ressources appartenant à **Services_GCP** (le VPC, l'instance Cloud SQL partagée, le serveur NFS, le registre) sont gérées séparément et ne sont pas supprimées ici.

**Copiez d'abord les sauvegardes en dehors** — le bucket de sauvegarde est supprimé avec le déploiement.

**Supprimez ce que les labs de fonctionnalités ont créé en dehors du module :**

```bash
gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet            # Lab 6
gcloud storage rm -r "gs://odoo-lab-sql-$PROJECT"                              # Lab 9
# Lab 10: delete any DNS A record you created for a custom domain.
# Lab 5: an OAuth consent screen (brand) cannot be deleted; it is harmless to leave.
# Lab 22: if other apps rely on detailed audit logs, re-enable them on the project.
```

Confirmez qu'il ne reste rien lié à l'application :

```bash
gcloud run services list --project="$PROJECT" --region="$REGION" | grep "$SERVICE"
gcloud storage buckets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
gcloud secrets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
# each should print nothing
```

---

## Annexe — Variables de liaison de plateforme du groupe 0 {#appendix--group-0-platform-wiring-variables}

Celles-ci ne sont jamais affichées sur le formulaire ; la plateforme ou le wrapper les définit.

| Variable | Rôle |
|---|---|
| `module_description`, `module_documentation`, `module_dependency`, `module_services` | Texte du catalogue, lien vers la doc, dépendance (`Services_GCP`) et liste des services |
| `credit_cost`, `require_credit_purchases` | Tranche de frais de module (110 crédits) et vérification des crédits |
| `enable_purge`, `public_access`, `shared_users`, `technical_support_users` | Visibilité dans le catalogue, autorisation de purge et routage du support |
| `requires_services`, `require_services_gcp_module` | Services partagés nécessaires ; fait échouer le plan si Services_GCP est absent |
| `resource_creator_identity`, `impersonation_service_account` | Identité sous laquelle Terraform et les scripts utilitaires s'exécutent |
| `container_build_config` | Déclaré mais non utilisé — la configuration de build d'Odoo provient de la configuration d'Odoo |
| `max_revisions_to_retain`, `binauthz_evaluation_mode`, `additional_services` | Déclaré mais non référencé par ce module |
| `additional_containers` | Sidecars intégrés à la révision (aucun pour Odoo) |
| `db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`, `db_port_env_var_name`, `db_password_env_var_name`, `service_url_env_var_name` | Alias supplémentaires pour les variables d'environnement DB/URL injectées (vide pour Odoo) |
| `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, `mysql_plugins` | Installation d'extensions/plugins (non utilisé pour Odoo) |
| `job_execution_wait_timeout` | Nombre de secondes pendant lesquelles un apply attend l'exécution d'un job (900) |
| `module_writable_secret_ids` | Secrets que la charge de travail peut réécrire (aucun pour Odoo) |
| `network_name`, `prereq_subnet_cidr_override` | Sélection du VPC / substitution du sous-réseau intégré (inline) |
| `nfs_volume_name` | Nom du volume pour le montage NFS (`nfs-data-volume`) |
| `sql_instance_name`, `sql_instance_base_name` | Nom de l'instance Cloud SQL cible ou intégrée (inline) |

---

## Résumé {#summary}

| Tâche / Lab | Groupe | Type | Résultat |
|---|---|---|---|
| Tâche 1 — Déployer | 1 | Automatisé | Le module provisionne Cloud Run, la base de données Cloud SQL, le sous-arbre NFS, les buckets, les secrets, et exécute nfs-init + db-init |
| Tâche 2 — Accéder et vérifier | — | Manuel | `/web/health` et `/web/login` renvoient 200 ; première connexion en tant que `admin` et mot de passe modifié ; mot de passe maître localisé |
| Lab 2 — Environnement et isolation | 2 | Fonctionnalité | Alertes et libellés en place ; Odoo s'exécute sous un compte dédié au moindre privilège ; cloisonnement compris |
| Lab 3 — Identité et version de l'application | 3 | Fonctionnalité | Texte du service modifié ; image reconstruite sur un canal Odoo choisi |
| Lab 4 — Exécution et mise à l'échelle | 4 | Fonctionnalité | 2 vCPU / 4 Gio, CPU toujours actif, instance préchauffée, répartition du trafic vérifiée sur la révision |
| Lab 5 — Ingress, VPC et IAP | 5 | Fonctionnalité | Erreur 404 observée sur l'ingress interne ; garde-fous IAP compris ou IAP placé devant Odoo |
| Lab 6 — Variables d'environnement et secrets | 6 | Fonctionnalité | Variables d'environnement simples et secrètes sur le conteneur ; valeur de type identifiant déplacée vers Secret Manager |
| Lab 7 — Sauvegarde et maintenance | 7 | Fonctionnalité | Planification/rétention modifiée ; archive de sauvegarde à la demande avec base de données + filestore ; chemin d'importation compris |
| Lab 8 — CI/CD et Binary Authorization | 8 | Fonctionnalité | Binary Authorization appliquée sur le service ; liaison CI/CD comprise |
| Lab 9 — Scripts SQL personnalisés | 9 | Fonctionnalité | Deux scripts ordonnés exécutés sur la base de données d'Odoo |
| Lab 10 — Cloud Armor et domaines | 10 | Fonctionnalité | HTTPS via équilibreur de charge et nip.io ; attaques XSS/SQLi bloquées avec un code 403 ; CDN activé |
| Lab 11 — Stockage et NFS | 11 | Fonctionnalité | Bucket et montage supplémentaires ajoutés tout en conservant le montage addons ; le filestore survit à un redémarrage |
| Lab 12 — Backend de base de données | 12 | Fonctionnalité | Mot de passe renouvelé par rotation ; nouvelle révision réconciliant `odoo.conf` sans échec d'authentification |
| Lab 13 — Jobs et tâches planifiées | 13 | Fonctionnalité | Valeurs par défaut redéclarées, job d'initialisation chaîné et cron de taille du filestore vérifiés |
| Lab 14 — Observabilité et santé | 14 | Fonctionnalité | Sondes ajustées ; test de disponibilité et alerte personnalisée actifs |
| Lab 21 — Redis | 21 | Fonctionnalité | Hôte Redis injecté et écrit dans `odoo.conf` ; journal de démarrage confirmant la prise en compte |
| Lab 22 — VPC-SC et journaux d'audit | 22 | Fonctionnalité | Journaux d'audit d'accès aux données transmis ; résultat VPC-SC lu depuis les sorties |
| Tâche 3 — Exploiter | — | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes/jobs, accès DB, redémarrage propre |
| Tâche 4 — Observer | — | Manuel | Journaux du service et des jobs ; métriques, règles d'alerte et test de disponibilité |
| Tâche 5 — Dépanner | — | Manuel | Diagnostiquer le premier démarrage, NFS, les dérives d'authentification, les jobs d'init, les types de 404, les délais du WAF, les quotas, les problèmes de build et d'IAM |
| Tâche 6 — Détruire | — | Automatisé | La suppression (corbeille) retire toutes les ressources du module ; les éléments additionnels créés par les labs sont supprimés manuellement |
