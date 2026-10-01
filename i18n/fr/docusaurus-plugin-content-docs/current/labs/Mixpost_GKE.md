---
title: "Mixpost sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Mixpost sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Mixpost_GKE.md @ 3055034 sha256:96a8eb744b5b -->

# Mixpost sur GKE Autopilot — Guide de lab {#mixpost-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Mixpost_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Mixpost est une plateforme open source et auto-hébergée de planification et de gestion des
réseaux sociaux — une alternative à Buffer/Hootsuite pour rédiger, planifier, publier
et analyser des publications sur plusieurs comptes sociaux depuis un seul tableau de bord. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Mixpost on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Mixpost. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Mixpost_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Comprendre pourquoi cette variante maintient en permanence au moins un pod en cours d'exécution, et ce
  que cela implique pour la publication planifiée.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  l'hôte NFS/Redis, Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Mixpost (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Mixpost_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot (l'image préconstruite
   `inovector/mixpost` — sans build personnalisé), provisionne une base de données Cloud SQL
   (MySQL 8.0) avec ses secrets Secret Manager (la `APP_KEY` de Laravel
   et le mot de passe de la base), un bucket Cloud Storage, réplique l'image
   préconstruite dans Artifact Registry et exécute un job ponctuel `db-init` qui crée
   la base de données et l'utilisateur de l'application via le sidecar Cloud SQL Auth Proxy. Les premiers
   déploiements prennent environ **15 à 30 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep mixpost | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Les sondes de démarrage et de vivacité au niveau du pod sont toutes deux des sondes **TCP sur le port 80**
   (Mixpost répond à `/` par une redirection `302` qu'une sonde HTTP du kubelet
   suivrait sinon jusqu'à une impasse sur `:443`) ; un pod `1/1 Running` est donc ici
   le bon signal de santé, plutôt que le résultat d'une sonde HTTP.

2. Vérifiez que le service répond :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200 or 302
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous. Le compte administrateur de Mixpost
   est **créé par l'image elle-même** et n'est pas configurable via ce
   module — le paramètre `mixpost_admin_email` est déclaré mais n'est pas actuellement
   injecté dans le conteneur en cours d'exécution. Utilisez les identifiants de première connexion
   par défaut documentés pour l'image (`admin@example.com` / `changeme`) et **changez le
   mot de passe immédiatement** après la première connexion.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et les PVC :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, donc la mise à l'échelle est une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).
   L'affinité de session (`ClientIP`) est définie par défaut pour maintenir un client sur le
   même pod. Comme la charge de travail est adossée au NFS, les mises à jour sont déployées avec la stratégie
   `Recreate` (l'ancien pod est arrêté avant que le nouveau ne démarre) afin
   d'éviter que deux pods ne se bloquent mutuellement sur le volume NFS et la base de données partagés.

3. **Comprenez pourquoi cette variante est toujours active par défaut.** Contrairement à la configuration
   par défaut à démarrage à froid de la variante Cloud Run, ce module conserve `min_instance_count = 1` —
   au moins un pod est toujours en cours d'exécution, si bien que le planificateur Laravel et le worker
   de file d'attente gérés par supervisord publient les publications sociales planifiées sans aucun
   raccordement externe à Cloud Scheduler. Réduire cette valeur à `0` arrête complètement la publication
   planifiée ; ne le faites pas si la publication planifiée est utilisée.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est récupérée et le pod est recréé —
   il n'existe pas de job de migration distinct, puisque l'image exécute
   `php artisan migrate --force` à chaque démarrage.

5. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~mixpost"
   kubectl get jobs -n "$NS"          # db-init job
   ```

6. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. mixpostdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^mixpost" --limit=1)
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

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Mixpost.

- **Pod non Ready / boucle de redémarrage alors que l'application répond correctement sur `:80` :**
  vérifiez que `startup_probe_config` / `health_check_config` sont toujours `type =
  "TCP"` — les basculer en HTTP réintroduit le piège de la redirection 302 (la
  sonde HTTP du kubelet suit la redirection de Mixpost vers `https://<pod-ip>:443`,
  où rien n'écoute).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Le job `db-init` reste bloqué indéfiniment :** vérifiez que `enable_cloudsql_volume = true`
  (requis sur GKE). Le désactiver fait que la requête POST d'arrêt `quitquitquit` du job
  manque le sidecar Auth Proxy pas encore démarré, ce qui bloque le job indéfiniment.
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`
  et que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms via le pilote
  Secret Store CSI.
- **Les publications planifiées ne sont pas publiées :** vérifiez que `min_instance_count >= 1` — réduire
  à `0` arrête le planificateur et le worker de file d'attente intégrés au pod.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP
  (`reserve_static_ip = true` la maintient stable entre les redéploiements).
- **Identifiants de connexion inconnus / « admin account not configured » :** le compte
  administrateur est créé par l'image elle-même, et non par la variable
  `mixpost_admin_email` de ce module — utilisez les identifiants par défaut documentés pour l'image.
- **Erreurs de récupération d'image :** vérifiez que l'image répliquée existe dans Artifact Registry
  et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais
renouveler `APP_KEY` après le premier démarrage, et l'immuabilité de
`application_database_name` / `application_database_user`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, l'hôte NFS/Redis, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), les secrets et un bucket de stockage, puis exécute `db-init` via le sidecar Auth Proxy |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; sondes TCP saines ; se connecter avec les identifiants administrateur par défaut de l'image et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, confirmer la planification toujours active, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de sonde du pod, de `db-init`, de base de données, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
