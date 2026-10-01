---
title: "Spoolman sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Spoolman sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Spoolman_GKE.md @ 3055034 sha256:9a583f27a218 -->

# Spoolman sur GKE Autopilot — Guide de lab {#spoolman-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Spoolman_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–45 minutes

Spoolman est un outil open source de suivi de l'inventaire et de la consommation des bobines de filament
pour l'impression 3D. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Spoolman on GKE Autopilot** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Spoolman. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Spoolman_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Spoolman (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Spoolman_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot et
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec son secret de mot de passe
   dans Secret Manager, en récupérant directement l'image préconstruite `ghcr.io/donkie/spoolman`
   — il n'y a aucune étape Cloud Build ni aucun job d'initialisation de la base de données
   à attendre (Spoolman effectue lui-même ses migrations au démarrage). Les premiers déploiements prennent environ
   **15 à 25 minutes** (la création de Cloud SQL représente l'essentiel de ce temps).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep spoolman | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain :

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/health"   # expect a 200/OK JSON status
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Spoolman n'a **aucune barrière de connexion** —
   l'interface s'ouvre directement sur le tableau de bord de l'inventaire des bobines, sans compte
   administrateur à créer. Si vous devez restreindre l'accès, appliquez dès maintenant IAP ou une liste
   d'autorisation Cloud Armor, avant de partager l'IP avec qui que ce soit.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le deployment et les pods :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est maître de la spécification de la charge de travail ;
   la mise à l'échelle est donc une modification de configuration, et non un `kubectl scale` manuel (une
   modification manuelle serait annulée lors du prochain apply). Spoolman n'exécute aucune tâche en
   arrière-plan ; la mise à l'échelle jusqu'à zéro (`min_instance_count = 0`) est donc sans risque à tout moment.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; Kubernetes récupère la nouvelle étiquette
   directement depuis `ghcr.io/donkie/spoolman` et effectue une mise à jour progressive — aucune
   reconstruction n'est nécessaire puisqu'il s'agit d'une image réellement préconstruite.

4. **Gérez les secrets :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~spoolman"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. spoolmandemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^spoolman" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods ainsi que le nombre de redémarrages. Le module peut provisionner un
   **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Spoolman.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage
  et de vivacité ciblent toutes deux `/api/health` avec un court délai initial —
  Spoolman démarre rapidement, puisqu'il n'y a aucun job distinct de migration de schéma
  à attendre.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE` et que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms.
  Comme il n'y a pas de job d'initialisation, cette catégorie de défaillance apparaît directement dans les
  journaux de démarrage du pod lui-même.
- **L'application fonctionne mais affiche un inventaire vide, en utilisant SQLite au lieu de Postgres :**
  vérifiez si `SPOOLMAN_DB_TYPE=postgres` a été accidentellement remplacé ou
  supprimé dans `environment_variables` :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -i spoolman_db
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` à la recherche de
  problèmes de ressources ou de quotas, et vérifiez qu'une IP a été attribuée au Service
  LoadBalancer.
- **Erreurs de récupération d'image :** vérifiez que l'image existe (ou est correctement mise en miroir) dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris l'absence d'authentification intégrée).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé —
la charge de travail Kubernetes et son espace de noms, la base de données Cloud SQL et les secrets
Secret Manager. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le
Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE et Cloud SQL (PostgreSQL 15) avec son secret de mot de passe ; sans build ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; l'interface se charge directement, sans barrière de connexion |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de repli du moteur de base de données et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
