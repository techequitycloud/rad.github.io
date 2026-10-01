---
title: "Komga sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Komga sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Komga_GKE.md @ 3055034 sha256:eea7bbcebd50 -->

# Komga sur GKE Autopilot — Guide de lab {#komga-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Komga_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Komga est un serveur rapide et auto-hébergé de lecture de bandes dessinées et de mangas — une interface web de lecture, des flux
OPDS, des collections, des listes de lecture et une recherche plein texte, construit en Kotlin/Java (Spring
Boot) avec une base de données SQLite embarquée. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Komga on GKE Autopilot** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Komga. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Komga_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et terminer l'assistant de configuration initiale.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et le PVC, mettre à jour et gérer le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module — Komga lui-même n'a pas besoin
  de Cloud SQL). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Komga (GKE)**
   depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Komga_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie Komga sous forme de **StatefulSet** (sélectionné automatiquement parce que
   `stateful_pvc_enabled = true`) dans le cluster GKE Autopilot, avec un PVC bloc
   par pod monté sur `/config`, déploie l'image officielle préconstruite
   `gotson/komga` (éventuellement mise en miroir dans Artifact Registry) et
   l'expose via la Gateway API avec une IP statique réservée. Il n'y a **ni
   base de données à provisionner ni tâche d'initialisation à attendre** — Komga gère sa propre
   base de données SQLite embarquée. Les premiers déploiements se terminent généralement en **8–12 minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep komga | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pvc,pods,svc -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod s'exécute et trouvez l'adresse externe :

   ```bash
   kubectl get pods,svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(kubectl get gateway -n "$NS" \
     -o jsonpath='{.items[0].status.addresses[0].value}' 2>/dev/null)
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Komga expose un point de terminaison de santé Spring
   Boot Actuator public et non authentifié, qui renvoie `200 {"status":"UP"}` dès que le
   serveur répond :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 25600:25600 &
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:25600/actuator/health   # expect 200
   ```

   Ou, une fois que la Gateway dispose d'une adresse, interrogez-la directement :
   `curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/actuator/health"`.

   Remarque : le chemin versionné `/api/v1/actuator/health` est un point de terminaison **différent, soumis à
   authentification**, qui renvoie `401` — c'est attendu et ce n'est pas une anomalie.

3. Ouvrez l'URL du service dans un navigateur. Lors de la première visite, l'**assistant de configuration
   initiale** de Komga vous guide dans la création du compte administrateur initial — il n'existe
   aucun identifiant administrateur prédéfini dans Secret Manager. Effectuez cette étape sans tarder :
   tant que l'assistant n'a pas été exécuté, le service est joignable mais non revendiqué.

4. Ce module ne conserve sur le PVC que le répertoire d'**état** de Komga (`/config` — paramètres,
   base de données SQLite embarquée, index de recherche, cache de vignettes). Il
   ne provisionne pas le contenu réel de la bibliothèque. Pour lire quoi que ce soit, ajoutez vos propres
   `gcs_volumes` (ou activez NFS) pointant vers vos fichiers de bandes dessinées ou de mangas, puis connectez-vous
   et ajoutez ce chemin comme **bibliothèque** (library) dans l'interface de Komga et lancez une analyse.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son stockage :**

   ```bash
   kubectl get statefulset,pvc,pods -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl describe pvc -n "$NS"
   gcloud compute disks list --project="$PROJECT" --filter="name~komga"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count` et
   `max_instance_count` valent tous deux `1` par défaut. Komga ne dispose d'aucun mécanisme de clustering ni de
   coordination du stockage partagé — exécuter plusieurs réplicas sur le
   même PVC est dangereux et risque de corrompre l'index SQLite de la bibliothèque.

3. **Le stockage est par défaut un véritable PVC bloc** — `stateful_pvc_enabled = true`,
   `stateful_pvc_size = "20Gi"`, classe de stockage `standard-rwo` (sur SSD,
   imputée au quota `SSD_TOTAL_GB` du projet). C'est délibéré : l'absence de
   véritable verrouillage de fichiers dans gcsfuse corrompt les fichiers WAL de SQLite, le PVC bloc de GKE est donc
   la valeur par défaut la plus sûre, par rapport à
   [Komga_CloudRun](https://docs.radmodules.dev/docs/modules/Komga_CloudRun),
   qui n'offre pas d'option de PVC bloc et doit utiliser GCS Fuse. Si le quota SSD est serré,
   envisagez `stateful_pvc_storage_class = "standard"` (HDD) — les besoins en E/S de Komga
   n'exigent pas les IOPS d'un SSD.

4. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** — cela déploie
   directement le tag `gotson/komga` correspondant (une image réellement préconstruite ;
   aucune reconstruction n'est nécessaire).

5. **Inspectez le bucket de stockage (normalement non monté) :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~komga"
   ```

   `Komga_Common` crée toujours un bucket `storage`, mais avec la disposition par défaut
   en PVC bloc, il existe sans être **monté** — il n'est monté sur
   `/config` via GCS Fuse que si vous définissez `stateful_pvc_enabled = false`.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (surveillez de près la mémoire pendant l'analyse de grandes bibliothèques — l'index
   Lucene et le cache de vignettes sont conservés dans le tas de la JVM), le nombre de redémarrages et
   l'utilisation du disque du PVC. Un **test de disponibilité** (uptime check) facultatif sur `/actuator/health` peut être
   activé (`uptime_check_config`, désactivé par défaut pour ce module) ; s'il est
   activé, consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Komga.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de
  démarrage cible `/actuator/health` avec une marge d'échec généreuse (10 tentatives).
  Vérifiez que la sonde n'a pas été dirigée par erreur vers le point de terminaison soumis à authentification
  `/api/v1/actuator/health` (toujours 401, quel que soit l'état de l'application).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC bloqué en `Pending` :** recherchez un épuisement du quota `SSD_TOTAL_GB` (un problème
  fréquent sur les projets aux quotas restreints — la classe par défaut de Komga, `standard-rwo`,
  repose sur des SSD) ; passez à `stateful_pvc_storage_class = "standard"` (HDD) si
  nécessaire.
- **Bibliothèque ou données manquantes après un redéploiement :** vérifiez que le PVC (et non le bucket
  `storage` non monté) a bien été conservé — avec la disposition par défaut, le PVC constitue l'intégralité de l'état
  durable de Komga ; il survit aux redémarrages de pod, mais pas à la suppression
  du PVC.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quotas, et vérifiez que la Gateway/HTTPRoute dispose d'une
  adresse attribuée.
- **Analyses de bibliothèque lentes ou en échec :** recherchez des erreurs OOM dans les journaux ; augmentez
  `memory_limit` (et éventuellement `jvm_heap_max`) pour les très grandes bibliothèques.
- **Erreurs de récupération d'image :** vérifiez que l'image existe (soit dans le registre public
  `gotson/komga`, soit dans son miroir Artifact Registry) et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment pourquoi `max_instance_count` doit rester à `1`
et pourquoi `enable_redis` est forcé à désactivé pour ce module).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, le PVC bloc qui contient l'intégralité de l'état de Komga (base de données SQLite,
index de recherche, paramètres), et le bucket Cloud Storage non monté. Les ressources appartenant
à **Services_GCP** (le VPC, le cluster GKE, Artifact Registry) sont gérées
séparément et ne sont pas supprimées ici. Comme le PVC **est** l'index de la bibliothèque
et la progression de lecture, assurez-vous de disposer d'une sauvegarde ou d'un export de ce qui compte pour vous
avant de supprimer.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet avec un PVC bloc monté sur `/config` ; sans base de données ni tâche d'initialisation |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit ; terminer l'assistant de configuration initiale pour créer le compte administrateur, puis ajouter une bibliothèque |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, maintenir les réplicas à 1, mettre à jour la version, gérer la classe de stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota, de mémoire, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC qui contient l'intégralité de l'état de Komga |
