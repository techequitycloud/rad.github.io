---
title: "Hermes Agent sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Hermes Agent sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Hermes_GKE.md @ 3055034 sha256:80dc906b5552 -->

# Hermes Agent sur GKE Autopilot — Guide de lab {#hermes-agent-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hermes_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Hermes Agent est l'agent d'IA personnel auto-hébergé et auto-améliorant de Nous Research —
il apprend des compétences par l'expérience, conserve une mémoire d'une session à l'autre et expose une
API compatible OpenAI ainsi que des connecteurs de messagerie depuis un unique processus de passerelle (gateway).
Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Hermes on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler. Comme
Hermes n'a **aucune base de données Cloud SQL**, les déploiements sont nettement plus rapides que pour la plupart des
modules de ce catalogue.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Hermes. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hermes_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et appeler l'API compatible OpenAI de la passerelle avec
  le jeton bearer généré automatiquement.
- Accéder au tableau de bord web de Hermes via `kubectl port-forward`.
- Effectuer les opérations du jour 2 — mettre à jour la version, renouveler les clés et vérifier que
  l'état de l'agent, stocké sur NFS, survit à un redéploiement.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement, en comprenant ce qu'il advient de l'état
  de l'agent.

## Prérequis {#prerequisites}

- **Services_GCP**, avec la VM du serveur NFS (`create_network_filesystem = true`)
  — il fournit le VPC, le cluster GKE Autopilot, Artifact Registry et les comptes de
  service partagés, et Hermes stocke l'intégralité de son identité sur le partage NFS
  partagé, la VM du serveur NFS est donc **obligatoire**. Vous n'avez pas besoin de la déployer ni de la
  configurer vous-même au préalable : `create_network_filesystem` est activé par défaut
  pour chaque déploiement automatisé, si bien que le Services_GCP provisionné automatiquement
  par la plateforme satisfait déjà cette exigence. Si vous déployez plutôt Services_GCP manuellement,
  ne désactivez pas ce paramètre. Pour vérifier que la VM du serveur NFS est `RUNNING`
  après le déploiement :
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  ```
- Un projet Google Cloud avec la **facturation activée**.
- Une **clé API Anthropic** (ou une clé OpenAI) — l'agent ne peut exécuter aucun tour
  sans au moins une clé de fournisseur de modèles.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Hermes (GKE)**
   depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et collez votre `anthropic_api_key`. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Hermes_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail de la passerelle à réplica unique (`min=1`, `max=1`)
   dans le cluster GKE Autopilot, provisionne les secrets Secret Manager (votre
   clé de fournisseur ainsi que `API_SERVER_KEY` et le mot de passe du tableau de bord, générés automatiquement),
   met en miroir l'image officielle `nousresearch/hermes-agent` dans Artifact Registry,
   l'expose via un Service LoadBalancer avec une IP statique réservée, et
   monte le NFS partagé sur `/opt/data`. Il n'y a **ni instance Cloud SQL, ni
   job d'initialisation de base de données, ni build d'image**, si bien que les premiers déploiements se terminent généralement en
   **10–20 minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep hermes | head -1 | cut -d/ -f2)
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
   SVC_PORT=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].spec.ports[0].port}')
   echo "External endpoint: ${EXTERNAL_IP}:${SVC_PORT}"
   ```

2. Le serveur d'API compatible OpenAI de la passerelle authentifie chaque requête avec
   le jeton bearer `API_SERVER_KEY` généré automatiquement. Récupérez-le dans Secret
   Manager et appelez l'API :

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~hermes AND name~api-server-key" \
     --format="value(name)" --limit=1)
   KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:${SVC_PORT}/v1/models"
   curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:${SVC_PORT}/v1/models" | wc -c  # expect a non-zero byte count
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:${SVC_PORT}/v1/models"  # expect 401/403
   ```

   Une liste de modèles au format JSON confirme que la passerelle est démarrée. Vérifiez aussi que le corps de la réponse
   n'est **pas vide** (la vérification `wc -c`) — un 200 avec un corps de longueur nulle signifie que
   le point de terminaison a été servi par le mauvais processus, et non par la passerelle.

3. Accédez au **tableau de bord web** (gestion des clés API, configuration des profils) via
   un port-forward — il s'exécute sur le port 9119 derrière une authentification basique et n'est volontairement pas
   exposé par le Service :

   ```bash
   DASH_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~hermes AND name~dashboard-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DASH_SECRET" --project="$PROJECT"; echo

   DEPLOY=$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NS" deploy/"$DEPLOY" 9119:9119
   # In a browser: http://localhost:9119 — user `admin`, password from the secret above
   ```

   Si vous avez activé Telegram (`enable_telegram` + jeton du bot), envoyez un message à votre bot —
   le connecteur interroge en long-polling vers l'extérieur, il fonctionne donc sans webhook ni URL de
   rappel publique.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, le pod et le montage NFS :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl exec -n "$NS" deploy/"$DEPLOY" -- df -h /opt/data
   ```

2. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update**. Comme Hermes repose sur NFS, la
   fondation utilise la stratégie `Recreate` — l'ancien pod s'arrête avant que le nouveau
   ne démarre (une brève interruption de disponibilité est attendue et protège la base de données SQLite
   d'un chevauchement de deux processus d'écriture). N'augmentez **pas** `max_instance_count` — une
   validation au moment du plan rejette toute valeur supérieure à 1.

3. **Renouvelez les clés.** Fournissez une nouvelle valeur pour `api_server_key` (ou
   `anthropic_api_key`) dans la plateforme RAD et cliquez sur **Update** — une nouvelle version Secret
   Manager est créée et le pod redémarre avec elle. Laisser un identifiant
   vide lors d'une mise à jour conserve la version stockée :

   ```bash
   gcloud secrets versions list "$API_SECRET" --project="$PROJECT"
   kubectl get secrets -n "$NS"
   ```

4. **Vérifiez que l'état survit à un redéploiement.** L'identité de l'agent (configuration SQLite,
   sessions, compétences apprises, mémoires) réside dans `/opt/data` sur le NFS partagé,
   et non dans le pod. Après la mise à jour de version de l'étape 2, listez le répertoire d'état
   depuis le nouveau pod et vérifiez qu'il est rempli (et non un répertoire neuf et vide) :

   ```bash
   kubectl exec -n "$NS" deploy/"$DEPLOY" -- ls -la /opt/data
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$DEPLOY" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Recherchez les lignes d'initialisation de s6-overlay et les messages de démarrage de la passerelle/du serveur d'API.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods ainsi que le nombre de redémarrages (attendez-vous à un seul pod stable — ce
   module est volontairement à réplica unique). Le test de disponibilité est désactivé par
   défaut (le serveur d'API exige une authentification), les alertes reposent donc sur des métriques — consultez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Hermes.

- **VM du serveur NFS non `RUNNING` → pod bloqué en `ContainerCreating`.** Si la
  VM NFS partagée est arrêtée ou en rupture de capacité (`ZONE_RESOURCE_POOL_EXHAUSTED` — un
  problème de capacité, et non de quota), le volume NFS ne peut pas être monté, ou bien la découverte ne trouve aucun
  serveur et le module tente de créer un NFS intégré
  (collisions `409 already exists`). Vérifiez d'abord la VM, attendez qu'elle soit `RUNNING`,
  puis redéployez :
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  kubectl describe pod -n "$NS" <pod>    # Events show mount failures explicitly
  ```
- **Clé de fournisseur de modèles manquante → l'agent ne peut exécuter aucun tour.** Le pod peut être Ready
  (la sonde TCP réussit) alors que chaque tour de l'agent échoue. Recherchez dans les journaux des erreurs
  d'authentification du fournisseur et vérifiez que le secret Anthropic a une version :
  ```bash
  gcloud secrets versions list "$(gcloud secrets list --project="$PROJECT" \
    --filter='name~hermes AND name~anthropic' --format='value(name)' --limit=1)" \
    --project="$PROJECT"
  ```
- **Pod non Ready / déploiement bloqué :** inspectez les événements et les journaux. Les sondes par défaut
  sont en TCP ; si quelqu'un les a basculées vers un chemin HTTP sur le serveur d'API authentifié,
  elles renvoient 401 indéfiniment et le pod ne devient jamais Ready — revenez au TCP.
  ```bash
  kubectl describe pod -n "$NS" <pod>
  kubectl logs -n "$NS" <pod> --previous
  ```
- **Échecs d'authentification du connecteur (Telegram) :** un jeton de bot erroné ou révoqué se traduit par
  des 401 répétés de `api.telegram.org` dans les journaux. Mettez à jour `telegram_bot_token`
  dans la plateforme et redéployez ; le connecteur fonctionne en long-polling, aucun enregistrement
  de webhook n'est donc en jeu.
- **Erreurs de récupération d'image :** vérifiez que l'image mise en miroir existe dans Artifact Registry
  et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment les règles essentielles selon lesquelles `max_instance_count`
reste à 1 et `enable_nfs` reste à true).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD
ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, les secrets Secret Manager et les images mises en miroir dans Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le serveur NFS,
le registre) sont gérées séparément et ne sont pas supprimées ici — en particulier,
**le répertoire d'état de l'agent sur l'export NFS partagé est conservé**, si bien qu'un
redéploiement ultérieur sur le même tenant se rattache à l'identité existante de l'agent.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE à réplica unique, les secrets Secret Manager, le miroir d'image, le LoadBalancer et le montage NFS — ni Cloud SQL, ni build |
| 2 — Accéder et vérifier | Manuel | L'appel authentifié à `/v1/models` réussit avec le jeton bearer de Secret Manager ; tableau de bord atteint via un port-forward sur 9119 |
| 3 — Exploiter | Manuel | Mettre à jour la version (stratégie Recreate), renouveler les clés, vérifier que l'état de `/opt/data` survit à un redéploiement |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner le pod unique stable et les métriques |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de disponibilité NFS, de clé de fournisseur, de sonde, de connecteur et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime les ressources du module ; l'état de l'agent sur le NFS partagé est conservé |
