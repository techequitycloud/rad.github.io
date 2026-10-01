---
title: "Prowlarr sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Prowlarr sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Prowlarr_GKE.md @ 3055034 sha256:7e7a8c920e3a -->

# Prowlarr sur GKE Autopilot — Guide de lab {#prowlarr-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Prowlarr est le gestionnaire d'indexeurs central de la suite d'automatisation multimédia *arr
(Sonarr, Radarr, Lidarr, Readarr) — au lieu de configurer les indexeurs
séparément dans chaque application, les opérateurs les configurent une seule fois dans Prowlarr, qui
synchronise cette configuration vers l'API de chaque application connectée. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **Prowlarr on GKE Autopilot** :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

**C'est le seul lab consacré à Prowlarr dans ce catalogue.** Prowlarr est
disponible uniquement sur GKE — le système d'initialisation de l'image officielle (s6-overlay) ne peut pas s'exécuter dans
le bac à sable gVisor de Cloud Run, si bien qu'il n'existe aucune variante `Prowlarr_CloudRun` avec laquelle
le comparer. Consultez la
§3 du [Guide de configuration](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)
pour le compte rendu de diagnostic complet si vous êtes curieux d'en connaître la raison.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de gestion des indexeurs propres à Prowlarr. Pour la
liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)
— ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD (avec le PVC en mode bloc recommandé et un Service `LoadBalancer` joignable) et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution et la vérifier via son point de terminaison d'état non authentifié `/ping`.
- Comprendre la posture de Prowlarr, dépourvu d'identifiant par défaut, et activer l'authentification depuis l'interface web si vous le souhaitez.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle (ou plutôt, comprendre pourquoi il ne faut pas le faire) et mettre à jour.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris comprendre pourquoi Cloud Run n'est jamais la bonne cible pour cette application.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- **kubectl** installé, avec les identifiants du cluster obtenus (voir ci-dessous).
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Prowlarr (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. **Définissez explicitement `service_type =
   "LoadBalancer"`** — la valeur par défaut héritée de Foundation
   (`ClusterIP`) rend l'interface web de Prowlarr injoignable depuis l'extérieur du
   cluster. Laissez `stateful_pvc_enabled = true` (la valeur par défaut) pour disposer d'un véritable
   PVC en mode bloc hébergeant la base de données SQLite intégrée. Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail Kubernetes (un StatefulSet avec un
   PVC HDD de `20Gi` monté sur `/config`), un bucket Cloud Storage `storage`
   (provisionné mais non utilisé comme montage avec la disposition PVC par défaut) et le
   Service `LoadBalancer`. Prowlarr n'a ni base de données ni job d'initialisation à
   attendre, si bien que les premiers déploiements sont généralement rapides — **3 à 7 minutes**.

3. Une fois l'opération terminée, identifiez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep prowlarr | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

   Si `EXTERNAL_IP` est vide, l'IP du LoadBalancer est encore en cours de provisionnement —
   patientez une minute et relancez la dernière commande.

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est sain et répond :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect 1/1 Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/ping"                     # expect {"status":"OK"}
   ```

2. Ouvrez `http://$EXTERNAL_IP/` dans un navigateur. Prowlarr est livré **sans
   compte administrateur intégré par défaut** — l'interface est ouverte par défaut. Si vous
   souhaitez exiger une connexion, allez dans **Settings → General → Security** dans
   l'application et configurez-y l'authentification ; il s'agit entièrement d'un
   paramètre interne à l'application, et non de quelque chose que le module provisionne pour vous.

3. (Facultatif) Ajoutez un indexeur et connectez une application *arr depuis
   l'interface de Prowlarr — ce catalogue ne propose pas actuellement de modules Sonarr/Radarr/etc.,
   si bien que cette étape est un test de fumée autonome du workflow de test des indexeurs
   propre à Prowlarr plutôt qu'une synchronisation complète de bout en bout.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement :**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   kubectl get pvc -n "$NAMESPACE"
   ```

2. **Mise à l'échelle** — n'augmentez pas `max_instance_count` au-delà de `1`. La base de données SQLite
   intégrée de Prowlarr n'accepte qu'un seul écrivain ; exécuter plusieurs réplicas
   risque de corrompre `/config/prowlarr.db`. `min_instance_count` vaut déjà
   `1` par défaut (aucun démarrage à froid à craindre).

3. **Mettez à jour la version de l'application** via le flux **Update** de la plateforme
   RAD. Il n'y a aucun build personnalisé à reconstruire — un changement de version se contente de
   redéployer avec une nouvelle balise d'image amont.

4. **Gérez le PVC et les éventuels secrets personnalisés :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~prowlarr"   # empty by default — Prowlarr generates no secrets
   kubectl get pvc -n "$NAMESPACE"
   kubectl describe pvc -n "$NAMESPACE"
   ```

5. **Sauvegardez `/config`** si vous devez conserver les définitions d'indexeurs et les
   connexions de synchronisation des applications en dehors du PVC — Prowlarr n'a aucun job de sauvegarde
   intégré ; prenez un instantané du PVC ou exportez depuis Settings → System →
   Backup dans l'interface, si cette option est activée.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=100
   ```

   Dans Cloud Logging, filtrez :
   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="<namespace>"
   resource.labels.container_name="prowlarr"
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads du StatefulSet
   et examinez l'utilisation CPU/mémoire (Prowlarr est léger ; un CPU élevé
   de manière soutenue indique généralement une boucle de synchronisation d'indexeur ou un indexeur défaillant,
   et non un problème de plateforme).

3. **Tests de disponibilité** — désactivés par défaut (`uptime_check_config.enabled =
   false`). Si vous l'activez, vérifiez que `path` a été remplacé par `/ping`
   — le `path` par défaut de la variable est un `/api/health` obsolète hérité de
   la source à partir de laquelle ce module a été cloné, et fera échouer chaque contrôle s'il n'est pas modifié.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod non sain / CrashLoopBackOff :** inspectez les événements et les journaux du pod. La
  sonde de démarrage cible `/ping` avec un délai initial de 15 s et un seuil généreux de
  10 échecs — la cause habituelle est un pod réellement bloqué, et non un pod lent.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=200
  ```

- **Tenter plutôt de déployer Prowlarr sur Cloud Run :** ne le faites pas — il n'existe aucun
  module `Prowlarr_CloudRun`, et il n'y en aura pas. Le processus d'initialisation s6-overlay de
  l'image officielle ne peut pas s'exécuter dans le bac à sable gVisor de Cloud Run :
  trois déploiements de diagnostic réels distincts (configuration par défaut,
  avec un volume GCS ajouté, et avec davantage de CPU/mémoire) ont tous échoué
  de manière identique — aucune sortie du conteneur, pas même la bannière de démarrage
  de s6-overlay, et Cloud Run signalant « Application exec likely failed » à chaque
  fois. Cela exclut le stockage et le dimensionnement des ressources comme cause ; il s'agit d'une
  incompatibilité de plateforme qu'aucune configuration ne corrige. Utilisez `Prowlarr_GKE`.

- **PVC bloqué en `Pending` :** vérifiez la StorageClass et le quota régional.
  `stateful_pvc_storage_class` vaut `standard` (HDD) par défaut, précisément pour
  éviter le quota serré `SSD_TOTAL_GB` — si vous l'avez remplacé par
  `standard-rwo`/`premium-rwo` (SSD), vérifiez que vous disposez d'une marge de quota SSD.
  ```bash
  kubectl describe pvc -n "$NAMESPACE"
  ```

- **Interface web injoignable / aucune IP externe :** vérifiez que `service_type =
  "LoadBalancer"` a bien été défini au moment du déploiement — la valeur par défaut héritée
  du module est `ClusterIP`, qui n'obtient jamais d'IP externe.
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

- **Test de disponibilité toujours en échec après son activation :** le `path` par défaut de la
  variable `uptime_check_config` est un `/api/health` obsolète
  — remplacez-le par `/ping`. C'est la seule variable liée aux sondes qui n'est
  PAS corrigée automatiquement ailleurs dans le module (contrairement aux propres sondes de
  démarrage/liveness du pod, qui utilisent déjà `/ping`).

- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity du
  compte de service d'exécution de l'espace de noms.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud.
La suppression retire tout ce que le module a créé — le StatefulSet, le Service,
le PVC (et toutes les configurations d'indexeurs/de synchronisation d'applications qu'il contenait) et le bucket
GCS `storage`. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le StatefulSet GKE avec un PVC en mode bloc et un Service `LoadBalancer` ; ni base de données, ni job d'initialisation à attendre |
| 2 — Accéder et vérifier | Manuel | Pod `1/1 Running` ; `/ping` renvoie `200 {"status":"OK"}` ; interface ouverte sans identifiant par défaut sauf configuration |
| 3 — Exploiter | Manuel | Inspecter le déploiement progressif, comprendre la limite de mise à l'échelle `max=1`, mettre à jour la version, gérer le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; corriger le chemin obsolète du test de disponibilité si vous l'activez |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC et d'exposition du Service ; comprendre pourquoi Cloud Run n'est jamais la solution ici |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC et toutes les configurations d'indexeurs stockées |
