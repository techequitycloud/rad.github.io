---
title: "Rocket.Chat sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Rocket.Chat sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/RocketChat_GKE.md @ 3055034 sha256:104a55f0f8a0 -->

# Rocket.Chat sur GKE Autopilot — Guide de lab {#rocketchat-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/RocketChat_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Rocket.Chat est une plateforme open source et auto-hébergée de communication d'équipe — une alternative
à Slack/Teams avec canaux, messages directs, fils de discussion et voix/vidéo. Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **Rocket.Chat on GKE Autopilot**
sur Google Cloud : le déployer, terminer l'assistant de configuration du premier lancement, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de Rocket.Chat. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/RocketChat_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et terminer l'assistant de configuration (administrateur + organisation).
- Effectuer les opérations du jour 2 — inspecter le StatefulSet/PVC, mettre à jour et gérer les sauvegardes.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **RocketChat (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. **Vérifiez que `stateful_pvc_enabled = true`** — MongoDB exige un véritable système de fichiers
   en mode bloc ; `gcsfuse` corrompt WiredTiger. Ne configurez que ce dont vous avez besoin par ailleurs — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/RocketChat_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur personnalisée — l'image officielle `rocketchat/rocket.chat`
   avec un **replica set MongoDB 6.0 à nœud unique (`rs0`) intégré** — provisionne un
   **StatefulSet avec un PVC Persistent Disk** monté sur `/data/db`, et déploie la
   charge de travail dans le cluster GKE Autopilot. Il n'y a **aucune instance Cloud SQL** ; MongoDB
   est intégré. Le build de l'image représente l'essentiel du temps du premier déploiement, environ **15 à 25 minutes**.

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep rocketchat | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et terminer l'assistant de configuration [Manuel] {#task-2--access--complete-the-setup-wizard-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et que le PVC est lié :

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   ```

2. Le Service est de type **LoadBalancer** par défaut (Rocket.Chat est une application de chat
   exposée publiquement), avec une IP statique réservée afin que l'adresse survive aux redéploiements. Trouvez
   l'IP externe et vérifiez que l'API répond :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}/api/info"   # expect {"version":"6.12.1","success":true,...}
   ```

   S'il n'est pas encore prêt (`EXTERNAL_IP` vide ou aucune réponse), vérifiez que le MongoDB
   intégré est bien devenu PRIMARY au démarrage :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     | grep -i "replica set rs0 is PRIMARY"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, Rocket.Chat lance
   l'**assistant de configuration en 4 étapes** — aucun identifiant administrateur n'est pré-créé :

   - **Étape 1 — Admin Info :** nom complet, nom d'utilisateur, e-mail de l'administrateur
     (utilisez `admin@techequity.cloud` pour les déploiements RAD), mot de passe.
   - **Étape 2 — Organization Info :** nom, type, secteur, taille et pays de l'organisation.
   - **Étape 3 — Register Server :** **Register** auprès de Rocket.Chat Cloud ou **Keep standalone**.
   - **Étape 4 — Complete :** vous arrivez dans l'espace de travail administrateur.

4. (Facultatif) Lorsque vous exposez Rocket.Chat sur un domaine personnalisé, définissez `ROOT_URL` sur ce
   nom d'hôte via `environment_variables` et appliquez un **Update**.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod et le PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** Le PVC est en `ReadWriteOnce` et le MongoDB intégré
   n'a qu'un seul écrivain — `min_instance_count` et `max_instance_count` valent tous deux
   `1` par conception. Un second réplica ne peut pas s'attacher au disque. Mettez à l'échelle **verticalement** (davantage
   de CPU/mémoire, un PVC plus grand ou en `premium-rwo`) en modifiant les paramètres et en cliquant sur
   **Update**.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et le pod unique est recréé
   (brève interruption pendant que le PVC est rattaché). Rocket.Chat exécute ses propres migrations au
   démarrage.

4. **Gérez le jeton d'API, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"   # when enable_api_key = true
   kubectl get cronjobs -n "$NS"                                       # scheduled mongodump backups
   ```

5. **Sauvegardez MongoDB** en exécutant un `mongodump` dans le pod contre le replica set
   et en copiant le dump dans le bucket de stockage (voir `cron_jobs` dans le Guide de configuration).

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — Rocket.Chat et le `mongod` intégré écrivent tous deux sur stdout :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux (Logs Explorer) :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et mémoire
   des pods, le nombre de redémarrages et l'utilisation du PVC. Le module peut provisionner un **test de
   disponibilité** sur `/api/info` (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Rocket.Chat.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de démarrage
  cible `/api/info` ; le pod n'est pas Ready tant que le replica set intégré n'est pas `PRIMARY`.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events: scheduling / probe / mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`/api/info` ne renvoie jamais 200 :** recherchez `replica set rs0 is PRIMARY` avec grep. Si MongoDB
  ne devient jamais PRIMARY, vérifiez que le PVC est lié et monté sur `/data/db` et que le pod
  n'est pas tué pour dépassement de mémoire (OOM) (augmentez `memory_limit`).
- **Corruption des données après un redémarrage :** vérifiez que `stateful_pvc_enabled = true` et que
  `/data/db` se trouve sur le PVC — un montage `gcsfuse` corrompt WiredTiger et constitue la cause
  classique d'un jeu de données endommagé.
- **Pod en attente / PVC non lié :** consultez les événements de `kubectl describe pvc` et `kubectl describe pod`
  pour repérer des problèmes de classe de stockage ou de quota.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer (MongoDB 6.0 doit être installé depuis le dépôt bullseye au moment
  du build).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment conserver `stateful_pvc_enabled = true` et `stateful_pvc_mount_path =
"/data/db"`, et ne jamais dépasser un réplica).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le StatefulSet Kubernetes
et l'espace de noms, le PVC Persistent Disk contenant les données MongoDB, le bucket Cloud
Storage, l'éventuel jeton d'API Secret Manager et les images d'Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image (Rocket.Chat + MongoDB intégré), provisionne un StatefulSet + un PVC bloc et déploie sur GKE |
| 2 — Accès et assistant de configuration | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; terminer l'assistant en 4 étapes (administrateur + organisation) |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, mettre à jour la version, gérer le jeton d'API/les sauvegardes ; ne jamais mettre à l'échelle horizontalement |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de replica set, de PVC/stockage, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
