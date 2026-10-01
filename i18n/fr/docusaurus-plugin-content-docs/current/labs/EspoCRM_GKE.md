---
title: "EspoCRM sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez EspoCRM sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/EspoCRM_GKE.md @ 3055034 sha256:09686a42099e -->

# EspoCRM sur GKE Autopilot — Guide de lab {#espocrm-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/EspoCRM_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

EspoCRM est une plateforme open source de gestion de la relation client (CRM), sous licence GPLv3,
construite sur PHP et Apache. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel
du module **EspoCRM on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit EspoCRM (contacts, prospects, opportunités, workflows). Pour la liste
complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/EspoCRM_GKE) — ce
lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, découvrir l'espace de noms et accéder à la charge de travail en cours d'exécution.
- Récupérer l'identifiant administrateur généré automatiquement et vérifier que la charge de travail est en bonne santé et
  connectée à sa base de données.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets, le stockage NFS
  et la base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  le NFS Filestore, Artifact Registry et les comptes de service partagés dont
  dépend ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **EspoCRM (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/EspoCRM_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager
   (`ESPOCRM_ADMIN_PASSWORD` et le mot de passe de la base de données), un bucket Cloud
   Storage `espocrm-data`, un volume NFS Filestore partagé monté sur `/var/www/html/data` pour
   les fichiers téléversés (`enable_nfs = true` par défaut), construit l'image de conteneur et exécute un
   job ponctuel d'initialisation de la base de données. Le pod atteint Cloud SQL via un
   sidecar Auth Proxy colocalisé sur l'interface de bouclage (`enable_cloudsql_volume = true` par
   défaut). L'installateur EspoCRM amont exécute ensuite automatiquement sa propre étape d'installation/migration
   au premier démarrage du pod. Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL et de Filestore domine).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep espocrm | head -1 | cut -d/ -f2)
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

2. Vérifiez que la charge de travail affiche sa page de connexion (le point de terminaison de santé d'EspoCRM est
   l'écran de connexion non authentifié à `/`, qui renvoie `200` une fois l'étape d'installation/migration
   terminée) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

   Lors d'un premier démarrage lent, les sondes de démarrage (TCP, délai initial de 30 s) et de vivacité (`HTTP GET
   /`, délai initial de 300 s) sont identiques à celles de la variante Cloud Run — les pods peuvent osciller
   brièvement pendant que l'étape d'installation/migration se termine ; patientez quelques minutes avant
   de dépanner.

3. Récupérez le mot de passe administrateur généré automatiquement dans Secret Manager — l'installateur
   d'EspoCRM crée l'utilisateur `admin` avec ce mot de passe au premier démarrage :

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-espocrm-admin-password" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous en tant que `admin` avec le mot de passe
   récupéré. Changez immédiatement le mot de passe sous **Administration → Users** — la
   valeur générée automatiquement n'initialise que la **première** installation ; la perdre plus tard impose une
   réinitialisation au niveau de la base de données.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). `max_instance_count` vaut `1` par défaut ; l'affinité de
   session (`ClientIP`) est définie par défaut pour maintenir les requêtes d'un client sur le même
   pod dès que vous dépassez un réplica. Comme la charge de travail repose sur NFS, la
   fondation utilise la stratégie de mise à jour `Recreate`, afin que deux pods n'écrivent jamais sur le même
   volume NFS pendant un déploiement progressif.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et les pods sont
   recréés.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~espocrm"
   gcloud filestore instances list --project="$PROJECT"   # backs /var/www/html/data uploads
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. espocrmdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^espocrm" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Activez Redis (facultatif)** pour décharger MySQL du cache d'objets d'EspoCRM : définissez
   `enable_redis = true` et appliquez via **Update** ; laissez `redis_host` vide pour réutiliser
   l'IP du serveur NFS comme point de terminaison Redis.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Le conteneur affiche au démarrage du pod ses valeurs
   `ESPOCRM_DATABASE_*` et `ESPOCRM_SITE_URL` résolues, un moyen rapide de
   confirmer l'hôte de base de données et l'URL du site utilisés :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du processeur et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'EspoCRM à l'autre.

- **Pod non Ready / oscillant au premier démarrage :** la sonde de démarrage est TCP (délai initial de 30 s,
  période de 15 s, 20 échecs) et la sonde de vivacité est `HTTP GET /` (délai initial de 300 s,
  période de 60 s, 3 échecs). Lors d'un premier démarrage lent (l'étape d'installation/migration),
  les pods peuvent osciller avant qu'EspoCRM ait fini de s'initialiser ; augmentez le délai initial /
  le seuil d'échec via `startup_probe` / `liveness_probe` si le problème
  persiste.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et que le
  job `db-init` s'est terminé. Le pod atteint MySQL via le sidecar Auth Proxy sur
  `127.0.0.1:3306` (`enable_cloudsql_volume = true`) — ne remplacez pas `DB_HOST`.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Fichiers téléversés absents après un redémarrage :** vérifiez que `enable_nfs = true` et que l'instance
  Filestore est en bonne santé — sans NFS, les pièces jointes résident sur le disque éphémère du pod et sont
  perdues lors d'un redémarrage ou d'une replanification.
- **Déploiement progressif bloqué lors d'une mise à jour :** une charge de travail EspoCRM reposant sur NFS utilise `Recreate`, et non
  `RollingUpdate` — sinon, un pod supplémentaire se retrouverait en interblocage sur le volume NFS partagé et
  la base de données. Si vous voyez « Waiting for rollout to finish: old replicas are pending
  termination », vérifiez que la stratégie n'a pas été remplacée.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment l'immuabilité de `application_database_name`/
`application_database_user` après le premier déploiement et le caractère ponctuel du
mot de passe administrateur généré automatiquement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie le déploiement). La
suppression retire tout ce que le module a créé — la charge de travail Kubernetes et son espace de noms, la base de données Cloud
SQL, les secrets Secret Manager, les buckets GCS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, l'instance
NFS Filestore, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), les secrets, le bucket de stockage + le montage NFS, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la page de connexion renvoie 200 ; récupérer le mot de passe administrateur généré automatiquement et se connecter |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le NFS, accéder à la base de données, Redis facultatif |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de déploiement progressif, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
