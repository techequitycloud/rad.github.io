---
title: "Flarum sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Flarum sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Flarum_GKE.md @ 3055034 sha256:14598b54855f -->

# Flarum sur GKE Autopilot — Guide de lab {#flarum-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Flarum_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Flarum est une plateforme de forum et de discussion gratuite et open source : une alternative
moderne et extensible aux logiciels de forum traditionnels, construite en PHP
avec une interface JavaScript/Mithril. Ce lab vous fait parcourir l’intégralité du
cycle de vie opérationnel du module **Flarum on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer,
diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités du forum Flarum. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Flarum_GKE) :
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d’exécution et récupérer
  l’identifiant administrateur généré.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable : la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration, y compris les paramètres de mise à l’échelle et de version des tâches du jour 2, se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Flarum (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin : le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Flarum_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager (le
   `FLARUM_ADMIN_PASS` généré automatiquement ; le mot de passe de la base de données est géré
   séparément), un partage Cloud Filestore (NFS) pour les avatars et pièces jointes téléversés,
   un bucket Cloud Storage `flarum-assets`, construit l’image de conteneur (une fine
   surcouche `FROM mondedie/flarum`) et exécute un job ponctuel d’initialisation de la base
   de données. Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   représente l’essentiel du temps).

3. Connectez-vous au cluster et découvrez l’espace de noms à l’aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep flarum | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d’exécution et trouvez son adresse externe (une adresse IP statique
   est réservée par défaut ; elle survit donc aux redéploiements) :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Flarum sert la page d’accueil publique du forum
   sur `/` une fois installé et dès que la base de données est joignable :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Récupérez le mot de passe administrateur généré ; le nom d’utilisateur et
   l’adresse e-mail de l’administrateur sont fixés par le module à `admin` / `admin@techequity.cloud` et
   ne sont pas exposés comme paramètres de configuration :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~flarum AND name~admin-pass" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous avec `admin` et le
   mot de passe récupéré ci-dessus. **`FORUM_URL` est une lacune connue de cette variante :
   il n’est PAS défini automatiquement.** Définissez-le dès que l’adresse IP externe ou le domaine
   personnalisé est connu, sinon Flarum générera des liens absolus, des URL de ressources
   et des redirections incorrects :

   ```bash
   SERVICE_NAME=$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   kubectl patch deploy "$SERVICE_NAME" -n "$NAMESPACE" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"flarum","env":[
       {"name":"FORUM_URL","value":"http://'"${EXTERNAL_IP}"'"}]}]}}}}'
   ```

   Notez qu’un `kubectl patch` manuel est écrasé lors du prochain **Update** :
   définissez `FORUM_URL` de façon permanente via le paramètre `environment_variables` du module
   dès que vous connaissez l’adresse publique durable.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — Deployment et pods :

   ```bash
   kubectl get deploy,pods,pvc -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur la
   page de détails du déploiement : le module est propriétaire de la spécification de la charge de travail, la mise à l’échelle est donc
   une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). Conservez `max_instance_count` à `1` sauf si
   vous avez vérifié le comportement de Flarum avec plusieurs pods simultanés
   partageant le même volume NFS de ressources et la même base de données. L’affinité de session
   (`ClientIP`) est définie par défaut pour qu’un client soit toujours routé vers le même pod.

3. **Mettez à jour la version de l’application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l’appliquant via **Update** ; la valeur est
   transmise via l’ARG de build propre à l’application `FLARUM_VERSION` (et non via
   l’argument de version générique), une nouvelle image est construite et, comme la charge de travail
   s’appuie sur NFS, le déploiement utilise la stratégie **`Recreate`** (l’ancien pod
   s’arrête avant le démarrage du nouveau) plutôt qu’une mise à jour progressive, afin
   d’éviter que deux pods ne se bloquent mutuellement sur le volume NFS et la base de données partagés.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~flarum"
   kubectl get jobs -n "$NAMESPACE"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. flarumdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^flarum" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^flarum" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

6. **Vérifiez la persistance des ressources téléversées** — les avatars et pièces jointes résident sur
   Cloud Filestore (NFS) dans `/flarum/app/public/assets`, monté parce que
   `enable_nfs = true` par défaut, et partagé entre les pods :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur et de
   la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (lorsqu’il est activé) ; consultez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Flarum à l’autre.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de
  démarrage est un contrôle **TCP** sur le port 8888 avec une fenêtre généreuse d’environ 5 minutes
  (`failure_threshold=20`, `period_seconds=15`) pour laisser le temps à l’installateur
  du premier démarrage, et la sonde de vivacité (liveness) est un `GET /` HTTP avec un délai initial
  de 300 secondes.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** sur GKE, Flarum se connecte via le **sidecar Cloud
  SQL Auth Proxy sur `127.0.0.1:3306`** (`enable_cloudsql_volume =
  true`, requis dès qu’un véritable moteur de base de données est configuré). Vérifiez que
  l’instance Cloud SQL est `RUNNABLE`, que le conteneur sidecar est sain et que le
  job `db-init` s’est terminé.
- **Échec du job db-init :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```
- **Pod en attente (Pending) / pas d’adresse IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer dispose d’une
  adresse IP attribuée (`reserve_static_ip = true` par défaut la maintient stable d’un
  redéploiement à l’autre).
- **Liens cassés / ressources pointant vers le mauvais hôte :** vérifiez que `FORUM_URL`
  a été défini sur l’adresse IP externe réelle ou le domaine personnalisé : cette variante ne
  l’injecte pas automatiquement (voir la tâche 2, étape 4).
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.
- **Accès au compte administrateur perdu :** le secret `FLARUM_ADMIN_PASS` n’est
  lu qu’au premier démarrage ; le faire tourner ensuite ne modifie pas le mot de passe
  administrateur en vigueur : réinitialisez-le plutôt depuis l’interface d’administration de Flarum ou dans la base de données.

Consultez la section *Configuration Pitfalls* (pièges de configuration) du Guide de configuration pour les
pièges propres à chaque paramètre (notamment l’immuabilité de
`application_database_name`/`application_database_user` après le premier déploiement,
et les validations au moment du plan portant sur `enable_redis`/`redis_host`/`enable_nfs`
et `min_instance_count ≤ max_instance_count`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) : cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé : la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, le partage Filestore
(NFS), le bucket GCS `flarum-assets` et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), Filestore (NFS), le bucket de stockage, les secrets, et exécute db-init |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; récupération de `FLARUM_ADMIN_PASS`, connexion en tant que `admin` et définition de `FORUM_URL` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l’échelle, mettre à jour la version (déploiement Recreate), gérer les secrets/le stockage, accéder à la base, vérifier la persistance NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de db-init, de planification, de récupération d’image et de FORUM_URL |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
