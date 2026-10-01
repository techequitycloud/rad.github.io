---
title: "Infisical sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Infisical sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Infisical_GKE.md @ 3055034 sha256:ccbc4445266e -->

# Infisical sur GKE Autopilot — Guide de lab {#infisical-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Infisical_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–75 minutes

Infisical est une plateforme open source de gestion des secrets, chiffrée de bout en bout :
les équipes et les pipelines CI/CD stockent, injectent et renouvellent les secrets applicatifs depuis une
plateforme unique. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **Infisical on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Infisical. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Infisical_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et initialiser le premier compte administrateur.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Infisical (GKE)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Infisical_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE (un `Deployment` sans état derrière un
   Service `LoadBalancer` doté d'une adresse IP statique réservée), une base de données Cloud SQL (PostgreSQL 15),
   ses secrets Secret Manager (`ENCRYPTION_KEY`, `AUTH_SECRET`,
   `ADMIN_PASSWORD` et le mot de passe de la base de données), construit l'image de conteneur
   personnalisée et exécute la tâche `db-init`. Les premiers déploiements prennent environ **20–35
   minutes** (la création de Cloud SQL, le build de l'image personnalisée et la réservation de l'adresse IP
   externe en représentent l'essentiel).

3. Une fois terminé, récupérez les identifiants du cluster et repérez les ressources :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep infisical | sed 's|namespace/||' | head -1)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep infisical | sed 's|service/||' | head -1)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Namespace: $NAMESPACE"
   echo "Service:   $SERVICE"
   echo "External IP: $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté à sa base de données. Infisical
   expose un point de terminaison d'état accessible sans authentification :

   ```bash
   curl -s "http://$EXTERNAL_IP/api/status"   # expect HTTP 200 with a JSON body
   ```

2. **Définissez `site_url` dès que l'adresse IP externe est connue.** La tâche `admin-bootstrap`
   cible `site_url` lorsqu'il est défini ; lorsqu'il est laissé vide, le script de la tâche se rabat
   sur `GKE_SERVICE_URL` injecté par la plateforme (l'adresse IP statique réservée), et
   seulement en dernier recours sur un `http://localhost:8080` injoignable si aucun des deux n'est disponible. Définissez
   tout de même `site_url` afin que les liens d'invitation/d'e-mail et CORS utilisent l'adresse réelle : définissez
   `site_url = "http://<EXTERNAL_IP>"` (ou votre domaine personnalisé) sur le déploiement et
   appliquez **Update**. Le pod de la tâche `admin-bootstrap` réessaie automatiquement (jusqu'à 20
   tentatives, espacées de 15 secondes) dès que la cible est joignable — aucun déclenchement manuel
   distinct n'est nécessaire sur GKE.

3. Récupérez le mot de passe administrateur généré et connectez-vous sur `http://$EXTERNAL_IP` :

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" \
       --filter="name~infisical-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   L'e-mail de l'administrateur correspond au paramètre `admin_email` du module (par défaut
   `admin@techequity.cloud`). Si le compte n'existe toujours pas, consultez les journaux du
   pod de la tâche (tâche 5).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et ses pods :**

   ```bash
   kubectl get pods,svc,hpa -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification de la charge de travail, la mise à l'échelle est donc
   une modification de configuration, et non une modification manuelle via `kubectl`.

3. **Mettez à jour le tag de version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et un nouveau
   déploiement progressif commence. `"latest"` correspond à une version épinglée et éprouvée, passée comme
   argument de build du Dockerfile.

4. **Gérez les secrets et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~infisical"
   kubectl get jobs -n "$NAMESPACE"   # db-init + admin-bootstrap
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. infisicaldemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^infisical" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit 50
   ```

2. **Surveillance** — examinez les métriques de la charge de travail GKE (utilisation du CPU / de la mémoire, mise à l'échelle
   par le HPA) et les métriques Cloud SQL. Le module peut provisionner un **test de disponibilité** (uptime check)
   via `uptime_check_config` ; s'il est activé, vérifiez qu'il est au vert sous Monitoring →
   Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Infisical.

- **Pod non Ready / CrashLoopBackOff :** les sondes de démarrage et de vivacité ciblent
  HTTP `/api/status`, qui ne renvoie un code 2xx qu'une fois les connexions à la base de données (et à Redis, s'il est
  activé) en bonne santé — laissez s'écouler le délai/seuil généreux par défaut
  au premier démarrage.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=infisical
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base existe et que la tâche `db-init` s'est terminée. Vérifiez que le
  conteneur sidecar Cloud SQL Auth Proxy est en cours d'exécution (`enable_cloudsql_volume =
  true`).
- **`admin-bootstrap` ne crée jamais de compte :** consultez les journaux du pod de la tâche — la
  cause la plus fréquente est un `site_url` pointant vers une adresse
  injoignable (voir la tâche 2).
  ```bash
  kubectl logs -n "$NAMESPACE" job/"${SERVICE}-admin-bootstrap"
  ```
- **Plantage au démarrage avec « `REDIS_URL` / `REDIS_SENTINEL_HOSTS` / `REDIS_CLUSTER_HOSTS` must be defined » :**
  vérifiez que `enable_redis` a été correctement transmis et, si
  `redis_auth` est défini, que le secret Redis s'est propagé.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs IAM / Workload Identity :** vérifiez les rôles IAM du compte de service de la charge de travail
  et la liaison Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de ne jamais renouveler `ENCRYPTION_KEY` après le premier
démarrage, et l'exigence relative à `site_url` ci-dessus).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme
RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit
avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Delete supprime tout ce que le module a créé — la charge de travail GKE et son
Service, l'adresse IP statique réservée, la base de données Cloud SQL et les secrets Secret Manager.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, construit l'image personnalisée et exécute `db-init` |
| 2 — Accès et vérification | Manuel | La vérification d'état réussit ; définir `site_url` sur l'adresse IP externe, puis se connecter avec le mot de passe administrateur généré |
| 3 — Exploiter | Manuel | Inspecter les pods, mettre à l'échelle, mettre à jour la version, gérer les secrets/tâches, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques GKE/Cloud SQL et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de tâche d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
