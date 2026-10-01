---
title: "Maybe Finance sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Maybe Finance sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/MaybeFinance_GKE.md @ 3055034 sha256:95dba73d812c -->

# Maybe Finance sur GKE Autopilot — Guide de lab {#maybe-finance-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/MaybeFinance_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Maybe (Maybe Finance) est une alternative open source et auto-hébergée à
Mint/Monarch pour la gestion des finances personnelles et du patrimoine — budget,
suivi de la valeur nette, catégorisation des transactions et agrégation
multi-comptes, construite sur Ruby on Rails. Ce lab vous fait parcourir tout le
cycle de vie opérationnel du module **Maybe Finance on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Maybe. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/MaybeFinance_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans
le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris ses
  dépendances obligatoires PostgreSQL et Redis.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Comprendre pourquoi le worker de jobs en arrière-plan Sidekiq colocalisé a besoin d'au moins
  un pod en cours d'exécution en permanence (`min_instance_count = 1`).
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  NFS/Redis Filestore, Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la
  plateforme détecte automatiquement s'il existe déjà dans le projet cible
  et, sinon, le provisionne avant ce module (voir la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Maybe Finance
   (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/MaybeFinance_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme construit une fine image d'encapsulation personnalisée `FROM
   ghcr.io/maybe-finance/maybe:stable`, déploie la charge de travail dans le cluster GKE
   Autopilot avec un sidecar `cloud-sql-proxy` (`enable_cloudsql_volume
   = true` sur GKE) à l'écoute sur `127.0.0.1:5432`, provisionne une base de données Cloud SQL
   (PostgreSQL 15), monte le volume NFS Filestore partagé dans
   `/opt/maybefinance/storage` (également la source par défaut de l'hôte Redis),
   crée le secret `SECRET_KEY_BASE` dans Secret Manager, provisionne un bucket de données
   `storage`, et exécute deux jobs ponctuels chaînés — `db-init`
   (crée la base de données, l'utilisateur et les droits, et pré-crée `pgcrypto`) suivi de
   `maybefinance-migrate` (`rails db:prepare`). Les premiers déploiements prennent environ
   **20 à 35 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep maybefinance | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est sain. L'application Rails de Maybe expose un point de terminaison
   de santé public et non authentifié, que ciblent également les sondes de démarrage et de vivacité
   de la plateforme :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/up"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Maybe s'exécute avec `SELF_HOSTED =
   "true"`, donc le **premier visiteur** qui atteint le déploiement enregistre le
   compte administrateur initial via l'interface web — aucun identifiant administrateur
   pré-provisionné n'existe dans Secret Manager. Enregistrez le compte administrateur rapidement ;
   quiconque dispose de l'URL et y arrive en premier s'approprie ce rôle.

4. Vérifiez que le worker en arrière-plan est actif — Sidekiq s'exécute dans le même processus, au sein
   du même pod que Rails/Puma, et ne démarre que si Redis était joignable au démarrage :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     --tail=50 | grep -i sidekiq
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et le sidecar du proxy :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl exec -n "$NS" deploy/<service-name> -- ps aux | grep -E 'puma|sidekiq'
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification de la charge de travail, donc
   la mise à l'échelle est une modification de configuration, et non un `kubectl scale` manuel (une
   modification manuelle serait annulée lors de la prochaine application). `min_instance_count = 1` est la
   valeur par défaut sur GKE (contrairement au `min = 0` de la variante Cloud Run) précisément pour que
   le worker Sidekiq colocalisé dispose toujours d'un pod pour exécuter la synchronisation des comptes,
   le traitement des imports et les notifications — ne réduisez pas à zéro en
   production. L'affinité de session (`ClientIP`) est définie par défaut pour maintenir
   les sessions authentifiées sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite `FROM
   ghcr.io/maybe-finance/maybe:<tag>` (via l'ARG de build propre à l'application `MAYBE_VERSION`)
   et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~maybefinance"
   kubectl get jobs -n "$NS"          # db-init and maybefinance-migrate
   ```

   Ne renouvelez jamais le secret `SECRET_KEY_BASE` après le premier démarrage — cela invalide
   toutes les sessions actives et rend les colonnes chiffrées par ActiveRecord définitivement
   illisibles.

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. maybefinancedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^maybefinance" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU
   et mémoire des pods (le processus combiné Rails + Sidekiq est
   gourmand en mémoire lors des imports et synchronisations), le nombre de redémarrages et les
   métriques de requêtes. Le module peut provisionner un **test de disponibilité** (lorsqu'il est activé) ;
   consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Maybe.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La
  sonde de vivacité cible `/up` avec environ 8 minutes de marge au premier
  démarrage (`initial_delay_seconds=60`, `failure_threshold=30` sur la sonde
  de démarrage) ; un sidecar `cloud-sql-proxy` bloqué ou une base de données injoignable empêchera
  le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`. Les pods GKE l'atteignent via le **sidecar Auth Proxy sur
  `127.0.0.1:5432`** (`enable_cloudsql_volume = true`, obligatoire sur GKE) avec
  `PGSSLMODE=disable` sur cette connexion de bouclage — consultez les journaux du conteneur
  sidecar en parallèle de ceux du conteneur de l'application.
- **Échec du job d'initialisation/de migration :** examinez le job et les journaux de son pod,
  en vérifiant `db-init` avant `maybefinance-migrate` (ce dernier dépend du
  premier) :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  kubectl logs -n "$NS" job/<maybefinance-migrate-job-name>
  ```
- **Les jobs en arrière-plan (synchronisation des comptes, imports, notifications) ne se déclenchent pas :**
  cela signifie généralement que Sidekiq n'a jamais démarré — vérifiez que `REDIS_URL` a été résolu
  avec une valeur non vide :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E 'REDIS_URL|REDIS_HOST'
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer s'est vu
  attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment les règles essentielles : ne jamais renouveler
`SECRET_KEY_BASE` après le premier démarrage, et le fait que `database_type` et
`enable_redis` sont contrôlés par des garde-fous au moment du plan qui rejettent tout ce qui n'est pas
PostgreSQL et un hôte Redis fonctionnel).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a créé —
la charge de travail Kubernetes et l'espace de noms, la base de données Cloud SQL, les secrets
Secret Manager et les buckets GCS `storage`/`data`. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, la VM NFS/Redis Filestore partagée,
l'hôte Cloud SQL partagé, Artifact Registry) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit une image d'encapsulation personnalisée, déploie la charge de travail GKE avec un sidecar Cloud SQL Auth Proxy, Cloud SQL (PostgreSQL 15), le câblage NFS/Redis, les secrets et les buckets de stockage, puis exécute `db-init` + `maybefinance-migrate` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé `/up` réussit ; enregistrer le compte administrateur initial dans l'interface ; vérifier que Sidekiq a démarré |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (conserver `min_instance_count ≥ 1` pour Sidekiq), mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données (sidecar Auth Proxy), de job d'initialisation/de migration, de jobs en arrière-plan, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module ; le NFS/Redis partagé, le cluster GKE et l'hôte Cloud SQL ne sont pas touchés |
