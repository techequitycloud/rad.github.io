---
title: "Forgejo sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Forgejo sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démontage."
---

<!-- translated-from: docs/labs/Forgejo_GKE.md @ 3055034 sha256:64317d142b97 -->

# Forgejo sur GKE Autopilot — Guide de lab {#forgejo-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Forgejo_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Forgejo est un service Git auto-hébergé, léger et géré par sa communauté — un
fork de Gitea — qui fournit l'hébergement de dépôts, le suivi des tickets, les
pull requests, un exécuteur CI/CD intégré (Actions), la revue de code et un
registre de paquets, le tout à partir d'un unique binaire Go. Ce lab vous fait
parcourir l'ensemble du cycle de vie opérationnel du module
**Forgejo on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes
courants, puis le démonter.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Forgejo. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Forgejo_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Initialiser le premier compte administrateur Forgejo (aucun administrateur n'est créé automatiquement).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Cloud
  Filestore (NFS), Artifact Registry et les comptes de service partagés dont
  dépend ce module). Vous n'avez pas besoin de le déployer vous-même au
  préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Forgejo (GKE)**
   dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Forgejo_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Laissez `database_type` à sa
   valeur par défaut `POSTGRES_15` — c'est le seul moteur que prend en charge le script
   d'initialisation de la base de données du module, même si MySQL/`NONE` apparaissent dans la liste déroulante.
   Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**),
   ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) accessible via un
   sidecar Cloud SQL Auth Proxy, monte Cloud Filestore (NFS) pour le stockage
   des dépôts, de LFS et des pièces jointes, génère les secrets `SECRET_KEY` et
   `INTERNAL_TOKEN` dans Secret Manager, construit l'image de conteneur et
   exécute un job ponctuel d'initialisation de la base de données. Les
   premiers déploiements prennent environ **20–35 minutes** (la création de
   Cloud SQL représente l'essentiel de ce temps).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep forgejo | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Le Service est exposé derrière une Gateway dotée d'une adresse IP statique
   réservée ; si aucun domaine personnalisé n'a été fourni, un nom d'hôte HTTPS
   `nip.io` provisionné automatiquement est également accessible (voir la sortie
   `service_url`).

2. Confirmez que le service est en bonne santé. Forgejo expose un point de
   terminaison de santé non authentifié qui ne répond correctement qu'une fois
   ses migrations de schéma du premier démarrage terminées :

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/healthz"   # a healthy instance returns {"status":"pass"}
   ```

3. **Initialisez le premier administrateur.** Contrairement à la variante Cloud
   Run, ce module ignore entièrement le programme d'installation web de Forgejo
   (`GITEA__security__INSTALL_LOCK
   = "true"`) et **aucun job d'initialisation ne crée de compte administrateur** —
   rien ne crée à l'avance un utilisateur privilégié. L'inscription libre est
   ouverte par défaut (`GITEA__service__DISABLE_REGISTRATION = "false"`) ; la
   démarche pratique consiste donc à : créer un compte ordinaire via l'interface
   à `http://${EXTERNAL_IP}/`, puis le promouvoir administrateur depuis le pod en
   cours d'exécution à l'aide de la CLI propre à Forgejo :

   ```bash
   kubectl exec -n "$NS" deploy/<service-name> -- forgejo admin user create --help
   # then, once the exact flags are confirmed against your deployed version:
   kubectl exec -n "$NS" deploy/<service-name> -- forgejo admin user create \
     --username <admin-user> --email <admin-email> --password '<strong-password>' --admin
   ```

   > L'invocation exacte de la CLI, ainsi que la présence du binaire `forgejo`
   > dans le `PATH` du conteneur, n'ont pas été revérifiées sur un pod réel pour
   > ce guide — exécutez d'abord la variante `--help` pour confirmer avant de
   > l'automatiser dans un script.

4. Définissez `public_domain` (et éventuellement `public_url`) sur le véritable
   nom d'hôte externe et appliquez via **Update** — tous deux valent `localhost`
   par défaut, ce qui produit des URL de clonage Git erronées et des liens
   cassés tant qu'ils ne sont pas remplacés. Une fois le compte administrateur
   créé, envisagez de définir
   `GITEA__service__DISABLE_REGISTRATION = "true"` (via `environment_variables`)
   si l'instance ne doit pas être ouverte aux inscriptions publiques.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et les montages PVC/NFS :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances et en cliquant sur **Update** sur la page de détails du
   déploiement — le module est propriétaire de la spécification de la charge de
   travail : la mise à l'échelle est donc une modification de configuration, et
   non un `kubectl scale` manuel (une modification manuelle serait annulée lors
   de l'application suivante). `max_instance_count` vaut `3` par défaut, mais
   chaque réplica partage les mêmes données de dépôts sur NFS et la même base
   de données Postgres — la cohérence des écritures concurrentes entre réplicas
   n'est pas documentée pour ce module ; abordez donc toute mise à l'échelle
   au-delà d'un unique réplica en régime établi avec la même prudence que pour
   toute charge de travail sur système de fichiers partagé. L'affinité de
   session (`ClientIP`) est définie par défaut pour qu'un client reste dirigé
   vers le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update**. Comme
   Forgejo s'appuie par défaut sur NFS, le Deployment utilise la stratégie de
   déploiement **`Recreate`** plutôt qu'une mise à jour progressive : l'ancien
   pod est entièrement arrêté avant le démarrage du nouveau. Attendez-vous à
   une brève interruption de service pendant une mise à jour — c'est un
   comportement attendu et sûr (il empêche deux pods d'écrire simultanément
   dans les mêmes données de dépôts et la même base de données), et non un
   déploiement bloqué.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~forgejo"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. forgejodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^forgejo" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Mise en garde concernant Redis.** `enable_redis = true` par défaut et
   `REDIS_HOST`/`REDIS_PORT` sont injectées dans le conteneur, mais Forgejo
   n'est pas configuré pour les utiliser (`GITEA__cache__*`/`GITEA__session__*`
   ne sont pas définies) — il se rabat dans tous les cas sur ses valeurs par
   défaut intégrées de cache et de session en mémoire. Si vous n'avez pas
   l'intention d'ajouter vous-même ce câblage via `environment_variables`,
   laisser Redis provisionné n'apporte aucun avantage fonctionnel.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du processeur et de la mémoire des pods, le nombre de
   redémarrages et les métriques de requêtes. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsqu'il est activé) ; examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme,
qui ne changent pas d'une version de Forgejo à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les
  journaux. La sonde de démarrage (`GET /api/healthz`, `initial_delay_seconds=0`,
  `period_seconds=30`, `failure_threshold=10` — soit environ 5 minutes de
  tolérance) et la sonde de vivacité (`initial_delay_seconds=60`,
  `period_seconds=30`, `failure_threshold=3`) ciblent toutes deux le même point
  de terminaison de santé non authentifié ; un échec de connexion à PostgreSQL
  empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE`. Forgejo y accède via un sidecar Cloud SQL Auth Proxy sur
  `127.0.0.1:5432` (`SSL_MODE=disable` pour ce saut) ; le point d'entrée de la
  plateforme journalise le câblage résolu (`Forgejo DB wired: host=... sslmode=... name=...
  user=...`) — vérifiez-le avec :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep GITEA__
  ```
- **Échec du job d'initialisation :** inspectez le job `db-init` et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Le déploiement d'une mise à jour semble bloqué :** comme le Deployment
  utilise `Recreate` (stockage NFS), vous verrez brièvement zéro pod Ready
  entre l'arrêt de l'ancien pod et le démarrage du nouveau — c'est attendu et
  se résout dès que le nouveau pod réussit sa sonde de démarrage ; il ne
  s'agit pas d'un véritable blocage. Si la situation persiste bien au-delà de
  la tolérance d'environ 5 minutes de la sonde de démarrage, traitez-la comme
  une véritable défaillance et inspectez les événements et journaux du nouveau
  pod comme ci-dessus.
- **Pod en attente (Pending) / pas d'adresse IP externe :** consultez les
  événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer dispose d'une adresse IP
  attribuée (`reserve_static_ip = true` par défaut maintient l'adresse stable
  d'un redéploiement à l'autre).
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.
- **Aucun utilisateur administrateur / tout le monde peut s'inscrire :**
  comportement attendu par défaut — voir la tâche 2, étape 3, et envisagez de
  désactiver les inscriptions via `GITEA__service__DISABLE_REGISTRATION`
  une fois qu'un compte administrateur existe.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment les règles essentielles : ne
jamais faire tourner `SECRET_KEY`/`INTERNAL_TOKEN` après le premier démarrage,
ne jamais modifier `db_name`/
`db_user` après le premier déploiement, et conserver `database_type` à `POSTGRES_15`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible
(l'enregistrement du déploiement est conservé pour l'historique). Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles en conflit avec l'état Terraform),
utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette
action retire le déploiement des enregistrements de RAD **sans** détruire les
ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que
le module a créé — la charge de travail Kubernetes et son espace de noms, la
base de données Cloud SQL, les secrets Secret Manager (`SECRET_KEY`,
`INTERNAL_TOKEN` et le mot de passe de la base de données), le bucket Cloud
Storage inutilisé et les images Artifact Registry. Un job de nettoyage
du volume applicatif NFS, exécutée lors de la destruction, supprime également
les données de dépôts de Forgejo du volume Filestore partagé, dans la mesure du
possible (elle est ignorée si l'espace de noms a déjà disparu). Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL
partagée, le serveur NFS Filestore lui-même et le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), le stockage NFS et les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; créer puis promouvoir le premier compte administrateur via la CLI |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version (déploiement Recreate), gérer les secrets et le stockage, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de déploiement et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris les données applicatives NFS (dans la mesure du possible) |
