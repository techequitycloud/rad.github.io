---
title: "Passbolt sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Passbolt sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Passbolt_CloudRun.md @ 3055034 sha256:5a9b80de62e9 -->

# Passbolt sur Cloud Run — Guide de lab {#passbolt-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Passbolt_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Passbolt (Community Edition) est un gestionnaire de mots de passe gratuit, open source et orienté équipe,
doté d'un chiffrement basé sur GPG et du partage d'identifiants par utilisateur ou par groupe
(AGPL-3.0). Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **Passbolt on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier
(y compris le processus d'initialisation de l'administrateur, réellement différent, qu'utilise cette application), l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Passbolt. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Passbolt_CloudRun)
— ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il
  provisionne.
- Récupérer l'URL de configuration administrateur à usage unique dans Cloud Logging et terminer
  l'enregistrement via une extension de navigateur compatible avec Passbolt.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les
  volumes des paires de clés GPG/JWT.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et
  `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Une **extension de navigateur compatible avec Passbolt** installée (Chrome, Firefox ou
  Edge) — nécessaire pour terminer la configuration du compte administrateur à la tâche 2. Installez-la
  depuis [passbolt.com/download](https://www.passbolt.com/download) avant de
  commencer.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Passbolt (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Renseignez `admin_email`, `admin_first_name` et
   `admin_last_name` avec vos vraies informations — elles initialisent l'unique compte
   administrateur. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Passbolt_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si vous déployez à côté d'une
   instance `Passbolt_GKE` dans le même projet, définissez
   `tenant_id = "cr"` (et `"gke"` sur le déploiement GKE) afin que les
   deux variantes n'entrent pas en collision sur des noms de ressources partagés. Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec son secret de mot de passe Secret Manager, deux buckets GCS dédiés
   (`storage` pour la paire de clés GPG du serveur, `jwt` pour la paire de clés JWT), et exécute
   dans l'ordre la chaîne de jobs d'initialisation en 2 étapes (`db-init` →
   `admin-bootstrap`). Le job `admin-bootstrap` est le plus lent des deux — il
   reproduit la séquence de démarrage propre à l'éditeur (génération des clés GPG, installation
   du schéma) avant d'enregistrer le compte administrateur. Les premiers déploiements prennent généralement
   environ **10–20 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~passbolt" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

La configuration du compte administrateur de Passbolt diffère réellement de presque toutes les autres
applications de ce catalogue : il n'existe ni mot de passe administrateur côté serveur, ni
assistant de configuration web à la première visite. Le job d'initialisation `admin-bootstrap` affiche une **URL de
configuration à usage unique** dans Cloud Logging, que vous ouvrez dans un navigateur doté d'une extension compatible
avec Passbolt — l'extension génère alors localement votre paire de clés GPG et votre mot de passe maître,
et les enregistre auprès du serveur via cette URL.

1. Vérifiez que le service est en bonne santé. Passbolt expose un point de terminaison d'état public
   et non authentifié :

   ```bash
   curl -s "$SERVICE_URL/healthcheck/status.json"
   # expect: {"header":{"status":"success",...},"body":"OK"}
   ```

2. **Récupérez l'URL de configuration à usage unique dans Cloud Logging.** Le job `admin-bootstrap`
   l'a affichée sur stdout lorsqu'il a exécuté `cake passbolt register_user` (exécutée
   sans l'option `-q`/quiet précisément pour que cette URL soit visible) :

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_job" AND resource.labels.job_name~admin-bootstrap' \
     --project="$PROJECT" --limit=50 --format='value(textPayload)' \
     | grep '/setup/start/'
   ```

   Vous devriez voir une ligne contenant une URL de la forme :
   ```
   https://<your-service-url>/setup/start/<user-id>/<token>
   ```

   Si rien ne correspond, le job est peut-être encore en cours (vérifiez avec
   `gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap"
   --project="$PROJECT" --region="$REGION"`) ou s'est peut-être déjà terminée lors
   d'un apply précédent — relisez les dernières entrées de journal sans le filtre `grep`
   pour examiner la sortie complète.

3. **Installez l'extension de navigateur Passbolt** (Chrome, Firefox ou Edge) depuis
   [passbolt.com/download](https://www.passbolt.com/download) si ce n'est pas
   déjà fait.

4. **Ouvrez l'URL de configuration** obtenue à l'étape 2 dans le navigateur où l'extension est
   installée. L'extension vous guide pour :
   - Générer localement une nouvelle paire de clés GPG (il s'agit de *votre* clé personnelle, distincte
     de la paire de clés GPG du serveur générée à la tâche 1).
   - Choisir un mot de passe maître (il ne quitte jamais votre navigateur en clair).
   - Enregistrer votre clé publique auprès du serveur Passbolt.

5. Une fois la configuration terminée, vous êtes connecté en tant qu'utilisateur administrateur configuré dans
   `admin_email`/`admin_first_name`/`admin_last_name`. Vérifiez que vous voyez la
   liste de mots de passe vide — il n'y a encore rien à voir, mais une session fonctionnelle
   confirme que toute la chaîne (clé GPG du serveur, clé JWT, schéma, compte administrateur,
   votre clé GPG personnelle) fonctionne.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est propriétaire de la spécification du service ; la mise à l'échelle
   est donc un changement de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). La valeur par défaut `min_instance_count = 0` signifie que
   Passbolt subit un démarrage à froid après une période d'inactivité ; définissez `min_instance_count = 1` pour une
   équipe qui en dépend pendant les heures de travail.

3. **Mettez à jour le tag de version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update**. Les jobs `db-init` et
   `admin-bootstrap` sont réexécutés — tous deux sont idempotents ; un schéma existant
   et le compte administrateur restent donc intacts.

4. **Inspectez les volumes des paires de clés GPG/JWT** (ne les supprimez pas et ne les videz pas —
   voir la tâche 5 pour les conséquences) :

   ```bash
   gsutil ls -p "$PROJECT" | grep passbolt
   gsutil ls gs://<storage-bucket-name>/   # expect serverkey.asc, serverkey_private.asc
   gsutil ls gs://<jwt-bucket-name>/       # expect jwt.key, jwt.pem (or similar)
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. passboltdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^passbolt" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Gérez les utilisateurs, les groupes et les dossiers** — opérations du jour 2 propres à Passbolt,
   effectuées dans l'interface web (ou via son API REST/CLI une fois que vous disposez d'une session)
   plutôt que via Terraform ; il s'agit de données applicatives Passbolt, et non
   d'infrastructure. Invitez d'autres membres de l'équipe depuis l'interface d'administration — chaque nouvel
   utilisateur suit le même processus de configuration par extension de navigateur qu'à la tâche 2.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU et de la
   mémoire. Le module peut provisionner un **test de disponibilité** (uptime check) (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé,
   vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Passbolt.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision
  et ses journaux pour repérer des erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  La sonde de démarrage cible `GET /healthcheck/status.json` avec un seuil d'échec
  généreux pour absorber la latence du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```

- **Le job `admin-bootstrap` échoue avec une Internal Error / 500 sur
  `register_user` :** c'est précisément le mode de défaillance que le job est conçu
  pour éviter en reproduisant d'abord la séquence de génération des clés GPG et d'installation du schéma
  propre à l'éditeur — si elle échoue malgré tout, consultez les journaux de son exécution pour identifier l'étape
  en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions logs read <execution-name> --project="$PROJECT" --region="$REGION"
  ```
  Vérifiez d'abord que `db-init` s'est terminée avec succès (`admin-bootstrap` en dépend)
  et que les volumes GCS `storage`/`jwt` sont réellement montés
  (`mount_gcs_volumes = ["storage", "jwt"]` sur le job).

- **L'URL de configuration n'apparaît jamais dans les journaux :** vérifiez que `admin-bootstrap` s'est réellement
  terminée (et pas seulement qu'elle a démarré) — `gcloud run jobs executions list` affiche l'état
  de l'exécution. Si le job a échoué en cours de route, ses étapes GPG/JWT/schéma idempotentes
  peuvent être réexécutées sans risque ; relancez le job manuellement :
  ```bash
  gcloud run jobs execute "${SERVICE}-admin-bootstrap" --project="$PROJECT" --region="$REGION" --wait
  ```

- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`. Passbolt lit des variables d'environnement `DATASOURCES_DEFAULT_*` distinctes (et non un
  DSN unique) — vérifiez que les valeurs injectées dans la révision correspondent à l'hôte ou au socket
  réels de l'instance.

- **Perte des volumes des paires de clés GPG/JWT :** si le bucket GCS `storage` ou `jwt`
  est supprimé ou vidé, chaque identifiant que Passbolt a chiffré côté serveur
  et chaque session JWT émise deviennent irrécupérables — le serveur génère une
  toute nouvelle paire de clés au démarrage suivant, incapable de déchiffrer les données chiffrées avec
  l'ancienne. Il n'existe aucune récupération côté Terraform ; la gravité est la même que
  la perte de la clé maîtresse d'un gestionnaire de mots de passe. Traitez ces buckets
  avec au moins autant de soin que l'instance Cloud SQL.

- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Delete supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les buckets GCS `storage`/`jwt`
(et les paires de clés GPG/JWT qu'ils contiennent) et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les buckets GCS GPG/JWT, et exécute la chaîne `db-init` → `admin-bootstrap` |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit sur `/healthcheck/status.json` ; récupérer l'URL de configuration à usage unique dans Cloud Logging et terminer l'enregistrement via une extension de navigateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, inspecter les volumes des paires de clés, accéder à la base, gérer les utilisateurs/groupes |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'admin-bootstrap, de base de données et de perte des paires de clés |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
