---
title: "Synapse sur Cloud Run — Guide de Lab"
description: "Lab pratique : déployer Synapse sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Synapse_CloudRun.md @ 15fd4c7 sha256:83e60fb1ce28 -->

# Synapse sur Cloud Run — Guide de Lab {#synapse-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le
serveur open source pour Matrix, une norme ouverte pour la communication
décentralisée, fédérée et en temps réel. Ce lab vous guide à travers le cycle de
vie opérationnel complet du module **Synapse sur Cloud Run** sur Google Cloud :
déployez-le, accédez-y et vérifiez-le, enregistrez un administrateur et
connectez-vous via l'API Matrix, exécutez-le au quotidien, observez-le,
diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la
plateforme Google Cloud**, et non sur les fonctionnalités du produit Matrix. Pour
la liste complète des services provisionnés et de chaque entrée de
configuration (organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun) — ce
lab ne duplique délibérément pas ce détail afin qu'il reste précis au fil du
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Accéder au homeserver en cours d'exécution, le vérifier et enregistrer un
  utilisateur administrateur.
- Vous connecter via l'API client Matrix et connecter le client web Element.
- Effectuer des opérations de jour 2 — inspecter, mettre à jour et gérer les
  secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont ce module dépend). Vous n'avez pas besoin de le
  déployer vous-même en premier — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si ce
  n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation de déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes qu'il affiche en tant que Propriétaire de projet, puis
  **Vérifier**) et de donner le rôle de **Propriétaire** au compte de service
  de déploiement RAD. Un projet créé par RAD pour vous n'a besoin de rien de
  tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet que RAD crée
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches de jour 2 — sont modifiées
  ultérieurement avec **Update** sur la page du déploiement après avoir coché
  **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le
  coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais
  de frais de module). Dans un environnement de lab, seul un administrateur
  peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec la permission de déployer des modules dans
  le projet.
- Un **domaine que vous contrôlez** pour `server_name` si vous avez l'intention de
  fédérer (définissez-le avant le premier déploiement — il est immuable).

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise
:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Catalogue de solutions → Modules
   RAD**, puis ouvrez **Synapse (Cloud Run)** depuis la liste **Modules de
   plateforme**, choisissez **Formulaire de configuration** sous *Comment
   souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur
   l'**Assistant conversationnel** si vous détenez des crédits achetés ou si
   vous êtes un partenaire ou un administrateur), définissez `project_id`, et —
   surtout — définissez **`server_name`** sur votre vrai domaine (il est intégré à
   chaque ID utilisateur et est immuable après le premier démarrage).
   Examinez le reste des entrées ; le [Guide de
   configuration](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec les logs en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (PostgreSQL 15) avec ses secrets Secret Manager (le secret partagé
   d'enregistrement et le mot de passe de la base de données), un bucket de
   données Cloud Storage et un volume NFS pour la clé de signature et les
   médias, construit l'image conteneur et exécute un job unique `db-init` qui crée
   la base de données **avec le classement obligatoire `C`**. Il n'y a pas
   de job de migration séparé — Synapse construit son propre schéma au premier
   démarrage. Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL domine).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au
   nom (afin que les commandes continuent de fonctionner quel que soit le
   suffixe de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~synapse" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier ; enregistrer un administrateur [Manuel] {#task-2--access--verify-register-an-admin-manual}

1. Confirmez que le homeserver est sain. Synapse sert un `200 OK` non authentifié
   à `/health`, et l'API client Matrix annonce ses versions de spécification
   prises en charge :

   ```bash
   curl -s "$SERVICE_URL/health"                     # expect: OK
   curl -s "$SERVICE_URL/_matrix/client/versions"    # expect JSON: {"versions":["r0.0.1",...]}
   ```

2. **Enregistrez le premier utilisateur administrateur.** L'enregistrement en
   libre-service est désactivé par défaut ; vous créez des utilisateurs
   hors-bande avec `register_new_matrix_user`, qui est autorisé par le secret partagé
   d'enregistrement stocké dans Secret Manager. Lisez le secret, puis
   enregistrez-vous interactivement contre le service en cours d'exécution :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~synapse AND name~secret-key" --format="value(name)" --limit=1)
   SHARED_SECRET=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")

   register_new_matrix_user \
     -u admin -p '<choose-a-strong-password>' -a \
     -k "$SHARED_SECRET" \
     "$SERVICE_URL"
   ```

   `-a` accorde l'administration ; `-k` transmet le secret partagé afin
   qu'aucun chemin `homeserver.yaml` ne soit nécessaire depuis votre poste de travail.

3. **Connectez-vous via l'API Matrix** pour confirmer que le compte fonctionne
   de bout en bout :

   ```bash
   curl -s -XPOST "$SERVICE_URL/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"<the-password>"}'
   # A successful response returns an access_token, device_id, and user_id (@admin:<server_name>).
   ```

4. **Connectez un client.** Ouvrez l'application web [Element](https://app.element.io/),
   choisissez *Sign in* → *Edit* le homeserver, et entrez `$SERVICE_URL` (ou votre
   domaine personnalisé). Connectez-vous en tant que `admin`. Vous avez
   maintenant un homeserver Matrix fonctionnel.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Maintenez-le chaud.** Synapse utilise par défaut `min_instance_count = 1` avec `cpu_always_allocated = true` afin
   que le homeserver continue de gérer la fédération et les tâches en
   arrière-plan entre les requêtes. Ne le mettez **pas** à l'échelle à zéro si
   vous fédérez — une instance froide manque le trafic de fédération entrant.
   La mise à l'échelle est un changement de configuration via **Update**, pas
   une modification manuelle `gcloud` (une modification manuelle est annulée lors
   du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant l'entrée de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et une nouvelle révision est déployée. Synapse
   applique lui-même toutes les mises à niveau de schéma au démarrage.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~synapse"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance — et
   confirmez le classement :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. synapsedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^synapse" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'synapse';
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — ouvrez le tableau de bord Cloud Run pour le service et
   examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le
   nombre d'instances et l'utilisation du CPU/de la mémoire. `uptime_check_config` utilise par
   défaut `enabled = false` — aucune vérification de disponibilité n'est provisionnée
   prête à l'emploi. Si vous l'activez, notez que le chemin cible par défaut
   est `/`, et non `/health` ; confirmez qu'il est vert sous Monitoring → Uptime
   checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions de Synapse.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses logs pour les erreurs de démarrage. Le `startup_probe`/`liveness_probe` utilise
  par défaut le chemin `/` sur le port 8008 (les variables de sonde du
  module `Synapse_Common` sous-jacent utilisent par défaut `/health`, mais cette variante
  Cloud Run les remplace par ses propres variables par défaut `/` dans
  `synapse.tf`) ; une sonde pointant vers un chemin Matrix authentifié renverrait
  401/403 et ne passerait jamais.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`Database has incorrect values for … collation` :** la base de données n'a pas été créée avec le classement
  `C`. Confirmez que le job `db-init` a été exécuté ; réexécutez-le ou
  recréez la base de données (vide) avec `LC_COLLATE='C' LC_CTYPE='C'`.
- **Fédération cassée / sessions d'appareil perdues après un redéploiement :**
  la clé de signature a été régénérée car le répertoire de données n'était pas
  persistant. Assurez-vous que `enable_nfs = true` et `nfs_mount_path = "/data"` (tous deux par défaut) — tout
  autre chemin de montage ne correspond pas au répertoire de données du point
  d'entrée (`SYNAPSE_DATA_DIR = "/data"`), de sorte que la clé de signature ne se retrouverait pas
  sur le montage persistant. La clé de signature ne doit jamais changer.
- **Erreurs de connexion à la base de données :** confirmez que l'instance
  Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base de données
  existe et que le job `db-init` s'est terminé avec succès.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec de la construction de l'image :** examinez l'historique de Cloud
  Build pour le log de la construction échouée.
- **403 / erreurs de permission :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les pièges spécifiques aux paramètres (y compris les règles critiques selon
lesquelles `server_name` et la clé de signature sont immuables après le premier
démarrage).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Delete**). La suppression exécute `terraform destroy` et est irréversible
(l'enregistrement du déploiement est conservé pour l'historique). Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue
**Delete**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). Cela supprime tout ce que le module a créé — le service Cloud Run, la
base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, le
volume NFS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15, classement C), les secrets, le stockage, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | La vérification de santé réussit ; enregistrer un administrateur avec `register_new_matrix_user` ; se connecter via l'API Matrix ; connecter Element |
| 3 — Opérer | Manuel | Inspecter les révisions, maintenir chaud, mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et la vérification de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de classement, de clé de signature, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module |
