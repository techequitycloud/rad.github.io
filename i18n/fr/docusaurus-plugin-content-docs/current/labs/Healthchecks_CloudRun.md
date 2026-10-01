---
title: "Healthchecks sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Healthchecks sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Healthchecks_CloudRun.md @ 3055034 sha256:3002dc26b83c -->

# Healthchecks sur Cloud Run — Guide de lab {#healthchecks-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Healthchecks_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Healthchecks est un service open source et auto-hébergé de surveillance des jobs cron et des
signaux de vie (heartbeat) : les tâches planifiées lui envoient un « ping » en cas de succès, et il vous alerte lorsqu'un ping est
en retard ou absent. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel
du module **Healthchecks on Cloud Run** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Healthchecks. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Healthchecks_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et vous connecter avec le compte administrateur pré-créé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le réseau Cloud SQL, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Healthchecks (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Healthchecks_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY`, `ADMIN_PASSWORD`
   et le mot de passe de la base de données), et exécute deux jobs ponctuels : `db-init` (crée
   la base de données et le rôle) et `admin-bootstrap` (exécute les migrations et crée le
   compte superutilisateur initial). Les premiers déploiements prennent environ **15–25 minutes**
   (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~healthchecks" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est démarré et sert la page de connexion (Healthchecks n'a pas de
   point de terminaison de santé dédié — la page racine est le signal public, sans
   authentification) :

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"
   # expect 200 (or a redirect in the 300 range) and a non-zero body size
   ```

2. Récupérez l'identifiant administrateur pré-créé et connectez-vous :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~healthchecks-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Ouvrez `$SERVICE_URL` dans un navigateur, connectez-vous avec `admin_email` (par défaut
   `admin@techequity.cloud`, ou la valeur que vous avez configurée) et le mot de passe
   ci-dessus. Vous devriez arriver sur le tableau de bord des checks, vide.

3. Créez un check de test depuis l'interface (ou via l'API) et vérifiez qu'il apparaît dans
   le tableau de bord — cela prouve que le chemin d'écriture en base de données fonctionne de bout en bout,
   et pas seulement que la page de connexion s'est affichée.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne réduisez pas à zéro à la légère.** Ce module utilise par défaut
   `min_instance_count = 1` et `cpu_always_allocated = true` précisément pour que
   la boucle d'arrière-plan `sendalerts`/`sendreports`, colocalisée, continue de détecter
   les check-ins manqués. Si vous passez à `min_instance_count = 0` ou basculez
   `cpu_always_allocated = false` pour réduire les coûts, sachez que les alertes peuvent
   devenir peu fiables tant que le service est inactif.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle révision est déployée
   avec la même image officielle `healthchecks/healthchecks` au nouveau tag.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~healthchecks"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + admin-bootstrap
   ```

5. **Configurez un véritable envoi d'e-mails sortants** (nécessaire pour que les alertes soient réellement
   distribuées — la valeur par défaut de `DEFAULT_FROM_EMAIL` est un espace réservé) : définissez
   `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER` via `environment_variables`
   et `EMAIL_HOST_PASSWORD` via `secret_environment_variables`, puis appliquez.

6. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. healthchecksdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^healthchecks" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Le même flux de journaux contient
   à la fois le serveur web ET les workers d'arrière-plan `sendalerts`/`sendreports`
   (ils s'exécutent dans le même conteneur) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU/de la
   mémoire. Comme ce service est toujours actif par défaut (`min_instance_count
   = 1`), attendez-vous à une utilisation du CPU faible mais constante, due à la boucle d'alerte en arrière-plan,
   même en l'absence de trafic HTTP. Le module peut provisionner un **test de disponibilité** (uptime check)
   (lorsque `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Healthchecks.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision
  et ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  La sonde de démarrage cible `/` avec un délai initial de 60 secondes.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le job `db-init` s'est terminé
  avec succès.
- **La page de connexion se charge mais l'application semble utiliser SQLite / les données sont réinitialisées au
  redémarrage :** vérifiez que la variable d'environnement `DB` a bien été résolue en `"postgres"` sur la
  révision en cours d'exécution — c'est le paramètre le plus important à vérifier.
  ```bash
  gcloud run revisions describe <revision-name> --project="$PROJECT" --region="$REGION" \
    --format=json | grep -A2 '"name": "DB"'
  ```
- **Impossible de se connecter avec l'identifiant pré-créé :** vérifiez que le job `admin-bootstrap`
  s'est bien terminé (il dépend de l'achèvement préalable de `db-init`) :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les alertes n'arrivent jamais :** il s'agit très probablement d'une configuration SMTP absente ou laissée
  à sa valeur d'espace réservé (`DEFAULT_FROM_EMAIL`/`EMAIL_HOST`), et non d'un bug de la plateforme — recherchez
  dans les journaux du service des erreurs de connexion SMTP provenant de `sendalerts`.
- **Échec de la construction de l'image :** ce module déploie l'image officielle préconstruite avec
  `container_image_source = "prebuilt"` — il ne devrait y avoir aucune étape de build.
  Si vous voyez un échec Cloud Build, vérifiez si `container_image_source`
  a été redéfini par erreur à `"custom"`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL et les secrets Secret Manager.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, et exécute `db-init` + `admin-bootstrap` |
| 2 — Accéder et vérifier | Manuel | La page de connexion se charge ; se connecter avec l'identifiant administrateur pré-créé ; créer un check de test |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, gérer les secrets, configurer SMTP, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de moteur de base de données, d'admin-bootstrap et de SMTP |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
