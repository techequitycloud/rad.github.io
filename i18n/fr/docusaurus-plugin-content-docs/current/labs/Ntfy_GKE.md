---
title: "Ntfy sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Ntfy sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Ntfy_GKE.md @ 3055034 sha256:bbfd5fcba102 -->

# Ntfy sur GKE Autopilot — Guide de lab {#ntfy-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ntfy_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

ntfy est un serveur open source de notifications push en mode pub/sub : les applications publient
des messages via une API REST/HTTP simple et les clients les reçoivent instantanément via des flux
WebSocket ou Server-Sent-Events, sans aucune base de données externe. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **ntfy on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit ntfy. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ntfy_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, notamment par un
  test rapide de publication/abonnement.
- Effectuer les opérations du jour 2 — inspecter, tenir compte des contraintes de mise à l'échelle, mettre à jour, et gérer
  les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Ntfy (GKE)** depuis
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ntfy_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel. Notez que `Ntfy_GKE` ajoute `-gke` à
   `tenant_id` en interne, de sorte qu'il peut coexister avec `Ntfy_CloudRun` sur le
   même tenant sans collision de noms.

2. La plateforme déploie une unique charge de travail de type Deployment dans le cluster GKE Autopilot,
   qui exécute le binaire Go de ntfy, et construit l'image du conteneur. Aucune base de données,
   aucun cache ni aucun bucket de stockage d'objets n'est provisionné — ntfy conserve son cache de messages dans
   un fichier SQLite local. Il n'y a aucune tâche d'initialisation de base de données à attendre ; un
   premier déploiement est donc généralement bien plus rapide que pour un module adossé à une base de données (environ
   **10–15 minutes**, l'essentiel étant consacré au build de l'image et à la planification de la charge de travail).

3. Connectez-vous au cluster et repérez l'espace de noms avec un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep ntfy | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Le point de terminaison de santé de ntfy répond dès que le
   serveur s'est lié à son port — il n'y a aucune dépendance de base de données à attendre :

   ```bash
   curl -s "http://${EXTERNAL_IP}/v1/health"   # expect {"healthy":true}
   ```

3. Exécutez un test rapide de publication/abonnement sur l'IP externe :

   ```bash
   curl -d "hello from ntfy" "http://${EXTERNAL_IP}/mytopic"     # publish
   curl -s "http://${EXTERNAL_IP}/mytopic/json"                   # subscribe (streaming JSON; Ctrl-C to stop)
   ```

   Ouvrez `http://${EXTERNAL_IP}/mytopic` dans un navigateur pour voir l'interface web intégrée
   recevoir le message en temps réel.

4. ntfy est livré en **accès ouvert** — n'importe quel client peut publier sur n'importe quel sujet
   ou s'y abonner via l'IP publique. Il n'y a aucun compte administrateur à créer. Si vous avez besoin d'un
   contrôle d'accès, configurez des utilisateurs et des ACL par sujet après le déploiement via la CLI de ntfy
   (`ntfy user add`, `ntfy access`) ou en définissant des variables d'environnement `NTFY_AUTH_*`
   dans `environment_variables` et en les appliquant via **Update**. Si vous prévoyez
   d'utiliser des pièces jointes ou le web-push du navigateur, définissez également `NTFY_BASE_URL` sur l'URL
   externe.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment et les pods :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `max_instance_count` vaut `1` par défaut et
   doit le rester — le flux WebSocket/SSE d'un abonné est ancré au pod
   qui le détient, et ntfy ne dispose d'aucun bus de messages partagé. Augmenter le nombre de réplicas répartit silencieusement
   les abonnés entre les pods, de sorte qu'un message publié sur un pod n'est jamais
   remis à un abonné rattaché à un autre. Si vous augmentez malgré tout le nombre de réplicas, définissez
   `session_affinity = "ClientIP"` pour maintenir un abonné qui se reconnecte sur le
   pod détenant ses messages en cache. Toute modification du nombre minimal/maximal d'instances se fait depuis la
   page de détails du déploiement de la plateforme RAD et s'applique via **Update**, et non par un
   `kubectl scale` manuel (qui serait annulé lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace le pod. En production, fixez une version `v2.x.y` explicite plutôt que de vous appuyer sur
   `latest`.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~ntfy"
   kubectl get pvc -n "$NS"          # only present when stateful_pvc_enabled = true
   ```

   ntfy ne génère aucun secret propre au moment du déploiement — la liste Secret Manager n'est
   renseignée que si vous avez fourni des entrées via `secret_environment_variables`.

5. **Activez un historique de messages durable**, si le cache éphémère par défaut n'est pas
   acceptable. Deux options : définir `enable_nfs = true` et faire pointer le répertoire de `NTFY_CACHE_FILE`
   vers le montage NFS, ou passer à un PVC en mode bloc par pod avec
   `stateful_pvc_enabled = true` et `stateful_pvc_mount_path = "/var/cache/ntfy"`.
   Sans l'une de ces options, le cache SQLite est perdu à chaque redémarrage du pod.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   ntfy journalise son adresse d'écoute et le chemin résolu de son cache au démarrage — vérifiez ici
   en premier si vous attendiez une persistance NFS/PVC mais que le cache semble toujours éphémère.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (uptime check) (lorsqu'il est activé) ; consultez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de ntfy.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et de
  liveness ciblent toutes deux `/v1/health`, qui doit renvoyer `200` quelques
  secondes après le démarrage — ntfy n'a aucune base de données à attendre ; une sonde lente ou en échec
  indique donc généralement un problème de build du conteneur ou de configuration plutôt qu'une dépendance
  en aval.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Des messages « disparaissent » ou les abonnés ne voient pas l'historique :** vérifiez
  `max_instance_count` (qui doit valoir `1`) et si `enable_nfs` ou
  `stateful_pvc_enabled` est défini — avec le Deployment sans état par défaut et le
  cache éphémère, un redémarrage du pod efface l'historique des messages par conception, ce que l'on
  confond facilement avec un bug de remise. Si un PVC est activé, vérifiez que
  `stateful_pvc_mount_path` correspond exactement au répertoire de `NTFY_CACHE_FILE` :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl exec -n "$NS" <pod> -- ls -l /var/cache/ntfy
  ```
- **Les pièces jointes ou les liens web-push sont cassés :** vérifiez que `NTFY_BASE_URL` est défini sur
  l'URL externe de la charge de travail dans `environment_variables`.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée :
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Publication/abonnement bloqués de manière inattendue :** vérifiez si `enable_iap` a été
  activé — IAP exige une connexion Google et bloque les appels de publication/abonnement
  non authentifiés, ce qui n'est généralement pas souhaitable pour un point de terminaison de
  notification.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment conserver `max_instance_count = 1` et
faire correspondre le chemin de montage du PVC au répertoire du cache).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, tout PVC et les images Artifact Registry. Il n'y a aucune base de données Cloud SQL,
aucun bucket GCS ni aucun secret généré automatiquement à nettoyer (ntfy n'en provisionne aucun par
défaut). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie une unique charge de travail GKE exécutant ntfy ; aucune base de données ni aucun bucket de stockage |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit ; le test rapide de publication/abonnement confirme la remise en temps réel |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, maintenir le maximum d'instances à 1, mettre à jour la version, gérer les secrets/le stockage, activer NFS/PVC pour la durabilité |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de persistance du cache, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
