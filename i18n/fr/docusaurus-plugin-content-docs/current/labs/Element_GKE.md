---
title: "Element sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Element sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Element_GKE.md @ 3055034 sha256:e63406a52341 -->

# Element sur GKE Autopilot — Guide de lab {#element-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Element_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Element est le principal client web Matrix open source — une application de messagerie auto-hébergée,
chiffrée de bout en bout, qui s'exécute comme une application monopage statique et
se connecte au homeserver Matrix que vous indiquez. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Element sur GKE Autopilot** sur Google Cloud :
le déployer, le faire pointer vers un homeserver, le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les
fonctionnalités du produit Element. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Element_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Faire pointer Element vers un homeserver Matrix et vérifier la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 (day-2) — inspecter les pods, mettre à l'échelle les réplicas, mettre à jour la version et
  changer le homeserver cible.
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
- La **gcloud CLI** et **kubectl** authentifiés : `gcloud auth login`,
  `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un **homeserver Matrix** auquel se connecter — soit le serveur public `matrix.org` (la
  valeur par défaut), soit votre propre instance Synapse/Dendrite.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace>"       # from the deployment Outputs
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Element (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et renseignez
   `homeserver_url` / `homeserver_name` avec votre homeserver Matrix (ou laissez-les vides
   pour utiliser le serveur public `matrix.org`). Passez en revue les autres paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Element_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme build l'image Element personnalisée (une fine couche au-dessus de
   `vectorim/element-web` qui génère `config.json` au démarrage), la pousse dans
   Artifact Registry et provisionne le Deployment GKE ainsi qu'un Service LoadBalancer
   externe. Il n'y a **ni base de données, ni secret, ni bucket de stockage** à créer.
   Les premiers déploiements prennent environ **10–20 minutes** (le provisionnement des nœuds Autopilot et
   l'attribution de l'IP du LoadBalancer en représentent l'essentiel).

3. Une fois l'opération terminée, récupérez les identifiants du cluster et découvrez la charge de travail :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod répond et que son `config.json` d'exécution pointe vers votre homeserver :

   ```bash
   kubectl exec -n "$NAMESPACE" deploy/element -- env | grep HOMESERVER
   curl -s "http://$EXTERNAL_IP/config.json" | grep -E 'base_url|server_name'
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"       # expect 200
   ```

2. Ouvrez `http://$EXTERNAL_IP` (ou votre domaine personnalisé) dans un navigateur. Element charge son
   écran de connexion affichant le homeserver configuré. Connectez-vous avec un compte sur ce
   homeserver — l'authentification a lieu **entre votre navigateur et le homeserver**,
   et non dans le pod.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les pods, le Service et l'autoscaler :**

   ```bash
   kubectl get pods,svc,hpa -n "$NAMESPACE"
   kubectl describe deploy/element -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/element --tail=100
   ```

2. **Ajustez le plafond de mise à l'échelle** en modifiant `max_instance_count` et en cliquant sur **Update** — le
   module est propriétaire de la spécification de la charge de travail : la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de l'application suivante). **`min_instance_count`
   est fixé à 1, et pas seulement plafonné par le bas à 1 :** `element.tf` fixe en dur la valeur déployée à
   la valeur littérale `1` lors de la fusion de configuration, en ignorant la valeur donnée à `var.min_instance_count` —
   l'augmenter à 2 ou 3 via la plateforme n'a donc aucun effet sur le nombre réel de
   réplicas. Element est sans état et n'utilise pas d'affinité de session : les réplicas sont donc librement
   interchangeables ; seul `max_instance_count` (transmis via `var.max_instance_count`) est
   réellement ajustable.

3. **Changez le homeserver cible** en modifiant `homeserver_url` / `homeserver_name` dans la
   plateforme RAD et en cliquant sur **Update** — le point d'entrée réécrit `config.json` dans les
   nouveaux pods. Aucun nouveau build de l'image n'est nécessaire.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version et en l'appliquant via
   **Update** ; une nouvelle image est buildée et, comme `imagePullPolicy=Always` est défini pour
   l'étiquette personnalisée réutilisée, le déploiement récupère les nouvelles couches.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — stdout/stderr des pods (accès et erreurs nginx), depuis la CLI ou le Logs
   Explorer :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Surveillance** — ouvrez le tableau de bord de la charge de travail GKE et examinez le nombre de pods, l'utilisation du CPU et de
   la mémoire, ainsi que le nombre de redémarrages. Examinez l'éventuel test de disponibilité provisionné sous
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Element à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements du pod et les journaux nginx. La
  sonde de démarrage cible `/`, à laquelle nginx répond dès qu'il est lié au port 80.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=element
  kubectl logs -n "$NAMESPACE" deploy/element --tail=100
  ```
- **L'écran de connexion affiche le mauvais homeserver :** le point d'entrée écrit `config.json`
  à partir de `HOMESERVER_URL` / `HOMESERVER_NAME` ; vérifiez les variables d'environnement du pod en cours d'exécution (tâche
  2, étape 1) et changez la cible via **Update**.
- **Les utilisateurs peuvent charger l'interface mais pas se connecter :** le homeserver est injoignable ou
  incorrect — vérifiez qu'il sert l'API client-serveur Matrix
  (`curl -s <homeserver_url>/_matrix/client/versions`).
- **Aucune IP externe attribuée :** vérifiez le Service LoadBalancer et qu'une IP statique
  est réservée :
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Un nouveau build tourne avec l'ancienne image :** vérifiez que le digest de l'image du pod correspond à celui qui vient d'être buildé ;
  `imagePullPolicy=Always` devrait récupérer les nouvelles couches lors du déploiement.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris l'exigence d'unités binaires pour `quota_memory_*`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud. Cela supprime tout ce que le module a créé
— le Deployment GKE, le Service, l'IP du LoadBalancer et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster, le registre) sont gérées
séparément et ne sont pas supprimées ici.

Element étant sans état, il n'y a ni base de données, ni secret, ni PVC, ni bucket de stockage à
nettoyer — le démantèlement est propre et rapide.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module build l'image Element et provisionne le Deployment GKE et le LoadBalancer (ni base de données, ni secret, ni stockage) |
| 2 — Accéder et vérifier | Manuel | `config.json` pointe vers votre homeserver ; connexion via le flux navigateur-vers-homeserver |
| 3 — Exploiter | Manuel | Inspecter les pods, mettre à l'échelle les réplicas, changer le homeserver cible, mettre à jour la version |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de configuration du homeserver, de connexion, de LoadBalancer et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
