---
title: "OnlyOffice sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer OnlyOffice sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/OnlyOffice_CloudRun.md @ 3055034 sha256:7c26e93bb258 -->

# OnlyOffice sur Cloud Run — Guide de lab {#onlyoffice-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OnlyOffice_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Une suite bureautique en ligne pour l'édition collaborative en temps réel de documents, de feuilles de calcul et de présentations. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel
du module **OnlyOffice on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit OnlyOffice. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/OnlyOffice_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Redis, Artifact Registry et les
  comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **OnlyOffice (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/OnlyOffice_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager, construit l'image du conteneur et exécute un job ponctuel d'initialisation de la base de données. Les premiers déploiements
   prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~onlyoffice" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Vérification d'état** — vérifiez que le service est opérationnel et que le Document Server est prêt :

   ```bash
   curl -s "$SERVICE_URL/healthcheck"
   ```

   Réponse attendue : `{"status":"pass"}`. Si le service renvoie un code autre que 200 ou si le
   champ status ne vaut pas `pass`, le Document Server n'a pas terminé son initialisation —
   patientez 1–2 minutes et réessayez.

2. **Secret JWT** — OnlyOffice n'expose pas d'interface d'administration dans le navigateur. L'intégration est
   gérée via un secret JWT stocké dans Secret Manager. Récupérez-le pour l'utiliser dans les
   applications connectées (par ex. Nextcloud, Seafile) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~onlyoffice AND name~jwt"
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~onlyoffice AND name~jwt" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

   Utilisez cette valeur JWT pour configurer l'intégration OnlyOffice dans votre application de
   gestion documentaire.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle avec `gcloud` (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et le stockage :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~onlyoffice"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. onlyofficedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^onlyoffice" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU
   / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il
   est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'OnlyOffice.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage — OnlyOffice Document Server met 60–90 secondes à
  s'initialiser ; vérifiez que `/healthcheck` finit par renvoyer `{"status":"pass"}`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Révision bloquée indéfiniment sur « Waiting for connection to the /cloudsql/... host on port 5432 » :** un comportement connu de l'image du fournisseur, et non un véritable problème de connectivité. Sur Cloud Run, `DB_HOST` est un *répertoire* de socket Unix du Cloud SQL Auth Proxy, mais la propre vérification de disponibilité du lanceur amont du Document Server exécute `nc -z "$DB_HOST" "$DB_PORT"`, et `nc` ne peut jamais résoudre un chemin de système de fichiers en tant qu'hôte TCP — une image *non corrigée* répète donc cette ligne de journal (parfois accompagnée de `nc: getaddrinfo ... Name or service not known`) indéfiniment et la révision ne devient jamais Ready. Le `Dockerfile` du module (`modules/OnlyOffice_Common/scripts/Dockerfile`) corrige ce problème au moment du build avec un `sed -i` sur `/app/ds/run-document-server.sh`, protégé par une assertion `grep -q` qui fait échouer bruyamment le Cloud Build si une future montée de `ONLYOFFICE_VERSION` modifie la formulation du script amont. Si vous voyez exactement ce motif dans les journaux, vérifiez si l'assertion au moment du build a échoué (consultez l'historique Cloud Build pour cette étape) — la correction consiste à mettre à jour le motif `sed` du Dockerfile pour qu'il corresponde à la nouvelle formulation amont, puis à relancer le build. GKE n'est pas concerné (son sidecar Auth Proxy écoute sur un véritable hôte TCP `127.0.0.1`).
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base existe et que le job d'initialisation s'est terminé avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs de connexion à Redis :** vérifiez que Redis est joignable et que le secret du mot de passe Redis existe.
- **Échecs de l'intégration JWT :** vérifiez que la valeur du secret JWT correspond à celle configurée dans l'application connectée. Récupérez la valeur actuelle dans Secret Manager comme indiqué dans la tâche 2.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Service Cloud Run, Cloud SQL (PostgreSQL 15), connexion Redis, secrets Secret Manager et job d'initialisation provisionnés |
| 2 — Accéder et vérifier | Manuel | La vérification d'état sur `/healthcheck` renvoie `{"status":"pass"}` ; le secret JWT est récupéré dans Secret Manager |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage ; ouvrir une session de base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les lenteurs de démarrage, les problèmes de connexion à la base, les échecs du job d'initialisation, les erreurs Redis et les problèmes d'intégration JWT |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
