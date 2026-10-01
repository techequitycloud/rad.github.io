---
title: "Budibase sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Budibase sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Budibase_GKE.md @ 3055034 sha256:2b9c177b6dbb -->

# Budibase sur GKE Autopilot — Guide de lab {#budibase-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Budibase_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Budibase est une plateforme low-code open source permettant de créer des outils
internes, des applications métier et des workflows à partir de vos données. L'image
officielle est un conteneur **tout-en-un** qui regroupe CouchDB, MinIO et Redis aux
côtés des composants apps/worker/proxy de Budibase ; ce module ne nécessite donc
aucune base de données gérée externe — sur GKE, tout cet état est conservé sur un
Persistent Disk en mode bloc. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Budibase on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Budibase. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Budibase_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, trouver le namespace de la charge de travail et
  accéder au service en cours d'exécution.
- Effectuer les opérations du jour 2 : inspecter le StatefulSet et le PVC, comprendre
  pourquoi la mise à l'échelle est fixée à une seule réplique, mettre à jour la
  version et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry et les
  comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable : la plateforme détecte automatiquement s'il existe
  déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Budibase (GKE)**
   dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Budibase_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme construit une image d'encapsulation minimale (`FROM budibase/budibase`)
   et la copie dans Artifact Registry, puis déploie un **StatefulSet** à une seule
   réplique dans le cluster GKE Autopilot (`stateful_pvc_enabled = true` résout
   automatiquement `workload_type` en `StatefulSet`) avec un Persistent Disk en mode
   bloc de 20Gi monté sur `/data`, un bucket de données Cloud Storage, un Service
   LoadBalancer externe et sept secrets d'identifiants internes dans Secret Manager
   (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
   `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). Il n'y a **aucune
   instance Cloud SQL** ni tâche d'initialisation de base de données — Budibase
   provisionne lui-même ses CouchDB et MinIO intégrés sur le PVC au premier démarrage.
   Un premier déploiement prend environ **15–25 minutes**.

3. Connectez-vous au cluster et repérez le namespace à l'aide d'un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep budibase | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get statefulset,pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Les sondes de démarrage et de vivacité (startup et liveness) ciblent la racine non
   authentifiée `/`, qui renvoie `200` une fois que CouchDB, MinIO, Redis et la couche
   applicative intégrés sont tous opérationnels. Prévoyez jusqu'à environ
   **8–9 minutes** au premier démarrage (un délai initial de 60 secondes plus une
   fenêtre de 30 tentatives à intervalle de 15 secondes) :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Budibase auto-hébergé est livré
   **sans compte administrateur par défaut** — l'écran de configuration vous invite à
   créer l'administrateur initial (e-mail + mot de passe). Faites-le immédiatement
   après le déploiement ; tant qu'aucun administrateur n'a été créé, toute personne qui
   atteint l'URL peut s'approprier l'instance.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pod, PVC et événements :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe pod -n "$NS" -l app="$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')"
   ```

2. **Vérifiez que le point de montage `/data` repose bien sur le PVC**, puisque c'est
   ce qui fait de GKE la plateforme durable pour Budibase :

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- df -h /data
   ```

3. **Ne modifiez pas la mise à l'échelle.** `min_instance_count = max_instance_count = 1`
   est une exigence stricte, et non un point de départ — le pod tout-en-un conserve
   tout son état sur son unique PVC ; une deuxième réplique ne partagerait donc pas le
   stockage de données (split-brain). Ne touchez pas à ces deux paramètres et ne
   forcez jamais `workload_type = "Deployment"` (cela échoue lors du plan avec
   `stateful_pvc_enabled = true`, car un Deployment ne peut pas définir de PVC par pod).

4. **Mettez à jour la version de l'application** en modifiant `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; cela reconstruit l'image
   d'encapsulation minimale (épinglée via l'ARG de build `BUDIBASE_VERSION`) et remplace
   le pod. Le PVC et ses données survivent à la mise à jour.

5. **Gérez les secrets, le stockage et les tâches** — listez-les, mais ne faites
   jamais tourner l'un des sept secrets générés automatiquement après le premier
   démarrage ; les données du PVC sont chiffrées avec ces valeurs exactes et deviennent
   illisibles si l'une d'elles change :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~budibase"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et
   l'utilisation du disque du PVC (elle augmente avec les données de l'application et
   les pièces jointes — dimensionnez `stateful_pvc_size` généreusement). Si un **test
   de disponibilité** (uptime check) est activé, examinez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Budibase à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La
  sonde de vivacité cible `/` ; un pod qui n'a pas fini de démarrer CouchDB, MinIO,
  Redis et la couche applicative continuera d'échouer à la sonde jusqu'à l'expiration
  complète de la fenêtre du premier démarrage.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pression mémoire / OOM au démarrage :** CouchDB + MinIO + Redis + la couche
  applicative intégrés nécessitent beaucoup de mémoire ; en dessous d'environ 2Gi, des
  arrêts pour OOM risquent de survenir pendant le premier démarrage. Vérifiez la
  mémoire de `container_resources` par rapport au dimensionnement recommandé dans le
  Guide de configuration.
- **PVC non lié / pod bloqué en Pending :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de planification ou de quota, et
  vérifiez que le PVC est à l'état lié (Bound) :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **Pas d'adresse IP externe :** vérifiez que le Service LoadBalancer s'est vu
  attribuer une adresse IP ; cela peut prendre quelques minutes après la création du Service :
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **Pas d'administrateur / instance non revendiquée :** si vous n'avez pas créé le
  compte administrateur immédiatement après le premier accès, toute personne qui
  atteint l'adresse IP externe peut encore s'approprier l'instance — vérifiez qu'aucun
  compte administrateur inattendu n'existe déjà.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire
tourner l'un des sept identifiants internes générés automatiquement après le premier
démarrage, et la raison pour laquelle `stateful_pvc_enabled` doit rester à `true`).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le StatefulSet Kubernetes
et le namespace, le PVC en mode bloc et ses données, les secrets Secret Manager, le
bucket GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit une image d'encapsulation minimale et déploie un StatefulSet à une seule réplique avec un PVC de 20Gi sur `/data`, un bucket GCS, un Service LoadBalancer et sept secrets d'identifiants internes — pas de Cloud SQL |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; HTTP `/` renvoie 200 ; création du compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, maintenir la mise à l'échelle fixée à 1/1, mettre à jour la version, gérer les secrets (ne jamais les faire tourner) |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring, l'utilisation du disque du PVC et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC et ses données persistées |
