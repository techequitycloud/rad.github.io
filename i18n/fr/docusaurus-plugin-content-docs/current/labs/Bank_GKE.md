---
title: "Bank of Anthos sur GKE — Guide de lab"
description: "Lab pratique : déployez Bank of Anthos sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Bank_GKE.md @ 3055034 sha256:11af26886a58 -->

# Bank of Anthos sur GKE — Guide de lab {#bank-of-anthos-on-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Bank_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 120 minutes

Bank of Anthos est l'application bancaire de référence open source de Google Cloud — une démonstration
de microservices polyglotte (services Python et Java avec deux bases de données PostgreSQL) qui imite une
banque de détail avec des comptes, un registre de transactions et une interface web. Ce lab vous fait
parcourir le cycle de vie opérationnel complet du module **Bank of Anthos on GKE** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud** — le cluster,
le service mesh géré, la flotte et l'observabilité — et non sur les fonctionnalités du produit bancaire.
Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Bank_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, atteindre l'interface de Bank of Anthos et confirmer que les pods et les sidecars du mesh s'exécutent.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et redémarrer progressivement les charges de travail.
- Observer la charge de travail avec les tableaux de bord du service mesh, Cloud Monitoring et Cloud Logging.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée** (il s'agit d'un module autonome — il n'y a pas
  de module de plateforme distinct à déployer au préalable).
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Votre propre projet uniquement.** Ce module masque l'option **GCP Project on RAD** (`enable_rad_gcpproject = false`) car il active des API que les politiques des paliers gérés par RAD refusent ; il se déploie donc toujours dans un projet que vous apportez. Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export CLUSTER="gke-cluster"         # matches the gke_cluster input
export NS="bank-of-anthos"           # the application namespace
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Bank of Anthos (GKE)** dans la
   liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Bank_GKE) documente chaque
   paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme crée un VPC et un sous-réseau dédiés, un cluster GKE Autopilot, enregistre le
   cluster dans la flotte, active Cloud Service Mesh, puis déploie les charges de travail Bank of Anthos `v0.6.10`
   dans le namespace `bank-of-anthos` et configure les services et les
   SLO Cloud Monitoring. Comme l'apply Terraform attend que le plan de contrôle du mesh soit actif avant de déployer
   l'application, les premiers déploiements prennent environ **30 à 45 minutes**.

3. Connectez-vous au cluster et confirmez que le namespace existe :

   ```bash
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get ns "$NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que chaque charge de travail s'exécute avec son sidecar de mesh. Chaque pod doit afficher **2/2 READY**
   (le conteneur de l'application plus le sidecar Envoy) :

   ```bash
   kubectl get pods -n "$NS"
   kubectl get namespace "$NS" --show-labels      # expect istio.io/rev=asm-managed
   ```

2. Trouvez l'adresse externe du frontend et accédez à l'interface de Bank of Anthos dans un navigateur. Le
   frontend est exposé via un Service LoadBalancer en HTTP simple :

   ```bash
   FRONTEND_IP=$(kubectl get svc frontend -n "$NS" \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Open: http://${FRONTEND_IP}"
   curl -sI "http://${FRONTEND_IP}/" | head -1     # expect HTTP 200
   ```

   Ouvrez `http://${FRONTEND_IP}` et connectez-vous avec les identifiants de démonstration intégrés
   (`testuser` / `bankofanthos`), puis consultez un solde, effectuez un dépôt et transférez des fonds.

3. Confirmez que le mesh géré est actif pour le cluster :

   ```bash
   gcloud container fleet mesh describe --project="$PROJECT"
   # Look for controlPlaneManagement.state: ACTIVE under the cluster's membership
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les charges de travail** — Deployments, pods, StatefulSets et volumes persistants :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy frontend -n "$NS"
   ```

2. **Mettez un service à l'échelle** pour ajouter de la capacité, et suivez le déploiement :

   ```bash
   kubectl scale deployment balancereader -n "$NS" --replicas=3
   kubectl get pods -n "$NS" -l app=balancereader -w
   ```

3. **Déclenchez une mise à jour progressive** et observez les pods se renouveler un par un :

   ```bash
   kubectl rollout restart deployment/frontend -n "$NS"
   kubectl rollout status deployment/frontend -n "$NS"
   ```

4. **Appliquez les modifications au niveau de l'infrastructure** (mode du cluster, région, activation ou non du mesh,
   de la surveillance, de l'application) en modifiant les paramètres et en cliquant sur **Update** sur la page de détails
   du déploiement — le module possède la configuration du cluster et des fonctionnalités ; il s'agit donc de
   modifications de configuration plutôt que de modifications manuelles via `gcloud`/`kubectl`.

5. **Examinez l'état de la flotte et des adhésions :**

   ```bash
   kubectl get nodes -o wide
   gcloud container fleet memberships list --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : télémétrie du mesh, tableaux de bord et journaux [Manuel] {#task-4--observe-mesh-telemetry-dashboards--logs-manual}

1. **Télémétrie du service mesh** — ouvrez Kubernetes Engine → Service Mesh pour voir la topologie
   des services en direct, les débits de requêtes, les taux d'erreur et la latence P99 par service. Le service
   `loadgenerator` génère en continu un trafic synthétique, de sorte que ces graphiques contiennent toujours des données.

2. **Surveillance et SLO** — ouvrez Monitoring → Services pour voir chaque microservice de Bank of Anthos
   enregistré en tant que service surveillé, chacun avec un SLO d'utilisation de la limite de CPU. Examinez la valeur
   du SLI, le budget d'erreur et le taux de consommation par service :

   ```bash
   gcloud monitoring services list --project="$PROJECT"
   ```

3. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" deploy/frontend --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="bank-of-anthos"`.

4. **Traces distribuées** — ouvrez Trace → Trace list. Les sidecars du mesh exportent les traces
   automatiquement ; une requête de connexion ou de virement apparaît donc sous la forme d'une cascade multiservice
   (`frontend` → `userservice`/`ledgerwriter` → bases de données).

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de Bank of Anthos.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué à l'état Pending :** sur Autopilot, il s'agit généralement d'un quota régional ou d'une spécification de pod
  non prise en charge. Consultez les événements de `kubectl describe pod` et essayez une autre région si le quota est en cause.
- **Les pods affichent 1/1 au lieu de 2/2 (pas de sidecar) :** confirmez que le libellé de namespace
  `istio.io/rev=asm-managed` est présent et que le mesh est `ACTIVE`
  (`gcloud container fleet mesh describe`). Redémarrez les pods concernés une fois le mesh prêt.
- **Frontend injoignable / pas d'adresse IP externe :** confirmez que le Service `frontend` dispose d'une adresse IP
  LoadBalancer attribuée (`kubectl get svc frontend -n "$NS"`) et que la règle de pare-feu HTTP existe.
- **Le mesh ne devient jamais actif pendant le déploiement :** le provisionnement du mesh est asynchrone et peut prendre
  de 10 à 20 minutes ; si l'apply Terraform a expiré, relancer le déploiement le termine généralement une fois que la
  fonctionnalité de flotte s'est stabilisée.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Cela supprime tout ce que le module a créé — les charges de travail Bank of Anthos et le
namespace (y compris toutes les données de `accounts-db` et `ledger-db`), le cluster GKE, l'adhésion
à la flotte et la fonctionnalité Cloud Service Mesh, les services de surveillance et les SLO, l'adresse IP
statique réservée, ainsi que le VPC avec son sous-réseau, Cloud NAT, son routeur et ses règles de pare-feu.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications
manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie
le déploiement). Après une purge, nettoyez manuellement les ressources restantes.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module crée le VPC, le cluster GKE, l'adhésion à la flotte, le mesh, et déploie Bank of Anthos |
| 2 — Accéder et vérifier | Manuel | Atteindre l'interface via l'adresse IP du LoadBalancer ; confirmer que les pods sont à 2/2 et que le mesh est actif |
| 3 — Exploiter | Manuel | Inspecter les charges de travail, mettre à l'échelle, redémarrer progressivement et appliquer les modifications de configuration via Update |
| 4 — Observer | Manuel | Examiner la télémétrie du mesh, les SLO Cloud Monitoring, les journaux et les traces |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, d'injection de sidecar, de réseau et de disponibilité du mesh |
| 6 — Supprimer | Automatisé | Delete (Trash) détruit toutes les ressources du module ; Purge le retire uniquement de RAD |
