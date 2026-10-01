---
title: "Vikunja sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Vikunja sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Vikunja_GKE.md @ 3055034 sha256:3509045495a8 -->

# Vikunja sur GKE Autopilot — Guide de lab {#vikunja-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Vikunja_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Vikunja est une application open source et auto-hébergée de gestion de tâches et de projets, avec
listes, tableaux kanban, diagrammes de Gantt, rappels et partage en équipe, via une API REST et
une interface web. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Vikunja on
GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Vikunja. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Vikunja_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
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
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Vikunja (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Vikunja_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`VIKUNJA_SERVICE_JWTSECRET` et le mot de passe de la base de données), construit l'image de
   conteneur personnalisée (en greffant un busybox statique sur l'image amont `scratch`) et
   exécute un job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep vikunja | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Vikunja expose un point de terminaison de santé public qui
   renvoie 200 dès que le serveur a lié son port et s'est connecté à PostgreSQL :

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"   # expect a JSON object such as {"database":true,...}
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, Vikunja affiche la page
   de connexion — cliquez sur **Register** et créez le premier compte. Le **premier compte
   enregistré devient le propriétaire de l'instance** ; aucun identifiant administrateur prédéfini n'existe dans
   Secret Manager. Une fois le compte propriétaire créé, désactivez l'inscription ouverte en
   définissant `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"` dans `environment_variables`
   et en l'appliquant via **Update**.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et le budget d'interruption de pods :

   ```bash
   kubectl get deploy,pods,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application). Notez
   que Vikunja utilise par défaut un seul réplica ; il ne dispose d'aucune coordination intégrée pour
   plusieurs réplicas simultanés.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace le pod.
   Vikunja exécute les éventuelles nouvelles migrations de schéma au démarrage.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~vikunja"
   kubectl get jobs -n "$NS"          # DB-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. vikunjademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^vikunja" --limit=1)
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

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (uptime check) (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Vikunja.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible `/health` ; un échec de connexion à PostgreSQL empêchera le pod de
  devenir Ready. Le point d'entrée journalise au démarrage l'hôte, le nom et l'utilisateur de la base résolus, ainsi que l'URL
  publique.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données / SSL :** sur GKE, le pod se connecte via le sidecar Cloud SQL
  Auth Proxy sur `127.0.0.1` avec `sslmode=disable`. Une erreur « SSL is not enabled on
  the server » signifie que le point d'entrée a exigé SSL sur l'interface de bouclage — vérifiez que le
  sidecar du proxy est présent et que le job d'initialisation s'est terminé.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image / le conteneur ne peut pas s'exécuter :** vérifiez que l'image personnalisée existe
  dans Artifact Registry (App_GKE impose `imagePullPolicy=Always`). Une image `prebuilt`
  `scratch` ne contient aucun shell et ne peut pas exécuter le point d'entrée.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle de ne jamais renouveler `VIKUNJA_SERVICE_JWTSECRET` après le premier
démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, construit l'image et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état réussit ; enregistrer le premier compte (propriétaire) dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
