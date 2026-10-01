---
title: "Woodpecker CI sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Woodpecker CI sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Woodpecker_GKE.md @ 3055034 sha256:a2359d017716 -->

# Woodpecker CI sur GKE Autopilot — Guide de lab {#woodpecker-ci-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Woodpecker_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 75 minutes

Woodpecker CI est un moteur CI/CD léger et natif conteneurs — une alternative
plus simple et auto-hébergeable à Drone. Les pipelines sont définis dans des fichiers YAML, et
chaque étape de pipeline s'exécute dans son propre conteneur. Ce module regroupe le
serveur et l'agent Woodpecker dans un unique pod GKE Autopilot, l'agent
créant dynamiquement un Pod Kubernetes pour chaque étape de pipeline grâce à un
`Role` RBAC limité à l'espace de noms que ce module provisionne. Ce lab vous fait parcourir
le cycle de vie opérationnel complet du module **Woodpecker CI on GKE
Autopilot** : le déployer, connecter une véritable forge Gitea/Forgejo et exécuter un
vrai pipeline, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes
courants et le supprimer.

**Il n'existe pas de variante Cloud Run de ce module et il n'y en aura jamais.**
Le backend d'exécution de Woodpecker (`WOODPECKER_BACKEND=kubernetes`) a besoin d'un véritable
accès à l'API Kubernetes pour créer dynamiquement un pod pour chaque étape de pipeline —
Cloud Run n'a aucune API Kubernetes à appeler ni aucun privilège pour
docker-in-docker. Il s'agit d'une décision d'architecture permanente, de la même catégorie
que les autres modules de ce catalogue disponibles uniquement en Common+GKE (Kopia, RocketChat,
Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible, LobeChat, Supabase).

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités d'écriture de pipelines propres à Woodpecker, au-delà de ce qui est
nécessaire pour prouver que le déploiement fonctionne de bout en bout. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Woodpecker_GKE)
— ce lab ne reprend volontairement pas ce détail afin de rester exact
dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Comprendre pourquoi le serveur refuse de démarrer sans forge configurée, et
  enregistrer une véritable application OAuth Gitea/Forgejo pour rendre le déploiement
  réellement utilisable pour la CI.
- Déclencher un vrai pipeline et observer l'agent créer dynamiquement un
  Pod Kubernetes pour l'exécuter.
- Effectuer les opérations du jour 2 — inspecter le pod regroupant serveur et agent, l'autorisation
  RBAC et l'activité des pods de pipeline.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et de connexion les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, la capacité Cloud SQL,
  Artifact Registry et les comptes de service partagés dont dépend ce module).
  Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- **Une instance Gitea ou Forgejo joignable** auprès de laquelle enregistrer Woodpecker —
  le module `Forgejo_GKE` de ce catalogue convient. Sans elle, le
  déploiement démarre mais les pipelines ne peuvent pas se déclencher (voir la tâche 2).
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le
  projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Woodpecker
   (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Le module se déploie proprement avec
   les valeurs par défaut — y compris des identifiants de forge factices — si bien qu'un premier
   déploiement ne nécessite aucune modification au-delà de `project_id`/`tenant_id`.
   **Si vous disposez déjà d'une véritable application OAuth Gitea/Forgejo**, définissez
   `forge_url`/`forge_client_id`/`forge_client_secret` dès maintenant pour éviter
   l'aller-retour par Update de la tâche 2. Configurez tout autre élément nécessaire — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Woodpecker_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur personnalisée (l'image officielle du serveur
   Woodpecker avec le binaire de l'agent greffé, plus un shell busybox
   statique), génère un secret (`WOODPECKER_AGENT_SECRET`) dans Secret
   Manager, provisionne une base de données Cloud SQL PostgreSQL 15 via le job `db-init`,
   provisionne un `Role`/`RoleBinding` RBAC limité à l'espace de noms pour le
   backend d'exécution Kubernetes de l'agent, et déploie le pod regroupant
   serveur et agent. Le premier déploiement prend généralement **10 à 15 minutes**,
   principalement en raison du build de l'image et du provisionnement de Cloud SQL.

3. Connectez-vous au cluster et repérez l'espace de noms avec un filtre indépendant
   des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep woodpecker | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est en cours d'exécution et vérifiez son état de santé :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pods -n "$NS"                 # expect 1/1 Running

   # /healthz is unauthenticated and returns 204 — confirmed live
   kubectl exec -n "$NS" "$POD" -- wget -qO- --server-response http://localhost:8000/healthz 2>&1 | head -5
   ```

2. Trouvez l'adresse joignable du Service. Si le quota a imposé `service_type =
   "ClusterIP"` au moment du déploiement (voir le §6 du Guide de configuration — un
   choix fait au déploiement sur le déploiement de référence, et non une valeur par défaut du module),
   il n'y a pas d'IP externe ; utilisez plutôt une vérification depuis le cluster ou une
   redirection de port :

   ```bash
   kubectl get svc -n "$NS"

   # If LoadBalancer:
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"

   # If ClusterIP (no external IP), port-forward to reach the UI locally:
   kubectl port-forward -n "$NS" svc/<service-name> 8000:80
   # then browse http://localhost:8000
   ```

3. **Confirmez l'exigence de forge au démarrage.** Recherchez dans les journaux du pod la
   ligne de configuration de la forge — tant que les valeurs factices sont en place, le
   serveur est démarré mais reste inutilisable pour une véritable connexion via la forge :

   ```bash
   kubectl logs -n "$NS" "$POD" | grep -i gitea
   ```

   Si vous avez déployé avec les valeurs factices `forge_url`/`forge_client_id`/
   `forge_client_secret` (la valeur par défaut du module), l'interface web se charge mais la
   connexion via la forge et le déclenchement des pipelines ne fonctionnent pas — c'est attendu, pas un bogue.
   **C'est l'étape n° 1 après le déploiement** : enregistrer une véritable application OAuth.

4. **Enregistrez une véritable application OAuth Gitea/Forgejo.** Sur votre
   instance Gitea/Forgejo (par exemple le `Forgejo_GKE` de ce catalogue), allez dans
   **Settings → Applications → Manage OAuth2 Applications**, créez une nouvelle
   application avec l'URI de redirection `<woodpecker-url>/authorize` et notez
   l'identifiant client et le secret générés.

5. **Mettez à jour le déploiement** avec les véritables valeurs de la forge via le flux **Update**
   de la plateforme RAD (`forge_url`, `forge_client_id`,
   `forge_client_secret` et, éventuellement, `admin_username` pour correspondre à votre
   compte sur la forge). Confirmez que les valeurs ont bien été prises en compte :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50 | grep -i gitea
   ```

6. Ouvrez l'interface web de Woodpecker et connectez-vous via le flux OAuth de votre forge. Activez
   un dépôt depuis la liste des dépôts de l'interface, puis poussez un commit (ou déclenchez
   manuellement depuis l'interface) contenant un `.woodpecker.yml` minimal :

   ```yaml
   steps:
     - name: hello
       image: alpine
       commands:
         - echo "hello from the Woodpecker GKE lab"
   ```

7. **Observez l'agent créer dynamiquement un pod de pipeline** — cela prouve que
   l'autorisation RBAC et l'agent regroupé fonctionnent réellement de bout en bout, et pas seulement
   que le serveur a démarré :

   ```bash
   kubectl get pods -n "$NS" -w
   ```

   Vous devriez voir apparaître un pod éphémère (nommé d'après l'étape du pipeline),
   s'exécuter, puis être supprimé par l'agent une fois l'étape terminée. Confirmez le
   résultat du pipeline dans l'interface web de Woodpecker.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail regroupée :**

   ```bash
   kubectl get deployment,pods,svc -n "$NS"
   kubectl describe deployment -n "$NS"
   kubectl logs -n "$NS" "$POD" --tail=100     # server + agent share one log stream
   ```

2. **Inspectez l'autorisation RBAC de l'agent :**

   ```bash
   kubectl get role,rolebinding -n "$NS"
   kubectl describe role <resource-prefix> -n "$NS"
   kubectl describe rolebinding <resource-prefix> -n "$NS"
   ```

   Confirmez que le sujet du `RoleBinding` correspond au ServiceAccount réel
   du pod :

   ```bash
   kubectl get deployment -n "$NS" -o jsonpath='{.items[0].spec.template.spec.serviceAccountName}'
   ```

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update**. Une nouvelle image est construite
   (serveur + agent + busybox greffés de nouveau), le pod est recréé, et la
   logique idempotente du job `db-init` peut être réexécutée sans risque s'il se déclenche à nouveau.

4. **Ne dépassez pas une instance.** `max_instance_count` est plafonné strictement
   à `1` par une validation au moment du plan — chaque pod exécute un serveur et un agent
   regroupés, et le serveur de Woodpecker n'offre aucune coordination multi-instance
   documentée ni vérifiée pour son propre état stocké en base de données. Tenter
   de l'augmenter fait échouer le plan, et non l'apply.

5. **Récupérez le secret de l'agent** si vous devez un jour vérifier manuellement la
   connexion gRPC serveur↔agent :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~agent-secret"
   gcloud secrets versions access latest --project="$PROJECT" \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~agent-secret" --format='value(name)')"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — le serveur et l'agent partagent la sortie standard d'un même conteneur, si bien qu'un seul
   `kubectl logs` affiche les deux :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=100 -f
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads et examinez l'utilisation du CPU et
   de la mémoire des pods. Une rafale de pods de pipeline éphémères pendant un build
   actif est attendue et normale — l'agent en crée et en supprime un par
   étape de pipeline. `uptime_check_config` est **désactivé par défaut** ; s'il est
   activé, il cible `/healthz`.

3. **Activité des pods de pipeline** — une vue en direct de ce que fait l'agent en ce
   moment :

   ```bash
   kubectl get pods -n "$NS" --watch
   ```

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Le serveur démarre mais l'interface n'affiche aucune option de connexion / erreurs OAuth :** presque
  toujours, des identifiants de forge factices sont encore en place. Vérifiez :
  ```bash
  kubectl logs -n "$NS" "$POD" | grep -i gitea
  ```
  et confirmez que `WOODPECKER_GITEA_URL` pointe vers une instance Gitea/Forgejo réelle et
  joignable, avec une véritable application OAuth enregistrée — voir la
  tâche 2.

- **Pod en `CrashLoopBackOff` sans aucune forge configurée :** attendu
  et voulu — confirmé en conditions réelles, le serveur de Woodpecker s'arrête sur une erreur fatale
  (« forge not configured ») si toutes les variables de forge sont vides. Les
  valeurs factices par défaut de ce module évitent ce mode de défaillance précis ; si vous les avez
  remplacées par des chaînes vides, rétablissez au moins les valeurs factices ou de vraies
  valeurs.
  ```bash
  kubectl logs -n "$NS" "$POD" --previous
  ```

- **Les pipelines ne se déclenchent jamais, même avec une véritable forge configurée :** vérifiez que
  l'URI de redirection de l'application OAuth enregistrée correspond à l'URL
  réellement joignable du déploiement, et que `service_type` vaut `LoadBalancer` (et non
  `ClusterIP`) si la forge doit atteindre ce serveur via l'internet
  public pour livrer les webhooks — voir le point suivant.

- **Pas d'IP externe / les webhooks de la forge ne peuvent pas atteindre le serveur :** vérifiez
  `service_type` :
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
  S'il vaut `ClusterIP`, il s'agit très probablement d'un choix délibéré dicté par le quota
  au moment du déploiement (le déploiement de référence avait épuisé le quota
  `IN_USE_ADDRESSES`), et non de la valeur par défaut du module (`LoadBalancer`). Rétablissez-le
  dès que le quota le permet — voir le §6 du Guide de configuration.

- **Pipeline déclenché depuis l'interface, mais aucun pod n'apparaît :** vérifiez
  l'autorisation RBAC de l'agent — un `Role`/`RoleBinding` manquant ou mal configuré est
  la cause la plus probable sur GKE, puisque l'appel à l'API Kubernetes pour créer le
  pod de pipeline serait rejeté :
  ```bash
  kubectl get role,rolebinding -n "$NS"
  kubectl logs -n "$NS" "$POD" | grep -i -E "forbidden|rbac|permission"
  ```
  Confirmez aussi que le nom du ServiceAccount sujet du `RoleBinding` correspond au
  `serviceAccountName` réel du pod (voir la tâche 3, étape 2) — une non-concordance ici
  casse silencieusement les appels de création de pods de l'agent.

- **Échecs des sondes de démarrage/de vivacité sur un pod apparemment sain :**
  les sondes ciblent `GET /healthz`. Confirmez qu'il est réellement joignable et
  sans authentification depuis l'intérieur du pod :
  ```bash
  kubectl exec -n "$NS" "$POD" -- wget -qO- --server-response http://localhost:8000/healthz
  ```

- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry
  (`enable_image_mirroring = true` y reproduit l'image construite) et que le
  compte de service des nœuds peut la récupérer.

- **Vous essayez plutôt de déployer Woodpecker sur Cloud Run :** n'en faites rien — il n'existe pas de
  module `Woodpecker_CloudRun`, et il n'y en aura pas. Le backend d'exécution
  Kubernetes de Woodpecker a besoin d'un véritable accès à l'API depuis le cluster, que Cloud
  Run ne peut pas fournir, quelle que soit la configuration. Utilisez `Woodpecker_GKE`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris le piège de la forge factice, l'écart
`ClusterIP` dicté par le quota et deux valeurs par défaut de variables obsolètes héritées
de la source dont ce module a été cloné).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé —
la charge de travail Kubernetes, l'espace de noms, le `Role`/`RoleBinding` RBAC, la base de données
Cloud SQL et le secret Secret Manager `WOODPECKER_AGENT_SECRET`. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont gérées
séparément et ne sont pas supprimées ici.

> **Avant de supprimer**, notez que l'historique des pipelines ainsi que les
> dépôts et secrets configurés résident entièrement dans la base de données Cloud SQL que ce module
> provisionne — supprimer le déploiement supprime cette base de données avec
> tout le reste, sans étape d'export distincte intégrée à ce module.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image regroupée, génère le secret de l'agent, provisionne Cloud SQL + le job `db-init` et déploie le pod adossé au RBAC |
| 2 — Accéder et vérifier | Manuel | Confirmer `/healthz` ; enregistrer une véritable application OAuth Gitea/Forgejo ; déclencher un vrai pipeline et observer l'agent créer un pod pour lui |
| 3 — Exploiter | Manuel | Inspecter le pod regroupé et son autorisation RBAC, mettre à jour la version, comprendre la limite de mise à l'échelle `max=1` |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; observer en direct l'activité des pods de pipeline |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de forge au démarrage, de RBAC, d'exposition et de sondes |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris la base de données Cloud SQL et le secret de l'agent |
