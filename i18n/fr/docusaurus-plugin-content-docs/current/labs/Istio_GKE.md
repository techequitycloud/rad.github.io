---
title: "Istio sur GKE — Guide de lab"
description: "Lab pratique : déployez Istio sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Istio_GKE.md @ 3055034 sha256:71cb42908968 -->

# Istio sur GKE — Guide de lab {#istio-on-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Istio_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Istio est le **service mesh** open source de référence — une couche d'infrastructure transparente qui gère, sécurise et observe le trafic de service à service dans un cluster Kubernetes sans aucune modification du code des applications. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Istio on GKE** sur Google Cloud : le déployer, vérifier que le mesh est installé et que des charges de travail peuvent y être inscrites, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le module installe **Istio open source** (via `istioctl`) sur un cluster **GKE Standard** dans l'un des deux modes de plan de données — **sidecar** (un Envoy par pod) ou **ambient** (un ztunnel par nœud) — accompagné de la pile d'observabilité Prometheus, Grafana, Jaeger et Kiali.

Ce lab porte sur l'exploitation du **module et de la plateforme Google Cloud**, et non sur chaque fonctionnalité d'Istio. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Istio_GKE) — ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et vérifier que le mesh est installé et sain.
- Inscrire une charge de travail dans le mesh et vérifier le comportement sidecar ou ambient.
- Effectuer les opérations du jour 2 — inspecter le plan de contrôle, l'Ingress Gateway et les outils d'observabilité.
- Observer le mesh avec Cloud Logging, Cloud Monitoring et les outils Istio du cluster.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login` exécutés.
- **istioctl** installé localement (ou utilisez la copie que le module télécharge sur l'hôte de déploiement) — `curl -L https://istio.io/downloadIstio | sh -`.
- Le rôle IAM **Project Owner** (ou `container.admin` + `compute.networkAdmin` + `iam.serviceAccountAdmin` + `resourcemanager.projectIamAdmin` + `serviceusage.serviceUsageAdmin` — les deux derniers sont requis parce que le module active des API du projet et crée des liaisons IAM au niveau du projet pour le compte de service des nœuds) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
export CLUSTER="gke-cluster"          # matches the gke_cluster input
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Istio (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres. Les choix essentiels sont `install_ambient_mesh` (`false` pour le mode sidecar, `true` pour le mode ambient) et `istio_version`. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Istio_GKE) documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme crée un VPC et Cloud NAT, provisionne un cluster GKE Standard (un pool de nœuds régional de 2 nœuds `e2-standard-2` préemptifs **par zone** — 8 nœuds dans une région à 4 zones comme `us-central1`), puis exécute l'étape d'installation d'Istio : elle télécharge `istioctl`, installe Istio avec le profil choisi, ajoute à l'espace de noms `default` le libellé d'inscription au mesh, et installe les modules complémentaires Prometheus, Grafana, Jaeger et Kiali. Les premiers déploiements prennent environ **15 à 25 minutes** (la création du cluster et l'installation du mesh représentent l'essentiel du temps).

3. Connectez-vous au cluster (la sortie `cluster_credentials_cmd` vous donne la commande exacte) :

   ```bash
   gcloud container clusters get-credentials "$CLUSTER" --region "$REGION" --project "$PROJECT"
   kubectl get nodes -o wide
   kubectl get all -n istio-system
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le plan de contrôle et la pile d'observabilité sont en cours d'exécution :

   ```bash
   kubectl get pods -n istio-system
   istioctl version
   istioctl verify-install
   istioctl proxy-status            # proxies synced to istiod
   ```

2. Vérifiez le mode de plan de données installé :

   ```bash
   # Sidecar mode — default namespace labelled istio-injection=enabled
   kubectl get namespace default --show-labels | grep istio-injection

   # Ambient mode — default namespace labelled istio.io/dataplane-mode=ambient
   kubectl get namespace default --show-labels | grep dataplane-mode
   kubectl get daemonset ztunnel -n istio-system           # ambient only
   ```

3. Trouvez l'IP externe de l'Ingress Gateway (ne vous fiez pas à la sortie `external_ip` — lisez-la depuis le Service) :

   ```bash
   INGRESS_IP=$(kubectl get svc istio-ingressgateway -n istio-system \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Ingress Gateway IP: ${INGRESS_IP}"   # may take 1–2 minutes to appear
   ```

4. Le module installe le mesh mais **ne déploie pas d'application d'exemple**. Inscrivez une charge de travail pour vérifier que l'inscription fonctionne. L'espace de noms `default` porte déjà le libellé ; déployez donc l'exemple Istio Bookinfo (fourni dans la version d'Istio téléchargée, ou récupéré directement) :

   ```bash
   kubectl apply -n default \
     -f https://raw.githubusercontent.com/istio/istio/release-1.30/samples/bookinfo/platform/kube/bookinfo.yaml

   # Sidecar mode: pods show 2/2 (app + istio-proxy). Ambient mode: pods show 1/1.
   kubectl get pods -n default
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le plan de contrôle et la passerelle :**

   ```bash
   kubectl get deploy,svc,hpa -n istio-system
   kubectl describe deploy istiod -n istio-system
   istioctl proxy-status
   ```

2. **Changez le mode ou la version d'Istio** en modifiant `install_ambient_mesh` ou `istio_version` et en cliquant sur **Update** sur la page de détails du déploiement. Le module possède l'installation, il s'agit donc d'une modification de configuration. Notez que changer de mode de plan de données équivaut à une réinstallation — prévoyez une fenêtre de maintenance.

3. **Imposez le mTLS strict** une fois que toutes les charges de travail d'un espace de noms sont inscrites, puis vérifiez :

   ```bash
   kubectl apply -f - <<'EOF'
   apiVersion: security.istio.io/v1
   kind: PeerAuthentication
   metadata:
     name: default
     namespace: default
   spec:
     mtls:
       mode: STRICT
   EOF
   kubectl get peerauthentication -n default
   ```

4. **Inspectez la configuration des proxys / du plan de données :**

   ```bash
   # Sidecar mode
   istioctl proxy-config all <pod> -n default
   # Ambient mode
   istioctl ztunnel-config workloads
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Observabilité dans le cluster** — effectuez une redirection de port vers les modules complémentaires (ils ne sont pas exposés à l'extérieur) :

   ```bash
   kubectl port-forward svc/kiali 20001:20001 -n istio-system      # http://localhost:20001 — service graph + mTLS padlocks
   kubectl port-forward svc/grafana 3000:3000 -n istio-system      # http://localhost:3000 — Istio dashboards
   kubectl port-forward svc/tracing 16686:80 -n istio-system       # Jaeger — distributed traces
   kubectl port-forward svc/prometheus 9090:9090 -n istio-system   # raw metrics / PromQL
   ```

2. **Cloud Logging** — interrogez les journaux du plan de contrôle du mesh et du cluster :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="istio-system"' \
     --project "$PROJECT" --limit 50
   ```

3. **Cloud Monitoring** — ouvrez les tableaux de bord GKE / Kubernetes pour le CPU et la mémoire des nœuds et des pods, le nombre de redémarrages et les métriques de requêtes. Les métriques Istio (par exemple `istio_requests_total`) sont également disponibles via Managed Prometheus dans **Monitoring → Metrics Explorer (PromQL)**.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Istio.

- **L'Ingress Gateway n'a pas d'IP externe :** cela peut prendre 1 à 2 minutes ; si elle reste `<pending>`, consultez `kubectl describe svc istio-ingressgateway -n istio-system` et le quota d'équilibreurs de charge du projet.
- **Échec de l'installation d'Istio pendant le déploiement :** consultez les journaux de la page d'état du déploiement. La cause la plus fréquente est une `istio_version` invalide (le téléchargement d'`istioctl` échoue) ou des nœuds qui ne passent pas à l'état Ready à temps (des nœuds préemptifs ont été récupérés). Relancez **Update** après avoir corrigé la version.
- **Un pod n'a pas de sidecar (mode sidecar) :** vérifiez le libellé d'espace de noms `istio-injection=enabled` et rappelez-vous que **les pods existants doivent être redémarrés** (`kubectl rollout restart`) pour recevoir un sidecar.
- **Charge de travail non inscrite (mode ambient) :** vérifiez `istio.io/dataplane-mode=ambient` sur l'espace de noms et que le DaemonSet `ztunnel` dispose d'un pod sur chaque nœud (`kubectl get pods -n istio-system -l app=ztunnel -o wide`).
- **Problèmes de mTLS / de connectivité :** exécutez `istioctl analyze -A` pour valider la configuration et `istioctl proxy-status` pour vérifier que les proxys sont synchronisés avec `istiod`.
- **Pod en CrashLoopBackOff :** `kubectl describe pod -n <ns> <pod>` (Events) et `kubectl logs -n <ns> <pod> --previous`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` : elle désinstalle proprement Istio et les modules complémentaires d'observabilité, supprime l'espace de noms `istio-system`, puis démantèle le cluster GKE, le pool de nœuds, le compte de service, le VPC, les règles de pare-feu et Cloud NAT créés par ce module. La suppression est irréversible (l'enregistrement du déploiement est conservé pour l'historique).

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Après une purge, nettoyez manuellement les ressources restantes.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le VPC + le cluster GKE Standard et installe Istio (sidecar ou ambient) ainsi que la pile d'observabilité |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; plan de contrôle sain ; mode de plan de données confirmé ; une charge de travail s'inscrit dans le mesh |
| 3 — Exploiter | Manuel | Inspecter le plan de contrôle et la passerelle, changer de version/mode via Update, imposer le mTLS strict, inspecter la configuration des proxys |
| 4 — Observer | Manuel | Utiliser Kiali/Grafana/Jaeger/Prometheus ; interroger Cloud Logging et Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'IP d'entrée, d'installation, d'inscription sidecar/ambient, de mTLS et de pods |
| 6 — Démanteler | Automatisé | La suppression (Trash) désinstalle Istio et retire toutes les ressources du module |
