---
title: "FreeScout sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez FreeScout sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démontage."
---

<!-- translated-from: docs/labs/FreeScout_GKE.md @ 3055034 sha256:2f57b0aac9a6 -->

# FreeScout sur GKE Autopilot — Guide de lab {#freescout-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreeScout_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

FreeScout est une plateforme gratuite et auto-hébergée de help desk et de boîte
mail partagée, construite sur Laravel (PHP) — elle transforme des boîtes de
réception partagées en une file de tickets collaborative avec conversations,
étiquettes, réponses enregistrées et une API REST. Ce lab vous fait parcourir
l'ensemble du cycle de vie opérationnel du module **FreeScout on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants, puis le démonter.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit FreeScout. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreeScout_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours
  d'exécution, y compris au compte administrateur créé automatiquement au premier lancement.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous
  n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **FreeScout (GKE)**
   dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/FreeScout_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL for **MySQL 8.0** avec ses secrets
   Secret Manager (la clé Laravel `APP_KEY`, le mot de passe `ADMIN_PASS`
   initial et le mot de passe de la base de données), un montage NFS Filestore
   pour les pièces jointes (activé par défaut), un bucket Cloud Storage pour les
   fichiers téléversés, construit l'image de conteneur personnalisée minimale
   (`FROM tiredofit/freescout`) et exécute un job ponctuel d'initialisation
   de la base de données. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL représente l'essentiel de ce
   temps).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep freescout | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service répond. FreeScout ne dispose pas de point de
   terminaison de santé JSON dédié — un pod en bonne santé renvoie la page de
   connexion (HTTP 200) ou une redirection vers celle-ci sur `GET /` :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200 (or 302 to login)
   ```

3. FreeScout crée automatiquement un administrateur au premier lancement — il
   n'y a aucune étape d'inscription manuelle. Récupérez le mot de passe
   administrateur généré dans Secret Manager et connectez-vous avec l'adresse
   `ADMIN_EMAIL` par défaut (`admin@techequity.cloud` sauf si elle a été
   remplacée) :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freescout AND name~admin" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous avec
   cette adresse e-mail et ce mot de passe. **Changez immédiatement le mot de
   passe dans l'interface** — la valeur générée n'existe que dans Secret
   Manager, et cette modification côté application vous donne un identifiant
   détenu par une personne.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'état des PVC et du stockage :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances et en cliquant sur **Update** sur la page de détails du
   déploiement — le module est propriétaire de la spécification de la charge de
   travail : la mise à l'échelle est donc une modification de configuration, et
   non un `kubectl scale` manuel (une modification manuelle serait annulée lors
   de l'application suivante). FreeScout utilise par défaut
   `min_instance_count = 1` et `max_instance_count = 1` (toujours au moins un
   pod, ce qui garde le point de terminaison du help desk joignable) —
   conservez le maximum à 1 tant que le fonctionnement multi-pods sur le NFS et
   la base de données partagés n'a pas été confirmé comme sûr. L'affinité de
   session (`ClientIP`) est définie par défaut pour que les requêtes d'un
   client restent sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update**. Comme
   FreeScout s'appuie sur NFS, la fondation utilise une stratégie de
   déploiement `Recreate` — l'ancien pod est entièrement arrêté avant le
   démarrage du nouveau (ce qui évite que deux pods se disputent le même volume
   NFS et la même base de données) ; attendez-vous donc à une courte
   interruption pendant une mise à jour plutôt qu'à un remplacement progressif
   sans interruption. L'image `tiredofit/freescout` exécute
   `php artisan migrate --force` à chaque démarrage du conteneur : les
   modifications de schéma s'appliquent donc automatiquement au démarrage.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~freescout"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

   **Ne faites jamais tourner le secret `APP_KEY` après le premier démarrage** —
   il chiffre les données de session et des colonnes chiffrées de la base de
   données (identifiants de boîtes mail stockés, jetons OAuth) ; le faire
   tourner invalide définitivement toutes les données chiffrées auparavant.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~freescout" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. freescoutdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freescout" --limit=1)
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

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du processeur et de la mémoire des pods, le nombre de
   redémarrages et les métriques de requêtes. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsqu'il est activé) ; examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme,
qui ne changent pas d'une version de FreeScout à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les
  journaux. La sonde de démarrage est une sonde TCP sur le port du conteneur
  (délai de 30 s, 20 échecs) et la sonde de vivacité est une requête HTTP
  `GET /` (délai initial de 300 s) — prévoyez plusieurs minutes lors du premier
  démarrage, pendant l'exécution des migrations.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Échecs de migration au démarrage :** `php artisan migrate --force`
  s'exécute à chaque démarrage du conteneur (il n'existe pas de job de
  migration distincte) ; une migration en échec se manifeste par une boucle de
  plantage sur le pod — lisez les journaux du conteneur ci-dessus pour trouver
  l'erreur Laravel/PDO.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE` et que le sidecar Cloud SQL Auth Proxy est en bonne santé —
  GKE atteint MySQL via l'adresse de bouclage du proxy (`127.0.0.1:3306`), et
  non directement via l'adresse IP privée.
  ```bash
  kubectl logs -n "$NS" <pod> -c cloud-sql-proxy
  ```
- **Échec du job db-init :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **La mise à jour semble « bloquée » :** comme FreeScout utilise un
  déploiement `Recreate` (stockage NFS), l'ancien pod est entièrement arrêté
  avant que le nouveau soit planifié — une brève fenêtre à `0/1` Ready pendant
  une mise à jour est attendue, il ne s'agit pas d'un blocage.
- **Pièces jointes / fichiers téléversés qui disparaissent :** vérifiez que
  `enable_nfs = true` (la valeur par défaut) et consultez
  `kubectl get pvc,pv -n "$NS"` — sans NFS, les fichiers téléversés ne sont pas
  partagés entre les pods ni conservés lors d'une replanification.
- **Pod en attente (Pending) / pas d'adresse IP externe :** consultez les
  événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer dispose d'une adresse IP
  attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment la règle essentielle de ne
jamais faire tourner
`APP_KEY` après le premier démarrage, et la raison pour laquelle `database_type` doit rester `MYSQL_8_0`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), le NFS Filestore, les secrets et un bucket de stockage, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; se connecter avec le compte administrateur créé automatiquement et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version (déploiement Recreate), gérer les secrets et le stockage (ne jamais faire tourner `APP_KEY`), accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de migration, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
