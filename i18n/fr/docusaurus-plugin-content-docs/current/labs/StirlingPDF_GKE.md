---
title: "Stirling-PDF sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Stirling-PDF sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/StirlingPDF_GKE.md @ 3055034 sha256:3660df37f0e5 -->

# Stirling-PDF sur GKE Autopilot — Guide de lab {#stirling-pdf-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/StirlingPDF_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Stirling-PDF est une boîte à outils PDF web auto-hébergée — fusionner, scinder,
convertir, OCR, compresser, filigraner, signer, caviarder et plus de 50 autres
opérations PDF, toutes traitées sur votre propre infrastructure afin que les
documents ne passent jamais par un service tiers. Ce lab vous fait parcourir tout
le cycle de vie opérationnel du module **Stirling-PDF on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Stirling-PDF. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/StirlingPDF_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour la version et restreindre l'accès.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Stirling-PDF (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/StirlingPDF_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme met en miroir l'image officielle `stirlingtools/stirling-pdf` dans Artifact
   Registry et déploie la charge de travail dans le cluster GKE Autopilot avec un
   LoadBalancer externe. Il n'y a **ni base de données, ni bucket de stockage, ni secret** à
   provisionner — Stirling-PDF est sans état — les premiers déploiements sont donc rapides, généralement
   **10–15 minutes** (la mise en miroir de l'image et l'attribution de l'IP du LoadBalancer dominent).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep stirlingpdf | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est opérationnel. Stirling-PDF expose un point de terminaison d'état public qui
   ne renvoie 200 qu'une fois la JVM et LibreOffice entièrement initialisés :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/v1/info/status"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. La connexion étant désactivée par défaut, la
   boîte à outils est immédiatement utilisable — choisissez un outil (par ex. **Merge**), téléversez quelques
   PDF et téléchargez le résultat. Comme l'instance est ouverte, envisagez de restreindre l'accès
   avant une utilisation réelle (tâche 3, étape 4).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods, l'autoscaler horizontal et le
   PodDisruptionBudget :

   ```bash
   kubectl get deploy,pods,hpa,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).
   Stirling-PDF étant sans état, augmenter `max_instance_count` est sans risque, sans cache
   ni affinité de session requis. GKE exige `min_instance_count ≥ 1`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; le nouveau tag d'image est mis en miroir et une mise à jour progressive
   remplace les pods — sans étape de migration, puisqu'il n'y a pas de schéma.

4. **Restreignez l'accès.** L'instance par défaut est ouverte. Pour la rendre privée, définissez
   `enable_login = true` (l'authentification intégrée de Stirling-PDF) et/ou activez IAP sur
   l'Ingress, puis cliquez sur **Update**. Pour une instance publique, activez Cloud Armor
   (`enable_cloud_armor = true`) pour limiter les abus. Ne touchez pas à `enable_redis` —
   il amène seulement la fondation à injecter dans le pod des variables d'environnement `REDIS_*` inutilisées ;
   Stirling-PDF ne les lit jamais, il n'implémente donc ni limitation de débit ni détection
   de bots.

5. **Ajustez pour les documents volumineux** en augmentant `container_resources.memory_limit` et
   `timeout_seconds`, et plafonnez les téléversements avec `SYSTEM_MAXFILESIZE` via
   `environment_variables`.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Surveillez la mémoire pendant
   l'OCR/la conversion — une pression soutenue proche de la limite de 2Gi est le signal pour augmenter
   `container_resources.memory_limit`. Le module peut provisionner un **test de disponibilité** (uptime check)
   (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Stirling-PDF.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  cible `/api/v1/info/status` et laisse jusqu'à ~70 secondes à la JVM et à
  LibreOffice pour démarrer — ne la raccourcissez pas, sinon le pod est tué avant d'être prêt.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod OOMKilled pendant une conversion :** augmentez `container_resources.memory_limit`
  (plancher de 2Gi ; un OCR ou une conversion intensifs peuvent nécessiter 4Gi ou plus). Recherchez
  `Reason: OOMKilled` dans `kubectl describe pod`.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.
- **Déploiement progressif bloqué après une mise à jour :** un Deployment sans état utilise RollingUpdate
  en toute sécurité ; si un pod est bloqué, inspectez ses événements et l'état de ses sondes.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment garder l'instance restreinte lorsqu'elle traite des documents sensibles).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, ainsi que ses images Artifact Registry. Stirling-PDF étant sans état,
il n'y a ni base de données, ni bucket, ni secret à nettoyer. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module met l'image en miroir et déploie la charge de travail GKE sans état (ni base de données, ni stockage, ni secrets) |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le point de terminaison d'état renvoie 200 ; exécuter une opération PDF dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, restreindre l'accès, ajuster pour les fichiers volumineux |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, d'OOM, de planification, de récupération d'image et de déploiement progressif |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
