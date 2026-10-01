---
title: "Gatus sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Gatus sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Gatus_GKE.md @ 3055034 sha256:1af2d959b32d -->

# Gatus sur GKE Autopilot — Guide de lab {#gatus-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gatus_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Gatus est une page de statut et un moniteur de contrôles de santé open source, pensé pour les développeurs :
il interroge des points de terminaison HTTP, TCP, DNS et autres selon des planifications indépendantes,
évalue des conditions simples de réussite ou d’échec, et sert une page de statut publique en direct ainsi que
des alertes — sans base de données externe. Ce lab vous fait parcourir le cycle de vie opérationnel complet
du module **Gatus sur GKE Autopilot** sur Google Cloud :
le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes
courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Gatus. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gatus_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d’exécution, notamment en consultant la
  page de statut en direct.
- Effectuer les opérations du jour 2 — inspecter, évaluer la mise à l’échelle, mettre à jour, et gérer
  les secrets et le stockage durable de l’historique.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Gatus (GKE)** dans
   la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gatus_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état
   du déploiement avec les journaux en temps réel. Si vous prévoyez aussi de déployer `Gatus_CloudRun` sur le
   même tenant, définissez ici `tenant_id = "gke"` (et `"cr"` sur la variante
   Cloud Run) afin d’éviter une collision de noms sur les noms de secrets partagés, les noms de buckets GCS
   et les sujets de rotation.

2. La plateforme déploie une unique charge de travail de type Deployment dans le cluster GKE Autopilot,
   exécutant le binaire Go de Gatus, et construit l’image de conteneur (qui intègre
   un `config.yaml` par défaut avec un exemple de contrôle HTTP). Aucune base de données, aucun cache ni
   aucun bucket de stockage d’objets n’est provisionné — le stockage d’historique facultatif de Gatus est un fichier
   SQLite local. Il n’y a pas de job d’initialisation de base de données à attendre ; un premier
   déploiement est donc généralement bien plus rapide qu’un module adossé à une base de données (environ
   **10 à 15 minutes**, essentiellement consacrées au build de l’image et à la planification de la charge de travail).

3. Connectez-vous au cluster et repérez l’espace de noms à l’aide d’un filtre indépendant du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gatus | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s’exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Le point de terminaison de santé de Gatus répond dès que le
   serveur se lie à son port — il n’y a aucune dépendance de base de données à attendre :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}/` dans un navigateur pour afficher la page de statut en direct — elle
   montre le contrôle intégré `example` et son historique de disponibilité à mesure que les contrôles
   s’accumulent.

4. Par défaut, Gatus est livré **sans authentification** sur sa page de statut — toute personne
   disposant de l’adresse IP externe peut la consulter. Il n’y a pas de compte administrateur à créer. Si la
   page doit lister des noms de points de terminaison sensibles, modifiez le bloc `security` de
   `modules/Gatus_Common/scripts/config.yaml` (authentification basique ou
   OIDC) et redéployez — cela exige un nouveau build, et non un paramètre d’exécution.

5. Gatus ne dispose **d’aucune API ni interface d’exécution pour ajouter des points de terminaison à surveiller**. Pour surveiller un
   point de terminaison réel à la place de l’exemple intégré (ou en plus de celui-ci), modifiez la liste
   `endpoints` dans `modules/Gatus_Common/scripts/config.yaml` et redéployez.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — Deployment et pods :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `max_instance_count` vaut `1` par défaut et
   doit le rester — la boucle d’interrogation (watchdog) de Gatus n’a aucune coordination partagée
   entre réplicas ; une mise à l’échelle horizontale amènerait donc chaque réplica à interroger indépendamment
   chaque point de terminaison et à dupliquer les notifications d’alerte. Toute modification du nombre minimal ou maximal
   d’instances se fait depuis la page de détails du déploiement de la plateforme RAD et s’applique via
   **Update**, et non par un `kubectl scale` manuel (qui serait annulé lors du prochain
   apply).

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version dans la plateforme
   RAD et en l’appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace le pod. En production, fixez explicitement une version `v5.x.y` plutôt que de vous fier à
   `latest`.

4. **Gérez les secrets :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gatus"
   ```

   Gatus ne génère aucun secret propre au moment du déploiement — la liste Secret Manager n’est
   remplie que si vous avez fourni des entrées via `secret_environment_variables`.

5. **Activez un historique durable des contrôles** si le stockage éphémère par défaut ne vous
   convient pas. Définissez `stateful_pvc_enabled = true` (qui sélectionne automatiquement
   `workload_type = "StatefulSet"`) avec `stateful_pvc_mount_path = "/data"` et
   `stateful_pvc_storage_class = "standard"` (HDD) — c’est la **seule** option de
   ce catalogue dont la sûreté a été vérifiée pour le stockage d’historique de Gatus, car Gatus impose le
   mode de journalisation SQLite WAL et la propre documentation de SQLite indique que WAL n’est pas pris en charge
   sur les systèmes de fichiers réseau (ce qui exclut `enable_nfs` comme alternative sûre).

   ```bash
   kubectl get pvc -n "$NS"          # only present when stateful_pvc_enabled = true
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Gatus journalise le résultat de chaque contrôle de point de terminaison (réussite/échec, durée) au fil de l’exécution —
   utile pour confirmer qu’un point de terminaison nouvellement ajouté est bien interrogé.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du CPU et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (uptime check) (lorsqu’il est activé) ; examinez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Gatus à l’autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité (liveness) ciblent toutes deux `/health`, qui devrait renvoyer `200` quelques secondes
  après le démarrage — Gatus n’a aucune base de données à attendre ; une sonde lente ou en échec indique donc généralement
  un problème de build du conteneur ou de configuration plutôt qu’une dépendance en aval.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **L’historique des contrôles « disparaît » après un redémarrage du pod :** c’est le comportement attendu avec le
  Deployment sans état et le stockage éphémère par défaut — un redémarrage du pod réinitialise l’historique
  par conception (les points de terminaison configurés ne sont pas affectés ; seuls leurs
  résultats historiques et pourcentages de disponibilité sont réinitialisés). Si un PVC est activé, vérifiez que
  `stateful_pvc_mount_path` correspond exactement au répertoire `storage.path` intégré à Gatus
  (`/data`) :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl exec -n "$NS" <pod> -- ls -l /data
  ```
- **Un point de terminaison nouvellement ajouté n’est pas contrôlé :** vérifiez que vous avez modifié
  `modules/Gatus_Common/scripts/config.yaml` et redéployé — Gatus n’a aucune API d’exécution
  pour ajouter des contrôles ; un point de terminaison ajouté ailleurs n’a donc aucun effet.
- **Pod en attente (Pending) / pas d’adresse IP externe :** consultez les événements de `kubectl describe pod` à la recherche
  de problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d’une adresse
  IP attribuée :
  ```bash
  kubectl get svc -n "$NS"
  ```
- **La page de statut est inaccessible ou bloquée de façon inattendue :** vérifiez si `enable_iap`
  a été activé — IAP exige une connexion Google et bloque la consultation non authentifiée,
  ce qui n’est généralement pas ce que l’on attend d’une page de statut publique.
- **Erreurs de récupération d’image (image pull) :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment garder `max_instance_count = 1`, faire correspondre
le chemin de montage du PVC à `/data`, et la mise en garde sur la persistance SQLite WAL).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, tout PVC, et les images Artifact Registry. Il n’y a ni base de données Cloud SQL,
ni bucket GCS, ni secret généré automatiquement à nettoyer (Gatus n’en provisionne aucun par
défaut). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie une unique charge de travail GKE exécutant Gatus ; aucune base de données ni aucun bucket de stockage |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; la page de statut en direct s’affiche avec l’exemple de contrôle intégré |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, garder le maximum d’instances à 1, mettre à jour la version, gérer les secrets, activer un PVC bloc pour un historique durable |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de modification de configuration, de persistance de l’historique, de planification et de récupération d’image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
