---
title: "Memos sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Memos sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Memos_GKE.md @ 3055034 sha256:13d206bc4083 -->

# Memos sur GKE Autopilot — Guide de lab {#memos-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Memos_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Memos est un service de prise de notes open source, auto-hébergé et nativement Markdown, conçu pour
la capture rapide. Ce lab vous fait parcourir tout le cycle de vie opérationnel du
module **Memos on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Memos. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Memos_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution, la vérifier et créer le premier compte (administrateur).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les sauvegardes.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Memos (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Memos_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail Kubernetes, une base de données Cloud SQL (PostgreSQL)
   avec son secret de mot de passe dans Secret Manager, construit l'image de conteneur
   et exécute un Job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **15 à 25 minutes** (la création de Cloud SQL représente l'essentiel du temps ; le build de l'image et le démarrage de Memos lui-même sont
   rapides — un unique petit binaire Go).

3. Une fois l'opération terminée, identifiez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep memos | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est sain et qu'il répond :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Ouvrez `http://$EXTERNAL_IP/` dans un navigateur (ou utilisez `kubectl port-forward` si
   `service_type = "ClusterIP"`). Memos affiche sa page d'inscription/de connexion. **Créez le
   premier compte** — la première personne qui s'inscrit devient automatiquement l'hôte/administrateur. Après l'avoir créé, rédigez votre première
   note pour confirmer l'aller-retour avec la base de données (la note persiste après actualisation — preuve
   que le câblage de `MEMOS_DSN` et le job `db-init` ont fonctionné). Envisagez ensuite de désactiver l'inscription
   publique en libre-service depuis les propres paramètres de Memos.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement progressif :**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   kubectl describe hpa -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle est
   une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application, sauf si elle ne sert que de mesure temporaire de démantèlement —
   voir la tâche 6).

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour
   progressive la déploie. `Memos_Common` fait correspondre `"latest"` à un argument de build `MEMOS_VERSION` épinglé ;
   définissez donc une version explicite (par exemple `0.28.0`) pour suivre une version amont précise.

4. **Gérez les sauvegardes :**

   ```bash
   kubectl get jobs -n "$NAMESPACE"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. memosdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^memos" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads du déploiement et examinez
   le nombre de requêtes, l'utilisation CPU / mémoire et le nombre de réplicas (comportement de mise à l'échelle).
   Le module peut provisionner un **test de disponibilité** (lorsque `uptime_check_config.enabled
   = true`, ce qui n'a de sens qu'avec un Service `LoadBalancer` accessible publiquement) ; s'il est
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Memos.

- **Pod non sain / CrashLoopBackOff :** examinez les événements et les journaux du pod à la recherche
  d'erreurs de démarrage. La sonde de démarrage cible `/` avec un délai
  initial de 30 secondes.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Erreurs de connexion à la base de données (échecs d'analyse de `MEMOS_DSN`, échecs d'authentification) :**
  vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base a été synchronisé via
  SecretSync et que le Job d'initialisation s'est terminé. Recherchez dans les journaux du conteneur
  la bannière de démarrage de `memos-entrypoint.sh` (`DB host:`/`DB name:`/`DB user:`) —
  sur GKE, `DB host` doit se résoudre en `127.0.0.1`.
- **Échec du Job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build en échec —
  une cause fréquente est un `MEMOS_VERSION` résolu vers un tag qui n'existe pas en amont.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity et les
  rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment le comportement « le premier compte devient administrateur » et le
compromis lié à `container_image_source`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes,
le Service, la base de données Cloud SQL, le secret Secret Manager et les images d'Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL) et le secret du mot de passe de la base, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Pod Ready avec 0 redémarrage ; créer le premier compte (administrateur) dans l'interface et rédiger une note |
| 3 — Exploiter | Manuel | Inspecter le déploiement progressif, mettre à l'échelle, mettre à jour la version, gérer les sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
