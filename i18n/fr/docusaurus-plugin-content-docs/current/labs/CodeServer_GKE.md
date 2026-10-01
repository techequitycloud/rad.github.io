---
title: "code-server sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez code-server sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/CodeServer_GKE.md @ 3055034 sha256:e9df784e48aa -->

# code-server sur GKE Autopilot — Guide de lab {#code-server-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

code-server est la version open source de Visual Studio Code développée par Coder, qui s'exécute sur un serveur distant et s'utilise entièrement depuis le navigateur — un IDE complet avec la place de marché d'extensions, un terminal intégré et un espace de travail persistant. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **code-server on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit code-server. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, repérer le namespace et vérifier que le pod s'exécute.
- Accéder à l'éditeur, récupérer le mot de passe généré dans Secret Manager et vérifier le service.
- Effectuer les opérations du jour 2 — inspecter la charge de travail, choisir entre un stockage d'espace de travail GCS FUSE ou PVC en mode bloc, et mettre à jour la version.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris l'interaction entre le chemin de sonde et le mot de passe.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **code-server (GKE)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image d'encapsulation légère au-dessus de `codercom/code-server` (répliquée
   dans Artifact Registry via Cloud Build) et planifie un pod unique sur le cluster GKE
   Autopilot (port 8080, 1 vCPU / 1 GiB par défaut). Par défaut, l'espace de travail
   est un volume **GCS FUSE** monté sur `/home/coder` ; définir `stateful_pvc_enabled =
   true` bascule plutôt vers un **StatefulSet avec un PVC en mode bloc**. Un
   `PASSWORD` aléatoire pour l'éditeur est généré et stocké dans Secret Manager. Il n'y a **ni instance
   Cloud SQL ni Redis** — code-server n'a pas de base de données. Les premiers déploiements
   prennent généralement **10–20 minutes** (le build de l'image et la planification du pod dominent ; il n'y a aucune
   base de données à attendre).

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep codeserver | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est Ready et contrôlez le type de Service — **le module utilise par défaut
   `ClusterIP`**, l'éditeur n'est donc joignable que depuis l'intérieur du cluster/VPC
   dès l'installation :

   ```bash
   kubectl get pods,svc -n "$NS"
   kubectl get svc -n "$NS" -o jsonpath='{.items[0].spec.type}'; echo
   ```

   Pour un accès externe depuis un navigateur, définissez `service_type = LoadBalancer` (ou appuyez-vous sur le
   chemin Gateway par défaut `enable_custom_domain = true`) via **Update** sur la
   page de détails du déploiement, et **conservez `enable_password = true`** chaque fois que vous le faites — un
   IDE public et non authentifié inclut un terminal public.

2. **Vérifiez le chemin de la sonde de santé par rapport au paramètre de mot de passe avant de supposer
   qu'une boucle de redémarrage a une autre cause.** Les sondes de démarrage et de vivacité de la variante GKE
   ciblent par défaut `/health`, mais avec `enable_password = true` (la valeur par défaut du module)
   `/health` renvoie **401** et la sonde ne réussit jamais — le pod redémarre en boucle même
   si l'application démarre correctement. Inspectez la disponibilité et, si vous observez ce schéma,
   remplacez le `path` de `startup_probe`/`liveness_probe` par `/healthz`, non authentifié,
   via **Update** :

   ```bash
   kubectl get pods -n "$NS" -o wide
   kubectl describe pod -n "$NS" <pod>       # look for probe-failure events (401/Unauthorized)
   ```

3. Pour une vérification rapide sans attendre l'entrée externe, établissez une redirection de port directement vers
   le pod :

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 8080:8080
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthz   # expect 200
   ```

4. Récupérez le mot de passe de l'éditeur généré dans Secret Manager (exposé par la
   sortie `codeserver_password_secret_id`), puis ouvrez l'éditeur dans un navigateur (via
   le tunnel de redirection de port, l'adresse IP externe du LoadBalancer ou le domaine personnalisé) et
   connectez-vous :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~codeserver AND name~password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

5. Vérifiez la persistance : créez un fichier ou installez une extension dans l'éditeur, puis
   vérifiez qu'il arrive dans le stockage de l'espace de travail — tout ce qui se trouve sous `/home/coder`
   (paramètres, raccourcis clavier, extensions, projets ouverts) persiste sur le bucket GCS FUSE
   ou sur le PVC en mode bloc, selon le mode actif :

   ```bash
   # GCS FUSE mode (default):
   gcloud storage buckets list --project="$PROJECT" --filter="name~codeserver"
   # Block PVC mode (stateful_pvc_enabled = true):
   kubectl get pvc -n "$NS"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — un Deployment par défaut, ou un StatefulSet lorsque
   `stateful_pvc_enabled = true` :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"          # or: kubectl describe statefulset -n "$NS"
   ```

2. **N'augmentez pas le nombre de réplicas.** Le module fixe délibérément
   `min_instance_count = max_instance_count = 1` : les sessions de l'éditeur sont conservées en mémoire
   et le volume d'espace de travail n'a qu'un seul rédacteur — un second réplica diviserait les
   sessions et risquerait des écritures concurrentes dans `/home/coder`. Les modifications de ressources
   (`cpu_limit`, `memory_limit` pour les serveurs de langage gourmands) passent par **Update** sur
   la page de détails du déploiement, et non par un `kubectl edit` manuel (une modification manuelle serait
   annulée lors de l'application suivante).

3. **Choisissez délibérément votre mode de stockage de l'espace de travail.** GCS FUSE (par défaut) est
   le plus simple et ne consomme aucun quota de PVC ; `stateful_pvc_enabled = true` monte un PVC
   en mode bloc par pod (`standard-rwo`, `20Gi` par défaut) pour des E/S à plus faible latence sur les
   espaces de travail volumineux, sélectionne automatiquement `StatefulSet` et définit `stateful_fs_group = 3000` afin que le
   volume soit accessible en écriture par le groupe du processus code-server (UID 1000 / GID 2000).
   Changer de mode est une modification d'infrastructure à sens unique — prévoyez une copie des données si vous devez
   migrer un espace de travail existant de l'un à l'autre.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace
   le pod. Il n'y a aucune migration — code-server n'a pas de schéma. `latest` est fixé à
   `4.99.1` au moment du build ; fixez une version précise en production.

5. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~codeserver"
   kubectl get jobs -n "$NS"          # none by default — no init/migration job is needed
   ```

6. **Il n'y a aucune session de base de données à ouvrir.** `database_type = "NONE"` — ni instance
   Cloud SQL, ni job db-init, ni mot de passe de base de données. Le seul état durable est le
   bucket ou le PVC de l'espace de travail.

7. **Sauvegardez l'espace de travail :**

   ```bash
   # GCS FUSE mode:
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~codeserver" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/codeserver-$(date +%F)"

   # Block PVC mode — copy out of the running pod:
   kubectl cp "$NS"/"$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')":/home/coder ./codeserver-backup-$(date +%F)
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   (Utilisez `statefulset/<name>` au lieu de `deploy/<name>` lorsque `stateful_pvc_enabled =
   true`.) Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (les serveurs de langage et les extensions sont les principaux consommateurs de
   mémoire) ainsi que le nombre de redémarrages. Le **test de disponibilité** du module est désactivé par défaut
   (`uptime_check_config.enabled = false`) et exige un point de terminaison joignable publiquement —
   avec le Service `ClusterIP` par défaut, Monitoring → Uptime checks reste légitimement
   vide tant que vous n'exposez pas l'éditeur à l'extérieur.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de code-server.

- **Pod non Ready / CrashLoopBackOff avec un échec de sonde :** vérifiez si
  `enable_password = true` alors que le chemin de la sonde est toujours `/health` par défaut —
  `/health` renvoie 401 lorsqu'un mot de passe est défini et le pod ne devient jamais Ready même si
  l'application a bien démarré. Remplacez le `path` de la sonde par `/healthz` (tâche 2, étape 2).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/scheduling/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Éditeur injoignable depuis votre machine :** c'est presque toujours le Service `ClusterIP`
  par défaut, pas une panne — vérifiez le type de Service et passez à `LoadBalancer` (ou
  à un domaine personnalisé) si un accès externe est nécessaire (tâche 2, étape 1).
- **PVC bloqué en Pending (mode PVC en mode bloc) :** vérifiez l'épuisement du quota `SSD_TOTAL_GB` —
  la StorageClass par défaut `standard-rwo` repose sur des SSD. Si le quota est serré,
  envisagez `stateful_pvc_storage_class = "standard"` (HDD) en remplacement.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>     # Events show the quota/provisioning error
  ```
- **Erreurs d'autorisation sur l'espace de travail avec un PVC en mode bloc :** vérifiez que `stateful_fs_group` est
  non nul (`3000` par défaut) — une valeur `0` laisse `fsGroup` non défini et le PVC peut appartenir à
  root, ce qui bloque les écritures de l'UID 1000 de code-server.
- **Connexion refusée :** relisez le secret `PASSWORD` (tâche 2, étape 4) — la valeur est
  injectée via SecretSync comme variable d'environnement `PASSWORD` du conteneur ; une nouvelle
  version du secret ne prend effet qu'au prochain redémarrage du pod.
- **État de l'espace de travail manquant / extensions disparues :** vérifiez que le montage du bucket GCS FUSE
  ou le PVC est effectivement lié, et que vous contrôlez bien le mode de stockage réellement
  actif (`stateful_pvc_enabled` à true ou false).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec ;
  l'image est une encapsulation légère au-dessus de `codercom/code-server`, répliquée dans Artifact
  Registry.
- **Erreurs de récupération d'image sur le nœud :** vérifiez que l'image existe dans Artifact Registry
  et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment la règle essentielle de conserver `enable_password = true` pour tout
déploiement exposé à l'extérieur, et de ne jamais supprimer le bucket/PVC de l'espace de travail).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, le secret Secret Manager `PASSWORD`, le stockage de l'espace de travail (le bucket
GCS, ou le PVC en mode bloc et son Persistent Disk sous-jacent) et les images Artifact Registry.
Copiez d'abord l'espace de travail si vous souhaitez conserver votre travail. Les ressources détenues
par **Services_GCP** (le VPC, le cluster GKE, Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne le pod GKE, le stockage de l'espace de travail (GCS FUSE ou PVC en mode bloc) et le secret `PASSWORD` (ni base de données, ni Redis) |
| 2 — Accéder et vérifier | Manuel | Comprendre le Service `ClusterIP` par défaut et l'interaction entre chemin de sonde et mot de passe ; récupérer le mot de passe et se connecter ; vérifier la persistance de l'espace de travail |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, conserver une seule instance, choisir entre GCS FUSE et PVC en mode bloc, mettre à jour la version, sauvegarder l'espace de travail |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; comprendre quand le test de disponibilité existe |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de chemin de sonde, d'entrée, de quota de PVC, d'autorisation, de mot de passe, d'espace de travail et de build/récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le stockage de l'espace de travail |
