---
title: "Healthchecks sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Healthchecks sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Healthchecks_GKE.md @ 3055034 sha256:a79505c030a1 -->

# Healthchecks sur GKE Autopilot — Guide de lab {#healthchecks-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Healthchecks_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Healthchecks est un service open source et auto-hébergé de surveillance des tâches cron et des
signaux de vie (heartbeat) : les tâches planifiées lui envoient un « ping » en cas de succès, et il vous alerte lorsqu'un ping est
en retard ou absent. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel
du module **Healthchecks on GKE Autopilot** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Healthchecks. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Healthchecks_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution, la vérifier et vous connecter avec le compte administrateur pré-créé.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, le réseau Cloud SQL,
  Artifact Registry et les comptes de service partagés dont dépend ce
  module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
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
export NAMESPACE="<namespace-from-outputs>"
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Healthchecks (GKE)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Healthchecks_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE (un Deployment à réplica unique), une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`SECRET_KEY`, `ADMIN_PASSWORD` et le mot de passe de la base de données), un
   Service LoadBalancer avec une IP statique réservée, et exécute deux Jobs Kubernetes
   ponctuels : `db-init` (crée la base de données et le rôle) et
   `admin-bootstrap` (exécute les migrations et crée le compte superutilisateur
   initial). Les premiers déploiements prennent environ **20–30 minutes** (la création de Cloud SQL
   en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE" -l app~healthchecks 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "Service IP: $SERVICE_IP"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est `1/1 Running` avec 0 redémarrage, et que la charge de travail
   sert la page de connexion (Healthchecks n'a pas de point de terminaison de santé dédié — la
   page racine est le signal public, sans authentification) :

   ```bash
   kubectl get pods -n "$NAMESPACE"
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "http://$SERVICE_IP/"
   # expect 200 (or a redirect in the 300 range) and a non-zero body size
   ```

2. Récupérez l'identifiant administrateur pré-créé et connectez-vous :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~healthchecks-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Ouvrez `http://$SERVICE_IP` dans un navigateur, connectez-vous avec `admin_email` (par défaut
   `admin@techequity.cloud`) et le mot de passe ci-dessus. Vous devriez arriver sur le
   tableau de bord des checks, vide.

3. Créez un check de test depuis l'interface et vérifiez qu'il apparaît dans le tableau de bord —
   cela prouve que le chemin d'écriture en base de données fonctionne de bout en bout.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail :**

   ```bash
   kubectl describe deploy -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
   ```

2. **Pas de souci de mise à l'échelle jusqu'à zéro sur GKE.** Contrairement à la variante Cloud Run, un
   Deployment GKE exécute simplement son nombre de réplicas en continu, si bien que la boucle d'alerte
   `sendalerts`/`sendreports`, colocalisée, est toujours active sans aucune
   configuration particulière.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans
   la plateforme RAD et en l'appliquant via **Update** ; un nouveau déploiement progressif utilise la
   même image officielle `healthchecks/healthchecks` au nouveau tag.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~healthchecks"
   kubectl get jobs -n "$NAMESPACE"   # db-init + admin-bootstrap
   ```

5. **Configurez un véritable envoi d'e-mails sortants** (nécessaire pour que les alertes soient réellement
   distribuées) : définissez `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER` via
   `environment_variables` et `EMAIL_HOST_PASSWORD` via
   `secret_environment_variables`, puis appliquez.

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

1. **Journaux** — le même flux de journaux contient à la fois le serveur web ET les
   workers d'arrière-plan `sendalerts`/`sendreports` (ils s'exécutent dans le même
   conteneur) :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project "$PROJECT" --limit 50
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads et examinez l'utilisation du CPU/de la mémoire
   et le nombre de redémarrages. Le module peut provisionner un **test de
   disponibilité** (uptime check) (désactivé par défaut) ; s'il est activé, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Healthchecks.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux du pod à la recherche
  d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  kubectl logs -n "$NAMESPACE" <pod-name> --previous
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le Job `db-init` s'est terminé
  avec succès (`kubectl get jobs -n "$NAMESPACE"`).
- **La page de connexion se charge mais les données sont réinitialisées au redémarrage :** vérifiez que la variable d'environnement `DB`
  a bien été résolue en `"postgres"` sur le pod en cours d'exécution, et non vers le repli
  SQLite de l'image :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep '^DB='
  ```
- **Impossible de se connecter avec l'identifiant pré-créé :** vérifiez que le Job `admin-bootstrap`
  s'est bien terminé (il dépend de l'achèvement préalable de `db-init` — sur GKE,
  l'ordonnancement des tâches d'initialisation ne conditionne que l'attente de Terraform, pas la planification Kubernetes ; une
  situation de concurrence est donc possible lors d'un tout premier déploiement) :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-bootstrap-job-name>
  ```
- **Les alertes n'arrivent jamais :** très probablement une configuration SMTP absente ou laissée à sa
  valeur d'espace réservé, et non un bug de la plateforme — recherchez dans les journaux du pod des erreurs de connexion
  SMTP provenant de `sendalerts`.
- **Échec de la construction de l'image :** ce module déploie l'image officielle préconstruite
  avec `container_image_source = "prebuilt"` — il ne devrait y avoir aucune étape de build
  Kaniko. Si vous voyez un échec Cloud Build, vérifiez si
  `container_image_source` a été redéfini par erreur à `"custom"`.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity et les
  rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud. Cela
supprime tout ce que le module a créé — la charge de travail Kubernetes, la base de données Cloud SQL,
les secrets Secret Manager et l'IP statique réservée. Les ressources appartenant
à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le LoadBalancer, et exécute `db-init` + `admin-bootstrap` |
| 2 — Accès et vérification | Manuel | Pod Ready ; la page de connexion se charge ; se connecter avec l'identifiant administrateur pré-créé ; créer un check de test |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à jour la version, gérer les secrets, configurer SMTP, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques GKE/Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de moteur de base de données, d'admin-bootstrap et de SMTP |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
