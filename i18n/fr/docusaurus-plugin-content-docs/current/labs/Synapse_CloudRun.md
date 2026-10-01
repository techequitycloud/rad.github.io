---
title: "Synapse sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Synapse sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Synapse_CloudRun.md @ 3055034 sha256:b453b838a893 -->

# Synapse sur Cloud Run — Guide de lab {#synapse-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le serveur
open source de Matrix, un standard ouvert de communication en temps réel décentralisée
et fédérée. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**Synapse on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
enregistrer un administrateur et vous connecter via l'API Matrix, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Matrix. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au homeserver en cours d'exécution, le vérifier et enregistrer un utilisateur administrateur.
- Vous connecter via l'API client Matrix et connecter le client web Element.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un **domaine que vous contrôlez** pour `server_name` si vous comptez fédérer (définissez-le avant
  le premier déploiement — il est immuable).

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Synapse (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et — point important
   — définissez **`server_name`** sur votre domaine réel (il est intégré à chaque identifiant d'utilisateur et est
   immuable après le premier démarrage). Passez en revue les autres paramètres ; le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (le secret partagé d'enregistrement et le mot de passe
   de la base), un bucket de données Cloud Storage et un volume NFS pour la clé de signature et les médias,
   construit l'image de conteneur et exécute un job ponctuel `db-init` qui crée la
   base de données **avec la collation `C` obligatoire**. Il n'y a pas de job de migration distinct —
   Synapse construit son propre schéma au premier démarrage. Les premiers déploiements prennent environ **20–35
   minutes** (la création de Cloud SQL domine).

3. Une fois terminé, identifiez les ressources avec des filtres indépendants des noms (afin que les commandes
   continuent de fonctionner quel que soit le suffixe du déploiement) :

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

1. Vérifiez que le homeserver est opérationnel. Synapse renvoie un `200 OK` non authentifié sur
   `/health`, et l'API client Matrix annonce les versions de la spécification qu'elle prend en charge :

   ```bash
   curl -s "$SERVICE_URL/health"                     # expect: OK
   curl -s "$SERVICE_URL/_matrix/client/versions"    # expect JSON: {"versions":["r0.0.1",...]}
   ```

2. **Enregistrez le premier utilisateur administrateur.** L'inscription libre en libre-service est désactivée par
   défaut ; vous créez les utilisateurs hors bande avec `register_new_matrix_user`, qui est
   autorisé par le secret partagé d'enregistrement stocké dans Secret Manager. Lisez le
   secret, puis enregistrez-vous de manière interactive auprès du service en cours d'exécution :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~synapse AND name~secret-key" --format="value(name)" --limit=1)
   SHARED_SECRET=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")

   register_new_matrix_user \
     -u admin -p '<choose-a-strong-password>' -a \
     -k "$SHARED_SECRET" \
     "$SERVICE_URL"
   ```

   `-a` accorde les droits d'administration ; `-k` transmet le secret partagé, si bien qu'aucun chemin vers `homeserver.yaml` n'est
   nécessaire depuis votre poste de travail.

3. **Connectez-vous via l'API Matrix** pour vérifier que le compte fonctionne de bout en bout :

   ```bash
   curl -s -XPOST "$SERVICE_URL/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"<the-password>"}'
   # A successful response returns an access_token, device_id, and user_id (@admin:<server_name>).
   ```

4. **Connectez un client.** Ouvrez l'application web [Element](https://app.element.io/), choisissez
   *Sign in* → *Edit* pour le homeserver, et saisissez `$SERVICE_URL` (ou votre domaine personnalisé).
   Connectez-vous en tant que `admin`. Vous disposez désormais d'un homeserver Matrix opérationnel.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ;
   le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Gardez-le actif.** Synapse utilise par défaut `min_instance_count = 1` avec
   `cpu_always_allocated = true` afin que le homeserver continue de traiter la fédération et
   les tâches d'arrière-plan entre les requêtes. Ne le réduisez **pas** à zéro si vous fédérez — une
   instance à froid manque le trafic de fédération entrant. La mise à l'échelle est une modification de configuration
   via **Update**, et non une modification manuelle via `gcloud` (une modification manuelle est annulée lors de la prochaine
   application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.
   Synapse applique lui-même les mises à niveau de schéma au démarrage.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~synapse"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance — et vérifiez la
   collation :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. synapsedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^synapse" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'synapse';
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation CPU / mémoire.
   `uptime_check_config` vaut par défaut `enabled = false` — aucun test de disponibilité (uptime check) n'est provisionné
   d'emblée. Si vous l'activez, notez que le chemin cible par défaut est `/`, et non `/health` ;
   vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Synapse.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses journaux
  à la recherche d'erreurs de démarrage. `startup_probe`/`liveness_probe` ciblent par défaut le chemin `/` sur le port
  8008 (les variables de sonde du module sous-jacent `Synapse_Common` ont pour valeur par défaut
  `/health`, mais cette variante Cloud Run les remplace par ses propres variables dont la valeur par défaut est `/`,
  dans `synapse.tf`) ; une sonde pointée vers un chemin Matrix authentifié renverrait
  401/403 et ne réussirait jamais.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`Database has incorrect values for … collation` :** la base de données n'a pas été créée avec
  la collation `C`. Vérifiez que le job `db-init` s'est exécuté ; relancez-le ou recréez la base de données (vide)
  avec `LC_COLLATE='C' LC_CTYPE='C'`.
- **Fédération rompue / sessions d'appareils perdues après un redéploiement :** la clé de signature a été
  régénérée parce que le répertoire de données n'était pas persistant. Assurez-vous que `enable_nfs = true`
  (la valeur par défaut) **et définissez `nfs_mount_path = "/data"`** — sa valeur par défaut est
  `/opt/synapse/storage`, qui ne correspond pas au répertoire de données du point d'entrée
  (`SYNAPSE_DATA_DIR = "/data"`), de sorte que la clé de signature n'arriverait pas sur le montage
  persistant. La clé de signature ne doit jamais changer.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret du
  mot de passe de la base existe et que le job `db-init` s'est terminé avec succès.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment les règles essentielles selon lesquelles `server_name` et la clé de signature sont
immuables après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus
le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire
les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module
a créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS,
le volume NFS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15, collation C), les secrets et le stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; enregistrer un administrateur avec `register_new_matrix_user` ; se connecter via l'API Matrix ; connecter Element |
| 3 — Exploiter | Manuel | Inspecter les révisions, garder le service actif, mettre à jour la version, gérer secrets/sauvegardes, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de collation, de clé de signature, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
