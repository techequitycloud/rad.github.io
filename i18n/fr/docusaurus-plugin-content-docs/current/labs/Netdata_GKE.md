---
title: "Netdata sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Netdata sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Netdata_GKE.md @ 3055034 sha256:bb18e8485448 -->

# Netdata sur GKE Autopilot — Guide de lab {#netdata-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netdata_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Netdata est un agent open source de surveillance en temps réel des infrastructures et des applications,
qui collecte des milliers de métriques par seconde et les restitue sur un
tableau de bord intégré et via une API REST. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **Netdata on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Netdata. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netdata_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, maintenir l'échelle à un seul réplica, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Netdata
   (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Netdata_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que `service_type`
   vaut par défaut `LoadBalancer` (accès externe) et `enable_admin_password`
   vaut par défaut `false` — tel quel, la charge de travail est donc joignable depuis
   l'extérieur du cluster via une adresse IP externe, et le tableau de bord de Netdata n'a **aucune
   connexion intégrée**. Contrairement à la variante Cloud Run (qui comporte une garde
   au moment du plan imposant `enable_admin_password = true` dès que l'entrée est
   publique), `Netdata_GKE` n'a pas de garde équivalente ; définissez donc
   `service_type = ClusterIP` pour rester uniquement en interne, ou activez
   `enable_admin_password` ainsi qu'un proxy inverse/IAP avant de l'exposer.
   Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**),
   ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image personnalisée légère (`FROM netdata/netdata:<pinned
   version>`), la pousse dans Artifact Registry et déploie la charge de travail dans
   le cluster GKE Autopilot sous forme de **StatefulSet** (le type de charge de travail
   résolu automatiquement, car `stateful_pvc_enabled = true` par défaut) avec un PVC bloc dédié
   de 20Gi `standard-rwo` (SSD) monté sur `/var/lib/netdata`. Un bucket Cloud
   Storage est également créé (pour le chemin de repli GCS FUSE, inutilisé
   tant que le PVC est activé). Il n'y a **aucune base de données** (`database_type =
   NONE`) et **aucun job d'initialisation** à attendre ; les premiers déploiements sont donc
   dominés par le build de l'image et la planification du pod — généralement **10 à 20
   minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres
   indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep netdata | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et que son PVC est lié :

   ```bash
   kubectl get pods,pvc -n "$NS"
   ```

2. Confirmez que le service est sain. Netdata expose un point de terminaison d'information qui
   ne répond qu'une fois l'agent initialisé. Comme `service_type`
   vaut par défaut `LoadBalancer`, vous pouvez l'atteindre directement via l'adresse IP externe ;
   `kubectl exec` ou une redirection de port fonctionnent aussi et sont utiles si vous avez changé
   `service_type` en `ClusterIP` :

   ```bash
   kubectl get svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl "http://${EXTERNAL_IP}:19999/api/v1/info"

   # or, from inside the cluster / when service_type = ClusterIP:
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- wget -qO- http://127.0.0.1:19999/api/v1/info
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 19999:19999
   # then open http://127.0.0.1:19999
   ```

3. Netdata n'a **ni assistant de premier démarrage ni étape de création de compte administrateur** —
   le tableau de bord est pleinement fonctionnel dès que le pod est Ready. Comme la
   valeur par défaut `service_type = LoadBalancer` l'expose déjà à l'extérieur,
   n'oubliez pas que le tableau de bord lui-même n'a **aucune authentification intégrée** : activez
   `enable_admin_password` et placez devant un proxy inverse avec authentification ou IAP
   — le secret généré ne protège pas à lui seul le tableau de bord de Netdata.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pods et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count` et
   `max_instance_count` valent tous deux `1` par défaut — le magasin de métriques dbengine de Netdata
   est écrit par un seul processus sur un seul PVC ; une mise à l'échelle horizontale risque
   de corrompre des fichiers ou de provoquer des conflits de verrous, et non de produire un tableau de bord partagé. Laissez ces valeurs à
   `1` sur la page de détails du déploiement.

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update**. `latest` est résolu en une
   étiquette figée connue pour fonctionner (`v2.2.6`) au moment du build, via l'argument de build propre à l'application
   `NETDATA_VERSION` — définissez une étiquette explicite pour suivre une
   autre version ; une mise à jour progressive remplace le pod du StatefulSet.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~netdata"
   kubectl get jobs -n "$NS"          # empty by default — Netdata has no init/migration jobs
   ```

5. **Surveillez l'empreinte du PVC sur le quota SSD.** La valeur par défaut de
   `stateful_pvc_storage_class` est `standard-rwo` (SSD), qui consomme le
   quota régional restreint `SSD_TOTAL_GB`. Si vous exécutez Netdata aux côtés de
   plusieurs autres modules avec état et qu'un pod reste bloqué en `Pending` avec `Quota
   'SSD_TOTAL_GB' exceeded`, redeploy with `-var
   stateful_pvc_storage_class=standard` (HDD) — le profil d'écriture de Netdata
   ne nécessite pas les IOPS d'un SSD. Ramener la charge de travail à zéro réplica libère le CPU et la mémoire
   mais **conserve le PVC** ; seule sa suppression récupère le quota.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU
   et de la mémoire des pods, le nombre de redémarrages et l'utilisation du PVC. Le module peut
   provisionner un **test de disponibilité** ciblant `/api/v1/info` (désactivé par
   défaut, et utile seulement une fois le Service joignable publiquement) ; s'il est activé, examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Netdata.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de vivacité
  et de démarrage ciblent toutes deux `/api/v1/info` (démarrage : délai initial de 15 s,
  10 tentatives).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué en `Pending` avec une erreur de quota de PVC :** vérifiez si
  `SSD_TOTAL_GB` est épuisé (voir la tâche 3, point 5) et, le cas échéant, passez
  `stateful_pvc_storage_class` à `standard`.
- **Métriques corrompues ou perdues :** confirmez que `stateful_pvc_enabled` vaut toujours
  `true`. Le désactiver entraîne un repli sur un montage GCS FUSE, qui n'est **pas**
  sûr comme périphérique bloc pour les fichiers dbengine de Netdata et peut corrompre la base de
  métriques — il s'agit d'une contrainte de conception délibérée, et non d'un bug passager.
- **Tableau de bord public de manière inattendue :** revérifiez `service_type` et toute
  configuration `application_domains` — la valeur par défaut du module (`LoadBalancer`)
  est déjà joignable depuis l'extérieur telle quelle, sans authentification
  intégrée et sans garde au moment du plan imposant `enable_admin_password`. Définissez
  `service_type = ClusterIP` pour rester uniquement en interne, ou activez
  `enable_admin_password` ainsi qu'un proxy inverse ou IAP s'il doit rester
  public.
- **Erreurs de récupération / de build d'image :** confirmez que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer ; consultez l'historique de Cloud Build
  si `application_version` a été figé sur une étiquette inexistante en amont.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris le compromis lié au quota SSD et la contrainte de
persistance PVC contre GCS FUSE).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, le PVC (et avec lui tout l'historique de surveillance accumulé), le
bucket GCS de repli, tout secret Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit une image personnalisée figée et déploie un StatefulSet avec un PVC SSD de 20Gi — ni base de données, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; le tableau de bord est immédiatement utilisable (aucune configuration d'administrateur) ; le `LoadBalancer` par défaut l'expose à l'extérieur sans authentification intégrée |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, maintenir un seul réplica, mettre à jour la version, gérer les secrets et le stockage, surveiller le quota SSD |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota, de mode de persistance et d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC et l'historique des métriques accumulé |
