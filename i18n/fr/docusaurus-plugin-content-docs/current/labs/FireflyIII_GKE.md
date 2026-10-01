---
title: "Firefly III sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Firefly III sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/FireflyIII_GKE.md @ 3055034 sha256:cf0d4308faf0 -->

# Firefly III sur GKE Autopilot — Guide de lab {#firefly-iii-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FireflyIII_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Firefly III est un gestionnaire de finances personnelles gratuit, open source et auto-hébergé, qui permet de suivre
des comptes, des transactions, des budgets, des factures et des transactions récurrentes. Ce lab vous fait parcourir
l’intégralité du cycle de vie opérationnel du module **Firefly III on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer,
diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Firefly III. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/FireflyIII_GKE) : ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu’il provisionne.
- Accéder à la charge de travail en cours d’exécution, la vérifier, définir `APP_URL` et créer le premier compte administrateur.
- Effectuer les opérations du jour 2 : inspecter les pods, mettre à l’échelle, mettre à jour, gérer les secrets et les sauvegardes, et raccorder le point de terminaison cron.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable : la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** authentifiés : `gcloud auth login`,
  `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration, y compris les paramètres de mise à l’échelle et de version des tâches du jour 2, se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<workload-namespace>"   # from the deployment Outputs
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Firefly III (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin : le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/FireflyIII_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE Autopilot (Deployment + Service
   LoadBalancer), une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (l’`APP_KEY`
   de Laravel, le `STATIC_CRON_TOKEN` et le mot de passe de la base de données), un bucket Cloud
   Storage pour les téléversements, un volume NFS/Filestore pour les pièces jointes, et exécute un job ponctuel
   `db-init`. Les premiers déploiements prennent environ **20–35 minutes**. Le schéma est créé au
   premier démarrage du conteneur, et non par un job de migration distinct.

3. Récupérez les identifiants du cluster et découvrez les ressources :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Une fois l’adresse IP du LoadBalancer attribuée, **définissez `APP_URL`** sur l’hôte externe afin que
   Firefly III construise des liens absolus corrects. Faites-le via `application_domains` /
   `environment_variables` et **Update**, ou modifiez le Deployment :

   ```bash
   SVC=$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   kubectl patch deploy "$SVC" -n "$NAMESPACE" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"fireflyiii","env":[
       {"name":"APP_URL","value":"http://'"$EXTERNAL_IP"'"}
     ]}]}}}}'
   ```

2. Confirmez que la charge de travail est saine via le point de terminaison `/status` non authentifié :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://$EXTERNAL_IP/status"   # expect 200
   ```

3. Ouvrez l’URL dans un navigateur. Firefly III affiche la page **`/register`** : le **premier
   compte créé devient le propriétaire/administrateur du site**. Après l’avoir créé, ouvrez
   **Administration → Settings** et désactivez les inscriptions ultérieures.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les pods et les événements :**

   ```bash
   kubectl get pods -n "$NAMESPACE"
   kubectl describe pod -n "$NAMESPACE" -l app="$SVC"
   kubectl logs -n "$NAMESPACE" deploy/"$SVC" --tail=100
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** : le
   module est propriétaire de la spécification du Deployment. GKE exige au moins 1 réplique ; il n’y a pas de
   mise à l’échelle à zéro. `session_affinity = ClientIP` maintient la session d’un utilisateur sur un seul pod.

3. **Mettez à jour la version de l’application** dans la plateforme RAD et appliquez via **Update** ; une
   mise à jour progressive remplace le pod et l’image migre elle-même le schéma au démarrage.

4. **Raccordez le point de terminaison cron** afin que les transactions récurrentes, les rappels de factures et
   les budgets automatiques se déclenchent. Lisez le jeton et déclenchez-le manuellement, puis créez un
   CronJob Kubernetes quotidien (ou utilisez le paramètre `cron_jobs`) :

   ```bash
   CRON_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~cron-token" --format="value(name)" --limit=1)
   TOKEN=$(gcloud secrets versions access latest --secret="$CRON_SECRET" --project="$PROJECT")
   curl -s "http://$EXTERNAL_IP/api/v1/cron/$TOKEN"
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. fireflyiiidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^fireflyiii" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** : depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Surveillance** : ouvrez le tableau de bord de la charge de travail GKE et examinez le processeur et la mémoire des pods,
   les redémarrages et la latence des requêtes. Examinez les métriques Cloud SQL relatives aux connexions et au processeur. Si
   vous avez activé un test de disponibilité, vérifiez qu’il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Firefly III à l’autre.

- **Pod non Ready / CrashLoopBackOff :** examinez le pod et les journaux pour repérer des erreurs de démarrage et
  vérifiez que les secrets et variables d’environnement ont été résolus. La sonde de démarrage est en TCP sur le port 8080 ; la sonde
  de vivacité (liveness) cible `/status`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SVC"
  kubectl logs -n "$NAMESPACE" deploy/"$SVC" --previous --tail=100
  ```
- **Erreurs de connexion à la base de données :** sur GKE, la connexion passe par la boucle locale via le sidecar Cloud
  SQL Auth Proxy (`DB_HOST = 127.0.0.1`, `PGSQL_SSL_MODE = prefer`). Imposer
  `require` échoue avec « SSL is not enabled on the server ». Vérifiez que le sidecar est
  en cours d’exécution et que `db-init` s’est terminé.
- **Échec du job d’initialisation :** `kubectl get jobs -n "$NAMESPACE"`, puis lisez les journaux du pod du job
  qui a échoué.
- **Liens absolus / redirections incorrects :** vérifiez que `APP_URL` est défini sur l’hôte externe.
- **Les transactions récurrentes ne se déclenchent pas :** vérifiez qu’un CronJob quotidien appelle
  `/api/v1/cron/<STATIC_CRON_TOKEN>`.
- **Les pièces jointes téléversées disparaissent :** vérifiez que `enable_nfs = true` et que le volume NFS
  est monté sur `/var/lib/fireflyiii`.

Consultez la section *Configuration Pitfalls* (pièges de configuration) du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle de ne jamais faire tourner `APP_KEY` après le premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) : cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé : la charge de travail GKE
et son Service, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, le volume NFS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de téléversements, NFS, et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Définir `APP_URL` ; `/status` renvoie 200 ; création du compte propriétaire sur `/register` |
| 3 — Exploiter | Manuel | Inspecter les pods, mettre à l’échelle, mettre à jour la version, raccorder le cron, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d’initialisation, d’URL, de cron et de NFS |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
