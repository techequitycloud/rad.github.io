---
title: "Temporal sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Temporal sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Temporal_GKE.md @ 3055034 sha256:c40bf7fcb6dd -->

# Temporal sur GKE Autopilot — Guide de lab {#temporal-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Temporal_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Temporal est un moteur open source d'orchestration de workflows durables qui
assure une exécution fiable avec nouvelles tentatives automatiques, minuteurs,
signaux et requêtes — en s'appuyant sur PostgreSQL pour le stockage persistant
de l'historique des workflows. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Temporal on GKE Autopilot** sur Google Cloud : le
déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Temporal. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Temporal_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et vérifier la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL pour
  PostgreSQL, Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la
  plateforme détecte automatiquement s'il existe déjà dans le projet cible et,
  sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Temporal (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Temporal_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne deux
   bases de données Cloud SQL (PostgreSQL) (persistance principale et visibilité) avec leur
   secret Secret Manager, met en miroir l'image préconstruite `temporalio/auto-setup` dans
   Artifact Registry (aucun build personnalisé n'est exécuté) et démarre le serveur Temporal
   tout-en-un (qui gère automatiquement l'initialisation du schéma au premier
   démarrage). Les premiers déploiements prennent environ **10–20 minutes** (le provisionnement
   des nœuds Autopilot et l'initialisation du schéma en représentent l'essentiel).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep temporal | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et que le port gRPC du Frontend est joignable :

   ```bash
   kubectl get pods,svc -n "$NS"
   ```

   Tous les pods doivent être à l'état `Running`. Temporal expose son service Frontend sur
   le port **7233** (gRPC). Les sondes de santé sont de type TCP — il n'existe pas de point de
   terminaison de santé HTTP. Vérifiez que le pod a réussi sa sonde de démarrage en contrôlant qu'il est
   `Ready` :

   ```bash
   kubectl get pods -n "$NS" -o wide
   ```

2. L'interface web de Temporal (`temporalio/ui`) est déployée automatiquement par défaut
   (`deploy_temporal_ui = true`) en tant que service compagnon nommé `<service-name>-ui`.
   Établissez une redirection de port vers celui-ci et ouvrez `http://localhost:8080` dans votre navigateur :

   ```bash
   UI_SVC=$(kubectl get svc -n "$NS" -o name | grep -i ui | head -1 | cut -d/ -f2)
   kubectl port-forward svc/"$UI_SVC" 8080:8080 -n "$NS"
   ```

   Définissez `deploy_temporal_ui = false` avant le déploiement si vous ne voulez pas de l'interface web.

3. Vérifiez que le cluster Temporal est opérationnel depuis le pod admin-tools (s'il est
   déployé en tant que service compagnon) :

   ```bash
   ADMIN_POD=$(kubectl get pods -n "$NS" -o name | grep admintools | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$ADMIN_POD" -- temporal operator cluster health
   ```

   Résultat attendu : `SERVING`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et (s'ils sont activés) l'autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; le tag de la nouvelle image préconstruite est mis en miroir et une mise à jour progressive remplace les pods. Consultez le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Temporal_GKE) pour
   connaître le comportement de migration du schéma avant la mise à niveau.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~temporal"
   kubectl get jobs -n "$NS"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~temporal-temporal-db-password" --format="value(name)" --limit=1 \
     | sed 's/.*secret-//;s/-temporal-temporal-db-password//')
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

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et mémoire
   des pods, le nombre de redémarrages et les métriques de planification. Le module provisionne également un
   **contrôle de disponibilité** (uptime check, lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Temporal.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Expiration de la sonde de démarrage :** Temporal utilise une sonde TCP sur le port 7233. Si le pod
  redémarre sans cesse lors du premier déploiement, l'initialisation du schéma est peut-être encore en cours
  — la sonde de démarrage accorde jusqu'à 5 minutes. Recherchez `"msg":"Completed schema
  setup"` dans les journaux pour confirmer si l'initialisation s'est terminée.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données a été injecté dans le pod et que l'IP privée PostgreSQL est
  joignable depuis le cluster :
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud secrets list --project="$PROJECT" --filter="name~temporal"
  ```
- **Échec de l'initialisation du schéma :** l'image `temporalio/auto-setup` journalise toutes les étapes
  du schéma sur stdout — examinez les journaux du pod à la recherche d'erreurs liées à `temporal-sql-tool` ou à
  la connectivité PostgreSQL.
- **Pod en attente / aucune IP de service :** consultez les événements de `kubectl describe pod` à la recherche de problèmes
  de ressources ou de quota sur Autopilot, et vérifiez que le Service a le type attendu :
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de
  service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (dont le caractère immuable de `num_history_shards`).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, les bases de données et l'utilisateur Cloud SQL, le secret Secret Manager et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL
partagée, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, les bases de données Cloud SQL et le secret, et exécute l'initialisation du schéma |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le pod est prêt ; le Frontend gRPC sur le port 7233 est joignable |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de sonde de démarrage, de base de données, d'initialisation du schéma, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
