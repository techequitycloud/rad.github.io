---
title: "GoToSocial sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez GoToSocial sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/GoToSocial_CloudRun.md @ 3055034 sha256:28d8f5abe59c -->

# GoToSocial sur Cloud Run — Guide de lab {#gotosocial-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoToSocial_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

GoToSocial est un serveur ActivityPub/Fediverse léger et auto-hébergé — une
petite alternative à Mastodon, écrite sous la forme d’un unique binaire Go statique. Ce lab
vous fait parcourir le cycle de vie opérationnel complet du module **GoToSocial sur
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier (y compris
la création de son premier compte administrateur, qui exige une étape manuelle), l’exploiter
au quotidien, l’observer, diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit GoToSocial. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/GoToSocial_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder au service en cours d’exécution et le vérifier correctement (avec un en-tête `User-Agent`),
  et créer le premier compte administrateur de l’instance via le déclenchement manuel requis d’un job.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants, y compris
  une création de compte administrateur bloquée.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **GoToSocial (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et
   définissez **`host`** sur votre véritable domaine si vous en avez un (cette valeur est intégrée
   à chaque URI ActivityPub au moment de la création et devient **immuable** dès qu’il existe de vrais
   comptes/publications — la valeur provisoire `gotosocial.local` convient pour ce
   lab). Passez en revue les autres paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/GoToSocial_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du
   déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15,
   créée avec la collation `C` obligatoire) avec ses secrets Secret Manager
   (`SUPERUSER_PASSWORD`, une paire de clés HMAC pour le stockage d’objets compatible S3,
   et le mot de passe de la base), un bucket Cloud Storage `storage`, et
   exécute le job d’initialisation `db-init`. Un premier déploiement prend environ
   **15 à 25 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois le déploiement terminé, repérez les ressources à l’aide de filtres indépendants du nom (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gotosocial" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Vérifiez que le service est démarré — mais vous devez envoyer un en-tête `User-Agent`, sinon
   GoToSocial rejettera la requête.** Les points de contrôle de santé de GoToSocial
   (`/readyz`, `/livez`) sont bien réels et sans authentification, mais ils rejettent délibérément
   toute requête dépourvue de `User-Agent` avec une réponse `418 I'm a teapot`
   — c’est une mesure anti-scraping, et non un bug :

   ```bash
   curl -s "$SERVICE_URL/readyz"                         # 418 — no User-Agent sent
   curl -A "gotosocial-lab-check/1.0" -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/readyz"   # expect 200
   ```

2. **Créez le premier compte administrateur de l’instance — il s’agit d’une étape manuelle OBLIGATOIRE,
   et non facultative.** GoToSocial n’a aucun parcours d’inscription web et
   aucun point de terminaison REST pour le tout premier compte ; cela passe uniquement par la CLI, et la CLI
   refuse de s’exécuter tant que le serveur principal n’a pas terminé son premier démarrage. Le
   job `admin-create` n’est délibérément **pas** exécuté automatiquement sur Cloud Run
   (les jobs d’initialisation s’exécutent toujours avant que la première révision du service
   n’existe) ; déclenchez-le donc maintenant que le service est confirmé en bonne santé :

   ```bash
   gcloud run jobs execute "${SERVICE}-admin-create" --project="$PROJECT" --region="$REGION" --wait
   ```

   S’il échoue parce que le serveur n’avait pas encore fini de démarrer, attendez une minute
   et relancez la même commande — le script du job effectue aussi ses propres
   nouvelles tentatives (20 tentatives, espacées de 15 s) avant d’abandonner.

3. **Récupérez le `SUPERUSER_PASSWORD` généré dans Secret Manager :**

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Connectez-vous à l’instance avec le nom d’utilisateur par défaut `admin` (ou la valeur
   donnée à `superuser_username`) et le mot de passe récupéré, à l’aide de n’importe quel
   client compatible ActivityPub/GoToSocial, ou vérifiez directement l’API
   client :

   ```bash
   curl -A "gotosocial-lab-check/1.0" -s "$SERVICE_URL/api/v1/instance" | head -c 500
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update**
   sur la page de détails du déploiement — le module est propriétaire de la spécification du service, la
   mise à l’échelle est donc une modification de configuration, et non une modification manuelle via `gcloud` (une modification
   manuelle serait annulée à l’application suivante). GoToSocial utilise par défaut
   `min_instance_count = 0` (mise à l’échelle à zéro) et `max_instance_count = 1` —
   **n’augmentez pas `max_instance_count`** : le cache interne au processus de GoToSocial n’a
   aucune synchronisation entre instances, et le projet amont ne prend pas en charge plusieurs
   instances sur la même base de données / le même stockage.

3. **Mettre à jour la version de l’application** en modifiant le paramètre de version dans la
   plateforme RAD et en l’appliquant via **Update** ; une nouvelle révision récupère le
   tag `docker.io/superseriousbusiness/gotosocial` mis à jour. Les migrations de schéma
   s’exécutent automatiquement au démarrage de la nouvelle révision — il n’y a pas de job de
   migration distinct à exécuter.

4. **Gérer les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gotosocial"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, admin-create jobs
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. gotosocialdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^gotosocial" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifier que le stockage d’objets est bien utilisé** (les médias, avatars et pièces jointes vont
   directement dans GCS via le client S3 natif de GoToSocial, et non via un montage de système de fichiers) :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de mise
   à l’échelle — il devrait rester à 0 entre les requêtes de test puisque `min_instance_count
   = 0` par défaut) et l’utilisation du processeur et de la mémoire. Le paramètre
   `uptime_check_config` de GoToSocial est désactivé par défaut ; si vous l’activez, sachez
   qu’un test de disponibilité sur `/` (et non `/readyz`/`/livez`) évite le
   risque de faux échecs dû au filtrage par User-Agent, sauf si le vérificateur envoie un
   `User-Agent`.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GoToSocial.

- **Les contrôles de santé / curl renvoient `418 I'm a teapot` :** c’est attendu —
  GoToSocial rejette toute requête sans en-tête `User-Agent` par mesure
  anti-scraping, même sur ses points de terminaison « sans authentification » `/readyz`/`/livez`.
  Passez toujours `curl -A "<some-agent>" ...`. Ce n’est *pas* le signe
  que le service est en mauvaise santé.
- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision
  et ses journaux pour repérer des erreurs de démarrage. La sonde de démarrage est une sonde **TCP** sur le port
  8080 (et non HTTP) ; une révision « en bonne santé » peut donc tout de même échouer sur les requêtes si
  Postgres ou GCS n’est pas joignable — consultez les journaux de l’application, et pas seulement
  l’état de la révision.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`error opening storage backend: ... Access Denied` :** lors d’un *tout premier
  déploiement*, il peut s’agir d’une course ponctuelle de propagation IAM (l’attribution de
  `roles/storage.objectAdmin` au compte de service de stockage peut mettre 1 à 2 minutes à se
  propager) — attendez une minute et laissez Cloud Run réessayer, ou forcez une nouvelle
  révision. Si le problème persiste au-delà de quelques minutes, vérifiez l’attribution :
  ```bash
  BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
  gcloud storage buckets get-iam-policy "gs://$BUCKET"
  ```
- **Le job `admin-create` échoue avec « instance application not yet created » :**
  le serveur principal n’a pas encore terminé son premier démarrage. Vérifiez que le service est
  réellement `Ready` (`gcloud run services describe`) avant de relancer le
  job ; le script du job effectue ses propres nouvelles tentatives, mais s’il épuise les 20
  tentatives, attendez que le service se stabilise et relancez la commande `gcloud run
  jobs execute ... --wait` de la tâche 2.
- **La nouvelle tentative de `admin-create` échoue avec `sql: no rows in result set` /
  `IsUsernameAvailable` indique que le nom d’utilisateur est déjà pris, alors que vous ne l’avez jamais
  créé avec succès :** cela signifie qu’une tentative précédente a laissé une ligne
  `accounts` orpheline, sans ligne `users` correspondante (GoToSocial insère d’abord le compte,
  puis plante à l’étape de la ligne utilisateur si l’application d’instance n’était pas
  prête). Pour rétablir la situation, connectez-vous directement à la base de données et supprimez la
  ligne orpheline avant de réessayer :
  ```bash
  INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
  # Role and database are tenant-prefixed (e.g. gotosocialdemo426161cf) — not the bare app name.
  DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
    --format="value(name)" --filter="name~^gotosocial" --limit=1)
  gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
  ```
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='admin';  -- or your superuser_username
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  Relancez ensuite le job `admin-create` de la tâche 2.
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est
  `RUNNABLE` et que le job `db-init` s’est terminé, la base de données affichant la collation
  `C` :
  ```sql
  SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'gotosocial';
  ```
  Si `GTS_DB_TLS_MODE` a été modifié manuellement pour une valeur autre que `"enable"` sur Cloud
  Run, rétablissez-le — `"disable"` échoue (« no encryption » face à l’IP privée
  brute), et `"require"` échoue à la vérification du certificat de Cloud
  SQL.
- **Le job d’initialisation a échoué :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment l’exigence relative à `GTS_DB_TLS_MODE`,
le fait que `max_instance_count` soit un plafond architectural strict, et
l’immuabilité de `host`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement
du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS
`storage` et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15, collation `C`), des secrets, le bucket `storage`, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Vérifier la santé avec un en-tête `User-Agent` ; déclencher manuellement `admin-create` ; récupérer `SUPERUSER_PASSWORD` |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle (jamais au-delà de `max_instance_count = 1`), mettre à jour la version, gérer secrets/sauvegardes, accès à la base et au stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer la particularité 418/User-Agent, la propagation IAM du stockage, les échecs de admin-create, les lignes de compte orphelines, les problèmes de base de données/TLS |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
