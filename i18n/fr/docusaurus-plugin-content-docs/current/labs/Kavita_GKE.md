---
title: "Kavita sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Kavita sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Kavita_GKE.md @ 3055034 sha256:e6d60f536ee7 -->

# Kavita sur GKE Autopilot — Guide de lab {#kavita-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kavita_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Kavita est une bibliothèque numérique et un serveur de lecture rapides et
auto-hébergés pour les bandes dessinées, les mangas et les livres numériques — une
interface de lecture web, des flux OPDS, des collections, des listes de lecture et
une recherche plein texte, construits sur .NET avec une base de données SQLite
interne. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**Kavita on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants
et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Kavita. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kavita_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et terminer l'assistant de configuration du premier lancement.
- Effectuer les opérations du jour 2 : inspecter le StatefulSet et le PVC, mettre à jour et gérer le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry et
  les comptes de service partagés dont dépend ce module — Kavita lui-même n'a pas
  besoin de Cloud SQL). Vous n'avez pas besoin de le déployer vous-même au préalable :
  la plateforme détecte automatiquement s'il existe déjà dans le projet cible et,
  sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Kavita (GKE)**
   dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kavita_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie Kavita sous forme de **StatefulSet** (sélectionné
   automatiquement parce que `stateful_pvc_enabled = true`) dans le cluster GKE
   Autopilot, avec un PVC en mode bloc par pod monté sur `/kavita/config`, construit
   l'image de conteneur personnalisée (une fine surcouche de `jvmilazz0/kavita`) et
   l'expose via la Gateway API avec une adresse IP statique réservée. Il n'y a
   **aucune base de données à provisionner ni aucune tâche d'initialisation à
   attendre** — Kavita gère sa propre base de données SQLite interne. Un premier
   déploiement se termine généralement en **10–15 minutes**.

3. Connectez-vous au cluster et repérez le namespace à l'aide d'un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kavita | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pvc,pods,svc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en cours d'exécution et trouvez l'adresse externe :

   ```bash
   kubectl get pods,svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(kubectl get gateway -n "$NS" \
     -o jsonpath='{.items[0].status.addresses[0].value}' 2>/dev/null)
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est sain. Kavita expose un point de terminaison de santé
   public et non authentifié qui renvoie `200` dès que le serveur répond :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 5000:5000 &
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health   # expect 200
   ```

   Ou, une fois que la Gateway dispose d'une adresse, interrogez-la directement :
   `curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/health"`.

3. Ouvrez l'URL du service dans un navigateur. Lors de la première visite,
   l'**assistant de configuration du premier lancement** de Kavita vous guide dans la
   création du compte administrateur initial et l'ajout de votre première
   bibliothèque — il n'existe aucun identifiant administrateur prédéfini dans Secret
   Manager. Faites-le rapidement : tant que l'assistant n'a pas été exécuté, le
   service est joignable mais non revendiqué.

4. Ce module ne conserve que le répertoire d'**état** de Kavita (`/kavita/config` —
   paramètres, base de données SQLite, couvertures) sur le PVC. Il ne provisionne pas
   le contenu réel de la bibliothèque. Pour lire quoi que ce soit, ajoutez vos propres
   `gcs_volumes` (ou activez NFS) pointant vers vos fichiers de bandes dessinées, de
   mangas ou de livres numériques, et enregistrez ce chemin comme bibliothèque dans
   l'interface de Kavita.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son stockage :**

   ```bash
   kubectl get statefulset,pvc,pods -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl describe pvc -n "$NS"
   gcloud compute disks list --project="$PROJECT" --filter="name~kavita"
   ```

2. **Ne dépassez pas une réplique.** `min_instance_count` et `max_instance_count`
   valent tous deux `1` par défaut. Kavita ne dispose d'aucun clustering ni d'aucune
   coordination du stockage partagé — exécuter plusieurs répliques sur le même PVC
   n'est pas sûr et risque de corrompre l'index SQLite de la bibliothèque.

3. **Le stockage est par défaut un véritable PVC en mode bloc** —
   `stateful_pvc_enabled = true`, `stateful_pvc_size = "20Gi"`, classe de stockage
   `standard-rwo` (sur SSD, qui consomme le quota `SSD_TOTAL_GB` du projet). C'est
   délibéré : gcsfuse corrompt les fichiers d'index SQLite et multimédia ; le PVC en
   mode bloc de GKE est donc la valeur par défaut la plus sûre, par comparaison avec
   [Kavita_CloudRun](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun), qui
   n'offre pas d'option de PVC en mode bloc et doit utiliser GCS Fuse. Si le quota SSD
   est serré, envisagez `stateful_pvc_storage_class = "standard"` (HDD) — les besoins
   d'E/S de Kavita n'exigent pas les IOPS d'un SSD.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est
   construite et une mise à jour progressive remplace le pod. Notez que
   `application_version = "latest"` correspond à un argument de build fixé,
   `KAVITA_VERSION = 0.8.7`, dans `Kavita_Common`, et non au tag générique injecté par
   la Foundation — changer de version exige de modifier cette valeur fixée et de
   reconstruire l'image, et pas seulement de redéployer.

5. **Inspectez le bucket de stockage (normalement non monté) :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~kavita"
   ```

   `Kavita_Common` crée toujours un bucket `storage`, mais avec la disposition par
   défaut en PVC bloc, il existe sans être **monté** — il n'est monté sur
   `/kavita/config` via GCS Fuse que si vous définissez `stateful_pvc_enabled = false`.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et
   l'utilisation du disque du PVC. Un **test de disponibilité** (uptime check)
   facultatif sur `/api/health` peut être activé (`uptime_check_config`, désactivé par
   défaut pour ce module) ; s'il est activé, examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Kavita à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La
  sonde de démarrage (startup probe) cible `/api/health` avec une marge d'échec
  généreuse (10 tentatives) afin de tolérer l'indexation de la bibliothèque au premier
  démarrage avant que la sonde de vivacité (liveness probe) ne prenne le relais.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC bloqué en `Pending` :** vérifiez si le quota `SSD_TOTAL_GB` est épuisé (un
  problème fréquent sur les projets aux quotas limités — la classe par défaut de
  Kavita, `standard-rwo`, repose sur SSD) ; passez si nécessaire à
  `stateful_pvc_storage_class = "standard"` (HDD).
- **Volume non accessible en écriture au démarrage :** vérifiez que
  `stateful_fs_group = 3000` est défini — Kavita s'exécute avec l'UID 1000/GID 2000, et
  un `fsGroup` incorrect ou non défini peut rendre le PVC inaccessible en écriture pour
  le conteneur.
- **Bibliothèque/données absentes après un redéploiement :** vérifiez que le PVC (et
  non le bucket `storage` non monté) a été conservé — avec la disposition par défaut, le
  PVC constitue la totalité de l'état durable de Kavita ; il survit aux redémarrages de
  pod, mais pas à la suppression du PVC.
- **Pod en attente / pas d'adresse IP externe :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de ressources ou de quotas, et
  vérifiez que la Gateway/HTTPRoute dispose d'une adresse attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la raison pour laquelle `max_instance_count` doit
rester à `1` et pourquoi `enable_redis` est sans effet pour ce module).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, le PVC en mode bloc contenant l'intégralité de l'état de Kavita (base
de données SQLite, paramètres, couvertures) et le bucket Cloud Storage non monté. Les
ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Artifact Registry)
sont gérées séparément et ne sont pas supprimées ici. Comme le PVC **est** l'index de la
bibliothèque et la progression de lecture, assurez-vous de disposer d'une sauvegarde ou
d'un export qui vous importe avant la suppression.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet avec un PVC en mode bloc monté sur `/kavita/config` ; pas de base de données, pas de tâche d'initialisation |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; terminer l'assistant du premier lancement pour créer le compte administrateur et la première bibliothèque |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, conserver 1 réplique, mettre à jour la version, gérer la classe de stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota, de fsGroup, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC contenant l'intégralité de l'état de Kavita |
