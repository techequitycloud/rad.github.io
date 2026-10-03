---
title: "code-server sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer code-server sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/CodeServer_GKE.md @ 15fd4c7 sha256:3636fae2e651 -->

# code-server sur GKE Autopilot — Guide de Lab {#code-server-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45-90 minutes

code-server est la version open source de Visual Studio Code de Coder qui s'exécute sur un serveur distant et est entièrement accessible via le navigateur — un IDE complet avec le marché des extensions, un terminal intégré et un espace de travail persistant. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **code-server sur GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exécuter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit code-server. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_GKE) — ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, découvrir l'espace de noms et confirmer que le pod est en cours d'exécution.
- Accéder à l'éditeur, récupérer le mot de passe généré depuis Secret Manager et vérifier le service.
- Effectuer les opérations de jour 2 — inspecter la charge de travail, choisir entre le stockage d'espace de travail GCS FUSE et le PVC de bloc, et mettre à jour la version.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris l'interaction chemin de sonde/mot de passe.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry et les comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` complétés.
- IAM **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'il affiche en tant que Propriétaire du projet, puis **Vérifier**) et de donner le rôle **Propriétaire** au compte de service de déploiement RAD. Un projet créé par RAD pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD pour vous, guère plus que le nom du locataire et la région). Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées par la suite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **code-server (GKE)** depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur l'**Assistant Conversationnel** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et examinez les
   entrées. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec des logs en temps réel.

2. La plateforme construit une image wrapper légère sur `codercom/code-server` (mise en miroir
   dans Artifact Registry via Cloud Build) et planifie un seul pod sur le cluster GKE
   Autopilot (port 8080, 1 vCPU / 1 GiB par défaut). Par défaut, l'espace de travail
   est un **StatefulSet avec un PVC de bloc** monté à `/home/coder`
   (`stateful_pvc_enabled = true`) ; conservez-le, car l'installation d'une extension échoue sur
   l'alternative GCS FUSE. Un éditeur aléatoire
   `PASSWORD` est généré et stocké dans Secret Manager. Il n'y a **pas d'instance Cloud SQL
   et pas de Redis** — code-server n'a pas de base de données. Les premiers déploiements prennent généralement
   **10 à 20 minutes** (la construction de l'image et la planification du pod dominent ; il n'y a pas
   de base de données à attendre).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep codeserver | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est prêt et vérifiez le type de Service — **le module utilise par défaut
   `ClusterIP`**, donc l'éditeur n'est accessible que depuis l'intérieur du cluster/VPC
   par défaut :

   ```bash
   kubectl get pods,svc -n "$NS"
   kubectl get svc -n "$NS" -o jsonpath='{.items[0].spec.type}'; echo
   ```

   Pour un accès externe via le navigateur, définissez `service_type = LoadBalancer` (ou utilisez le
   chemin par défaut de la passerelle `enable_custom_domain = true`) via **Update** sur la
   page des détails du déploiement, et **conservez `enable_password = true`** chaque fois que vous le faites — un
   IDE public et non authentifié inclut un terminal public.

2. **Vérifiez le chemin de la sonde de santé par rapport au paramètre de mot de passe avant de supposer qu'une
   boucle de redémarrage est autre chose.** Les sondes de démarrage/vivacité de la variante GKE
   utilisent par défaut `/health`, mais avec `enable_password = true` (la valeur par défaut du module)
   `/health` renvoie **401** et la sonde ne passe jamais — le pod redémarre en boucle même
   si l'application démarre correctement. Inspectez la disponibilité et, si vous voyez ce schéma,
   remplacez `startup_probe`/`liveness_probe` `path` par le chemin non authentifié `/healthz`
   via **Update** :

   ```bash
   kubectl get pods -n "$NS" -o wide
   kubectl describe pod -n "$NS" <pod>       # look for probe-failure events (401/Unauthorized)
   ```

3. Pour une vérification rapide sans attendre l'entrée externe, transférez le port directement vers
   le pod :

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 8080:8080
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthz   # expect 200
   ```

4. Récupérez le mot de passe de l'éditeur généré depuis Secret Manager (affiché comme la
   sortie `codeserver_password_secret_id`), puis ouvrez l'éditeur dans un navigateur (via
   le tunnel de transfert de port, l'adresse IP externe du LoadBalancer ou le domaine personnalisé) et
   connectez-vous :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~codeserver AND name~password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

5. Vérifiez la persistance : créez un fichier ou installez une extension dans l'éditeur, puis
   confirmez qu'il atterrit dans le stockage de l'espace de travail — tout ce qui se trouve sous `/home/coder`
   (paramètres, raccourcis clavier, extensions, projets ouverts) persiste sur le bucket GCS FUSE
   ou le PVC de bloc, quel que soit le mode actif :

   ```bash
   # GCS FUSE mode (default):
   gcloud storage buckets list --project="$PROJECT" --filter="name~codeserver"
   # Block PVC mode (stateful_pvc_enabled = true):
   kubectl get pvc -n "$NS"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail** — un déploiement par défaut, ou un StatefulSet lorsque
   `stateful_pvc_enabled = true` :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"          # or: kubectl describe statefulset -n "$NS"
   ```

2. **Ne pas mettre à l'échelle.** Le module épingle délibérément
   `min_instance_count = max_instance_count = 1` : les sessions d'éditeur sont conservées en mémoire
   et le volume de l'espace de travail a un seul rédacteur — une deuxième réplique diviserait
   les sessions et risquerait des écritures concurrentes sur `/home/coder`. Les changements de ressources
   (`cpu_limit`, `memory_limit` pour les serveurs de langage lourds) passent par **Update** sur
   la page des détails du déploiement, et non par une modification manuelle de `kubectl edit` (une modification manuelle serait
   annulée lors du prochain apply).

3. **Conserver l'espace de travail PVC de bloc par défaut.** `stateful_pvc_enabled = true` (la
   valeur par défaut) monte un PVC de bloc par pod (`standard-rwo`, `20Gi` par défaut) — requis,
   car code-server installe des extensions en renommant un répertoire, ce que GCS FUSE
   ne peut pas faire — sélectionne automatiquement `StatefulSet`, et définit `stateful_fs_group = 3000` afin que le
   volume soit accessible en écriture par le processus code-server (UID 1000 / GID 2000).
   Le changement de mode est un changement d'infrastructure unidirectionnel — prévoyez une copie des données si vous devez
   migrer un espace de travail existant entre les deux.

4. **Mettre à jour la version de l'application** en modifiant l'entrée de version via **Update**
   sur la page des détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace
   le pod. Il n'y a pas de migrations — code-server n'a pas de schéma. `latest` épingle à
   `4.99.1` au moment de la construction ; épinglez une version spécifique en production.

5. **Gérer les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~codeserver"
   kubectl get jobs -n "$NS"          # none by default — no init/migration job is needed
   ```

6. **Il n'y a pas de session de base de données à ouvrir.** `database_type = "NONE"` — pas d'instance Cloud SQL,
   pas de job d'initialisation de base de données, pas de mot de passe de base de données. Le seul état durable est le
   bucket ou le PVC de l'espace de travail.

7. **Sauvegarder l'espace de travail :**

   ```bash
   # GCS FUSE mode:
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~codeserver" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/codeserver-$(date +%F)"

   # Block PVC mode — copy out of the running pod:
   kubectl cp "$NS"/"$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')":/home/coder ./codeserver-backup-$(date +%F)
   ```

---

## Tâche 4 — Observer : Journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis `kubectl` ou l'Explorateur de logs :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   (Utilisez `statefulset/<name>` au lieu de `deploy/<name>` lorsque `stateful_pvc_enabled =
   true`.) Filtre de l'Explorateur de logs :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire du pod
   (les serveurs de langage et les extensions sont les principaux consommateurs de mémoire) et le nombre de redémarrages. Le
   **test de disponibilité** du module est désactivé par défaut
   (`uptime_check_config.enabled = false`) et nécessite un point de terminaison publiquement accessible —
   avec le service `ClusterIP` par défaut, Monitoring → Uptime checks reste légitimement vide
   jusqu'à ce que vous exposiez l'éditeur en externe.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme et ils ne changent pas avec les versions de code-server.

- **Pod non prêt / CrashLoopBackOff avec une défaillance de sonde :** vérifiez si
  `enable_password = true` alors que le chemin de la sonde est toujours le chemin par défaut `/health` —
  `/health` renvoie 401 sous un mot de passe et le pod ne devient jamais prêt même si
  l'application a démarré correctement. Remplacez la sonde `path` par `/healthz` (Tâche 2, étape 2).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/scheduling/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Éditeur inaccessible depuis votre machine :** presque toujours le service `ClusterIP`
  par défaut, pas une panne — confirmez le type de service et passez à `LoadBalancer` (ou
  un domaine personnalisé) si un accès externe est requis (Tâche 2, étape 1).
- **PVC bloqué en attente (mode PVC de bloc) :** vérifiez l'épuisement du quota `SSD_TOTAL_GB` —
  la StorageClass `standard-rwo` par défaut est basée sur SSD. Si le quota est serré,
  envisagez `stateful_pvc_storage_class = "standard"` (HDD) comme remplacement.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>     # Events show the quota/provisioning error
  ```
- **Erreurs de permission de l'espace de travail sous un PVC de bloc :** confirmez que `stateful_fs_group` est
  non nul (par défaut `3000`) — une valeur `0` laisse `fsGroup` non défini et le PVC peut être
  propriété de root, bloquant les écritures de l'UID 1000 de code-server.
- **Connexion rejetée :** relisez le secret `PASSWORD` (Tâche 2, étape 4) — la valeur est
  injectée via SecretSync en tant que variable d'environnement `PASSWORD` du conteneur ; une nouvelle version du secret
  ne prend effet qu'au prochain redémarrage du pod.
- **État de l'espace de travail manquant / extensions disparues :** confirmez que le montage du bucket GCS FUSE
  ou le PVC est réellement lié, et que vous vérifiez le mode de stockage réellement actif
  (`stateful_pvc_enabled` vrai ou faux).
- **Échec de la construction de l'image :** examinez l'historique de Cloud Build pour le log de la construction échouée ; l'image
  est un wrapper léger sur `codercom/code-server` mis en miroir dans Artifact
  Registry.
- **Erreurs de tirage d'image sur le nœud :** confirmez que l'image existe dans Artifact Registry
  et que le compte de service du nœud peut la tirer.

Consultez la section *Pièges de configuration* du Guide de configuration pour les problèmes spécifiques aux paramètres
(y compris la règle critique de conserver `enable_password = true` pour tout
déploiement exposé en externe, et de ne jamais supprimer le bucket/PVC de l'espace de travail).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez **Purge** à la place (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, le secret `PASSWORD` de Secret Manager, le stockage de l'espace de travail (le bucket GCS, ou le PVC de bloc et son disque persistant sous-jacent), et les images Artifact Registry. Copiez l'espace de travail au préalable si vous souhaitez conserver votre travail. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne le pod GKE, le stockage de l'espace de travail (GCS FUSE ou PVC de bloc), et le secret `PASSWORD` (pas de base de données, pas de Redis) |
| 2 — Accéder et vérifier | Manuel | Comprendre le service `ClusterIP` par défaut et l'interaction chemin de sonde/mot de passe ; récupérer le mot de passe et se connecter ; vérifier la persistance de l'espace de travail |
| 3 — Opérer | Manuel | Inspecter la charge de travail, maintenir la mise à l'échelle à instance unique, choisir GCS FUSE ou PVC de bloc, mettre à jour la version, sauvegarder l'espace de travail |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; comprendre quand le test de disponibilité existe |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de chemin de sonde, d'entrée, de quota PVC, de permission, de mot de passe, d'espace de travail et de construction/tirage |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module, y compris le stockage de l'espace de travail |
