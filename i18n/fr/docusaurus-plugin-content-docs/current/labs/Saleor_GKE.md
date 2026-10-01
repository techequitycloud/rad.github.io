---
title: "Saleor sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Saleor sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Saleor_GKE.md @ 3055034 sha256:bac452bdcb90 -->

# Saleor sur GKE Autopilot — Guide de lab {#saleor-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Saleor_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60–90 minutes

Saleor est une plateforme d'e-commerce headless open source, pensée d'abord pour GraphQL (catalogue
de produits, paiement de commande, commandes, plugins de paiement), construite sur Python/Django. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Saleor on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Saleor. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Saleor_GKE) — ce
lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à l'API Saleor et à la charge de travail Dashboard distincte, et les vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
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
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace-from-outputs>"
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Saleor (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Saleor_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut.

   > **Remarque sur le quota d'IP :** le module utilise par défaut `service_type = "LoadBalancer"`. Si le
   > quota d'IP externes du projet (`IN_USE_ADDRESSES`) est épuisé, définissez
   > `service_type = "ClusterIP"` dans les paramètres du déploiement (ou dans `config/deploy.tfvars`
   > pour une application par un mainteneur) — c'est exactement ce qu'exécute actuellement le déploiement de référence
   > en production de ce module. Revenez à `LoadBalancer` (avec
   > `reserve_static_ip = true`) une fois le quota disponible.

2. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui
   ouvre la page d'état du déploiement avec les journaux en temps réel.

3. La plateforme provisionne deux charges de travail Kubernetes (l'API Saleor principale et un
   Dashboard distinct), une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret
   Manager (`SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD`
   et le mot de passe de la base), un bucket Cloud Storage `media`, construit l'image
   de conteneur personnalisée et exécute deux jobs successifs d'initialisation de la base
   (`db-init` puis `db-migrate`). Les premiers déploiements prennent environ **20 à 35 minutes**
   (le provisionnement de Cloud SQL et du cluster GKE représente l'essentiel du temps).

4. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   NAMESPACE=$(kubectl get ns -o name | grep saleor | sed 's|namespace/||' | head -1)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -v dashboard | grep saleor | sed 's|service/||' | head -1)
   DASHBOARD=$(kubectl get svc -n "$NAMESPACE" -o name | grep dashboard | sed 's|service/||' | head -1)
   echo "Namespace: $NAMESPACE"
   echo "API svc:   $SERVICE"
   echo "Dashboard: $DASHBOARD"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Si `service_type = "ClusterIP"` (la valeur actuelle sur le déploiement de référence
   en raison de l'épuisement du quota d'IP — voir la tâche 1), accédez aux services via
   un transfert de port (port-forward) :

   ```bash
   kubectl port-forward -n "$NAMESPACE" svc/"$SERVICE" 18080:8000 &
   kubectl port-forward -n "$NAMESPACE" svc/"$DASHBOARD" 18081:80 &
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/health/"   # expect 200
   curl -s -X POST "http://localhost:18080/graphql/" \
     -H 'Content-Type: application/json' -d '{"query":"{ shop { name } }"}'
   ```

   Si `service_type = "LoadBalancer"`, utilisez plutôt l'IP externe fournie par
   `kubectl get svc -n "$NAMESPACE"`.

2. Récupérez l'identifiant du superutilisateur initial et connectez-vous via le Dashboard :

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~saleor-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   Ouvrez le Dashboard (via le port-forward sur `http://localhost:18081` ou via l'URL
   externe) et connectez-vous avec `admin@example.com` et le mot de passe récupéré.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et ses pods :**

   ```bash
   kubectl get deploy,pods,svc -n "$NAMESPACE"
   kubectl describe deploy "$SERVICE" -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle est une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application et ne préserverait pas les garanties de CPU du worker
   Celery).

3. **Mettez à jour le tag de version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite (associée à
   l'ARG de build `SALEOR_VERSION`) et une mise à jour progressive est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~saleor"
   kubectl get jobs -n "$NAMESPACE"   # db-init, db-migrate, scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. saleordemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^saleor" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer), pour les deux charges de travail :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   kubectl logs -n "$NAMESPACE" deploy/"$DASHBOARD" --tail=100
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — examinez l'utilisation CPU/mémoire des charges de travail GKE dans la console
   (Kubernetes Engine → Workloads). Le module peut provisionner un **test de disponibilité**
   (lorsque `uptime_check_config.enabled = true` — la valeur par défaut est `false`, et il
   exige un point de terminaison joignable publiquement, c'est-à-dire `service_type = "LoadBalancer"`) ;
   s'il est activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Saleor.

- **Pod non Ready :** examinez les événements et les journaux ; la sonde de démarrage cible `/health/`
  avec un délai initial de 90 secondes (ce qui laisse à `db-migrate` le temps de se terminer d'abord).
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  sidecar Cloud SQL Auth Proxy est sain et que `db-init` et `db-migrate` se sont tous deux terminés
  avec succès (dans l'ordre — `db-migrate` dépend de `db-init`).
- **Échec du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/db-migrate
  ```
- **Une requête GraphQL échoue avec une erreur de base de données alors que le pod est Ready :**
  cela signifie généralement que `db-migrate` ne s'est pas terminé — consultez les journaux de son job avant de conclure
  à un bogue applicatif.
- **Service injoignable depuis un navigateur :** vérifiez `service_type` — s'il vaut
  `ClusterIP` (l'état actuel du déploiement de référence en raison de l'épuisement du quota
  d'IP), vous devez utiliser `kubectl port-forward` ; il n'y a, par conception, aucune IP externe
  tant qu'il n'est pas basculé sur `LoadBalancer`.
- **Le Dashboard se charge mais ne parvient pas à joindre l'API :** l'`API_URL` du Dashboard est intégrée
  à son bundle statique au démarrage du conteneur, à partir de `$(GKE_SERVICE_URL)` — si le
  Service a été recréé avec un autre nom ou une autre IP, le Dashboard doit être
  redéployé pour prendre en compte l'URL corrigée.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les liaisons Workload Identity de la charge de travail.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle : ne jamais renouveler `RSA_PRIVATE_KEY` en dehors d'une
fenêtre de maintenance).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). La suppression retire tout ce que le module a créé — les deux charges de travail Kubernetes
(API et Dashboard), la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS
`media` et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le cluster GKE Autopilot, l'instance Cloud SQL partagée, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne deux charges de travail GKE (API + Dashboard), Cloud SQL (PostgreSQL 15), les secrets et le bucket `media`, puis exécute `db-init` → `db-migrate` |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état et la requête GraphQL réussissent (via port-forward si `ClusterIP`) ; connexion au Dashboard avec l'identifiant administrateur initial |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques des charges de travail GKE et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de liaison du Dashboard, de build et de Workload Identity |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
