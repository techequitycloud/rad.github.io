---
title: "Penpot sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Penpot sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Penpot_CloudRun.md @ 3055034 sha256:10fd6c9c0f51 -->

# Penpot sur Cloud Run — Guide de lab {#penpot-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Penpot_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Penpot est une plateforme open source de design et de prototypage — une alternative auto-hébergée à
Figma — qui offre l'édition de designs vectoriels, le prototypage interactif, les bibliothèques de composants
et la collaboration multijoueur en temps réel. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Penpot on Cloud Run** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Penpot. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Penpot_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder aux trois services en cours d'exécution (backend, frontend, exporter) et les vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer les services avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry, Redis/NFS
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Penpot (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Penpot_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne trois services Cloud Run coordonnés (backend, frontend,
   exporter), une base de données Cloud SQL PostgreSQL avec ses secrets Secret Manager, un bucket GCS
   pour les ressources, éventuellement NFS/Redis, construit les images de conteneur et exécute un job ponctuel
   d'initialisation de la base de données. Le backend Penpot exécute ensuite ses propres migrations
   PostgreSQL au premier démarrage — prévoyez jusqu'à 60 à 120 secondes pour le démarrage de la JVM et
   la migration. Les premiers déploiements prennent environ **25 à 40 minutes** (la création de Cloud SQL
   représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les services avec des filtres indépendants des noms :

   ```bash
   # Frontend service — the user-facing entry point
   FRONTEND_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot AND metadata.name~frontend" \
     --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$FRONTEND_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")

   # Backend and exporter services
   BACKEND_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot AND metadata.name~backend" \
     --format="value(metadata.name)" --limit=1)
   EXPORTER_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot AND metadata.name~exporter" \
     --format="value(metadata.name)" --limit=1)

   echo "Frontend: $FRONTEND_SVC  URL: $SERVICE_URL"
   echo "Backend:  $BACKEND_SVC"
   echo "Exporter: $EXPORTER_SVC"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que les trois services sont sains :

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot"
   ```

2. Vérifiez que le point de terminaison de santé de l'API backend répond :

   ```bash
   # The backend health endpoint — expect HTTP 200
   BACKEND_URL=$(gcloud run services describe "$BACKEND_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   curl -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/health"
   ```

3. Vérifiez que le frontend est accessible à l'URL du service :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL"
   ```

   Ouvrez `$SERVICE_URL` dans un navigateur. Si `penpot_flags` inclut
   `enable-registration` (la valeur par défaut), l'auto-inscription est disponible. Sinon,
   un administrateur crée les comptes directement dans Penpot. Aucun identifiant administrateur
   n'est stocké dans Secret Manager — Penpot gère ses propres comptes utilisateur.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les trois services et leurs révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot"
   gcloud run revisions list --service="$BACKEND_SVC" \
     --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Maintenez
   `min_instance_count` à 1 ou plus ; la mise à l'échelle à zéro met fin aux sessions WebSocket
   actives et impose un démarrage à froid de la JVM de 60 à 120 secondes lors de la reconnexion.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; de nouvelles images sont construites pour les trois services et de nouvelles révisions sont déployées.
   Les trois services doivent utiliser le même tag de version.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~penpot"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. penpotdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^penpot" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$BACKEND_SVC" \
     --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$EXPORTER_SVC" \
     --project="$PROJECT" --region="$REGION" --limit=20
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run et examinez chacun des trois
   services séparément : nombre de requêtes, latence des requêtes (P50/P95/P99), nombre
   d'instances (comportement de mise à l'échelle) et utilisation CPU/mémoire. Le module provisionne également
   un **test de disponibilité** (uptime check) sur `/api/health` ; vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Penpot.

- **Révision non saine / le service ne répond pas :** le backend utilise une sonde de démarrage HTTP
  sur `/api/health` et peut mettre 60 à 120 secondes à la réussir au premier démarrage (initialisation
  de la JVM + migration PostgreSQL). Inspectez les journaux et vérifiez que la révision est devenue
  saine :
  ```bash
  gcloud run revisions list --service="$BACKEND_SVC" \
    --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$BACKEND_SVC" \
    --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et
  que le secret du mot de passe de la base existe. Penpot exécute ses propres migrations au démarrage — un
  échec de migration apparaît dans les journaux du backend avant que le service ne devienne sain.
- **Collaboration en temps réel / WebSocket défaillante :** Redis est obligatoire pour la diffusion WebSocket
  entre les réplicas du backend. Vérifiez la connectivité à Redis et que
  `enable_redis = true`. Recherchez des erreurs de connexion Redis dans les journaux du backend.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
  Les images des trois services doivent être présentes dans Artifact Registry avant que Cloud Run
  puisse déployer.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution et
  que la stratégie du bucket GCS de ressources accorde `storage.objectAdmin` au compte de service Cloud Run.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment `container_protocol = "h2c"` et le dimensionnement du tas JVM).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — les trois services
Cloud Run, la base de données Cloud SQL PostgreSQL, les secrets Secret Manager, le bucket GCS
de ressources, le NFS et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne trois services Cloud Run, Cloud SQL, un bucket GCS, les secrets et le NFS |
| 2 — Accéder et vérifier | Manuel | Les trois services sont sains ; le frontend est accessible ; `/api/health` du backend renvoie 200 |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging par service ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données/migration, de WebSocket/Redis, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
