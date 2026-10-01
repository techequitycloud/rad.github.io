---
title: "SnipeIT sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez SnipeIT sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/SnipeIT_GKE.md @ 3055034 sha256:174d9b981a3f -->

# SnipeIT sur GKE Autopilot — Guide de lab {#snipeit-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SnipeIT_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Snipe-IT est un système libre et open source de gestion des actifs et de l'inventaire informatiques,
qui permet de suivre le matériel, les licences logicielles, les accessoires et les consommables, avec
l'enregistrement des entrées et sorties d'actifs, la journalisation d'audit, l'amortissement et une API REST complète. Ce
lab vous fait parcourir le cycle de vie opérationnel complet du module **Snipe-IT on
GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Snipe-IT. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/SnipeIT_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris son assistant de premier lancement `/setup`.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Snipe-IT (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/SnipeIT_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, qui exécute
   l'image PHP/Apache officielle `snipe/snipe-it` (sans build personnalisé), provisionne une
   base de données Cloud SQL for MySQL 8.0 avec ses secrets Secret Manager (l'`APP_KEY`
   de Laravel et le mot de passe de la base de données), une instance Cloud Filestore (NFS)
   montée sur `/var/lib/snipeit` pour les images, signatures et codes-barres
   d'actifs téléversés, un bucket Cloud Storage `snipeit-uploads`, et
   exécute deux jobs d'initialisation ordonnés (`db-init` puis `migrate`). Les premiers
   déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL et de Filestore
   représente l'essentiel de ce temps).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep snipeit | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Snipe-IT sert sa page de connexion/configuration sur `/`
   sans authentification ; un `200` à cet endroit confirme donc que l'application PHP et la
   connexion MySQL (établie via le conteneur sidecar Cloud SQL Auth Proxy sur
   `127.0.0.1:3306`) sont toutes deux saines :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Sur une nouvelle installation, Snipe-IT
   redirige `/` vers l'assistant d'installation **`/setup`** au lieu de proposer
   un formulaire d'inscription en libre-service. Suivez l'assistant pour créer le premier
   compte administrateur. Si la redirection boucle ou aboutit sur le mauvais hôte,
   vérifiez que `APP_URL` correspond à l'adresse que vous consultez (Snipe-IT la déduit
   automatiquement de l'URL prévue du service GKE, mais un domaine personnalisé
   ajouté après le déploiement exige de mettre `APP_URL` à jour via `environment_variables`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le deployment, les pods et les persistent volume claims :

   ```bash
   kubectl get deploy,pods,pvc -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est maître de la spécification de la charge de travail ;
   la mise à l'échelle est donc une modification de configuration, et non un `kubectl scale` manuel (une
   modification manuelle serait annulée lors du prochain apply). `min_instance_count` et
   `max_instance_count` valent tous deux `1` par défaut ; passer au-delà d'un réplica
   sans avoir vérifié le comportement du NFS partagé et du pilote de session expose à des sessions scindées
   et à des conflits de verrouillage. L'affinité de session (`ClientIP`) est définie par défaut afin que les
   requêtes d'un client atteignent le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est récupérée et une
   mise à jour progressive remplace les pods. En production, figez `application_version` sur une étiquette de version
   `snipe/snipe-it` précise plutôt que de suivre
   `v8-latest`.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~snipeit"
   kubectl get jobs -n "$NAMESPACE"          # db-init and migrate
   ```

   Ne faites jamais tourner le secret `APP_KEY` après le premier démarrage — cela invalide toutes les
   sessions actives et toutes les données d'application que Snipe-IT a chiffrées avec l'ancienne clé.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. snipeitdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^snipeit" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^snipeit" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. `uptime_check_config`
   est **désactivé par défaut** pour ce module — activez-le dans les paramètres
   du déploiement si vous souhaitez un test de disponibilité provisionné et une alerte en cas d'échec, sous
   Monitoring → Uptime checks / Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Snipe-IT.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde
  de démarrage est une sonde TCP sur le port du conteneur (délai initial de 30 s, fenêtre d'échec d'environ
  5 minutes) afin de laisser le temps à la configuration de la base au premier démarrage ; la sonde de vivacité est une sonde HTTP `GET /`
  (délai initial de 300 s) — un échec de connexion à MySQL empêchera le pod
  de devenir Ready.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`. Cette variante atteint Cloud SQL via le **sidecar Auth Proxy sur
  `127.0.0.1:3306`** (`enable_cloudsql_volume = true`) ; vérifiez que le conteneur sidecar
  s'exécute aux côtés du conteneur de l'application dans le pod.
- **Échec d'un job d'initialisation :** inspectez le job et les journaux de son pod, pour l'un ou l'autre
  job de la chaîne (`db-init` s'exécute en premier, puis `migrate`) :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<migrate-job-name>
  ```
- **L'assistant `/setup` boucle ou renvoie des 404 :** il s'agit presque toujours d'une incohérence d'`APP_URL` —
  vérifiez que l'`APP_URL` injectée correspond à l'hôte que vous consultez.
- **Les fichiers téléversés / images d'actifs disparaissent après un redémarrage :** vérifiez que `enable_nfs =
  true`, que `network_tags` contient toujours `nfsserver` et que l'instance Filestore
  est joignable — retirer l'étiquette alors que NFS est activé rompt la
  connectivité entre les pods et Filestore.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` à la recherche de
  problèmes de ressources ou de quotas, et vérifiez qu'une IP a été attribuée au Service LoadBalancer.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner
`APP_KEY` après le premier démarrage, et les garde-fous vérifiés au moment du plan `upload_max_filesize ≤ post_max_size` /
`min_instance_count ≤ max_instance_count`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, l'instance Filestore (NFS), les secrets
Secret Manager, les buckets GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), NFS, les secrets, un bucket de stockage, et exécute `db-init` → `migrate` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; terminer l'assistant `/setup` pour créer le premier compte administrateur |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de `/setup` et de NFS/planification |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
