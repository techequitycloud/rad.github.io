---
title: "Jellyfin sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Jellyfin sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Jellyfin_GKE.md @ 3055034 sha256:2c0a4d45c860 -->

# Jellyfin sur GKE Autopilot — Guide de lab {#jellyfin-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Jellyfin_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Jellyfin est un serveur multimédia gratuit, open source et auto-hébergé qui permet de diffuser vos propres
films, séries, musique, photos et chaînes de télévision en direct sur n'importe quel appareil. Il est écrit en .NET
et a commencé comme un fork d'Emby. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Jellyfin on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Jellyfin. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Jellyfin_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Terminer l'assistant de premier démarrage de Jellyfin et ajouter une médiathèque sur le PVC.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
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
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Jellyfin (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Jellyfin_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** avec une **PersistentVolumeClaim** en mode bloc montée sur `/config`
   (`stateful_pvc_enabled = true` fait automatiquement de la charge de travail un StatefulSet et
   définit `enable_gcs_storage_volume` à false). Le PVC contient la configuration de Jellyfin,
   ses bases SQLite internes, les métadonnées, les plugins et le cache de transcodage.
   La plateforme construit l'image de conteneur (`jellyfin/jellyfin`, épinglée en 10.10.3
   lorsque `application_version = "latest"`). Jellyfin n'a besoin d'**aucune base de données externe** —
   il utilise un stockage SQLite intégré sous `/config` ; il n'y a donc ni instance Cloud SQL
   ni job d'initialisation de base de données. Les premiers déploiements prennent environ **8 à 15
   minutes** (le build de l'image représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep jellyfin | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et que son PVC est lié, puis trouvez son adresse externe :

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est sain. Jellyfin expose sur le port 8096 un point de terminaison de santé
   non authentifié qui renvoie `Healthy` (200) une fois le serveur entièrement
   démarré :

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"   # expect: Healthy
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Jellyfin sert son interface web sur `/web`
   (et sur `/`). Lors de la première visite, vous arrivez directement dans l'**assistant de configuration** —
   il n'existe **aucun identifiant par défaut** ; le compte administrateur est créé pendant
   l'assistant (tâche 3).

---

## Tâche 3 — Exemple guidé : terminer l'assistant et ajouter une médiathèque [Manuel] {#task-3--worked-example-complete-the-wizard-and-add-a-media-library-manual}

C'est le flux de travail central de Jellyfin. Vous allez terminer la configuration initiale, créer
l'administrateur initial, ajouter une médiathèque reposant sur le PVC persistant `/config`, puis
vérifier que vous pouvez la parcourir.

1. **Terminez l'assistant de configuration.** Avec `http://${EXTERNAL_IP}` ouvert dans le navigateur :
   - **Preferred display language** — choisissez votre langue et cliquez sur **Next**.
   - **Create your admin account** — saisissez un nom d'utilisateur et un mot de passe robuste. Ce compte
     devient le propriétaire de Jellyfin ; c'est le seul administrateur tant que vous n'en ajoutez pas d'autres.
     Aucun identifiant pré-provisionné n'existe dans Secret Manager.
   - **Setup Media Libraries** — vous pouvez passer cette étape ici et ajouter une médiathèque à l'étape suivante
     depuis le Dashboard, ou ajouter votre première médiathèque directement.
   - **Preferred metadata language / country** — définissez la langue que Jellyfin utilise lorsqu'il
     récupère les illustrations, les descriptions et les autres métadonnées, puis **Next**.
   - **Remote access** — laissez *Allow remote connections to this server* activé (le
     Service LoadBalancer l'expose déjà) ; vous pouvez laisser le mappage automatique des ports
     désactivé. Cliquez sur **Next**, puis sur **Finish**. Jellyfin redémarre sur l'écran de connexion —
     connectez-vous avec le compte administrateur que vous venez de créer.

2. **Ajoutez une médiathèque.** Depuis l'interface web, allez dans le menu utilisateur →
   **Dashboard** → **Libraries** → **Add Media Library** :
   - **Content type** — choisissez ce que contient le dossier, par exemple **Movies**, **Shows**,
     **Music** ou **Photos**.
   - **Display name** — donnez un nom à la médiathèque (par exemple `Movies`).
   - **Folders** — cliquez sur **+** et indiquez à Jellyfin un chemin *situé sous le volume
     persistant*, par exemple `/config/media/movies`. Tout ce qui se trouve sous `/config` réside sur le
     PVC en mode bloc et survit aux redémarrages de pods, aux replanifications et aux redéploiements ; un chemin hors de
     `/config` réside sur le disque éphémère du pod et est perdu lorsque le pod est recyclé.
     Créez d'abord le dossier et ajoutez-y un fichier d'exemple s'il n'existe pas (voir la remarque
     ci-dessous sur la façon de placer des médias sur le volume).
   - Acceptez les valeurs par défaut de téléchargement des métadonnées et cliquez sur **Ok**, puis de nouveau sur **Ok** pour
     enregistrer la médiathèque.

3. **Analysez et récupérez les métadonnées.** Jellyfin analyse automatiquement la nouvelle médiathèque ; vous pouvez
   forcer une analyse depuis **Dashboard → Libraries → Scan All Libraries** (ou le menu à trois points
   de la médiathèque → **Scan Library**). Il associe chaque fichier aux fournisseurs
   en ligne et télécharge titres, illustrations et descriptions dans la langue de métadonnées
   que vous avez choisie.

4. **Parcourez et vérifiez la lecture.** Revenez à l'écran d'accueil de Jellyfin — votre nouvelle
   médiathèque apparaît avec ses affiches. Ouvrez-la, sélectionnez un élément et appuyez sur **Play**.
   Pour une démonstration fluide, privilégiez des médias que le client peut lire **directement** (direct-play : un codec/conteneur
   que le navigateur prend en charge nativement) : le transcodage à la volée est gourmand en CPU et il n'y a
   pas de GPU sur Autopilot, si bien que le transcodage d'un fichier volumineux peut saccader si vous n'avez
   pas augmenté le CPU.

> **Placer des médias sur le volume `/config` :** le PVC est un disque en mode bloc monté uniquement
> dans le pod ; copiez donc les fichiers en passant par le pod lui-même. Transférez un fichier local
> directement dans le chemin de médiathèque que vous avez indiqué ci-dessus :
> ```bash
> POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
> kubectl exec -n "$NS" "$POD" -- mkdir -p /config/media/movies
> kubectl cp ./my-movie.mp4 "$NS/$POD:/config/media/movies/my-movie.mp4"
> ```
> Le stockage en mode bloc convient bien à une vraie médiathèque et au cache de transcodage. Pour
> une collection de médias **volumineuse**, envisagez de la placer sur **NFS** (`enable_nfs`)
> plutôt que d'agrandir le PVC en mode bloc — le NFS partagé est dimensionné pour les médias en masse, tandis que le
> PVC garde en local le stockage SQLite et le cache, sensibles à la latence.

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod et le PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mise à l'échelle — conservez un réplica unique.** Jellyfin est une application à serveur unique
   avec état : ses bases SQLite et son cache de transcodage résident sur un seul PVC `/config`
   et ne sont pas conçus pour des écritures concurrentes. Le module utilise par défaut un réplica
   unique (`min_instance_count = 1`, `max_instance_count = 1`) précisément pour cette
   raison — **conservez `max_instance_count = 1`**. Si la lecture a besoin de plus de marge, augmentez la taille
   verticalement (relevez `cpu_limit` au-delà de la valeur par défaut `1000m` et `memory_limit` au-delà de `1Gi`
   pour le transcodage en direct), et non horizontalement. Appliquez les modifications en éditant les paramètres et en cliquant sur
   **Update** — le module possède la spécification de la charge de travail, donc un `kubectl scale` manuel serait
   annulé lors de la prochaine application.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et le pod du StatefulSet est
   remplacé. Comme l'état réside sur le PVC `/config` (conservé lors du
   remplacement du pod), le nouveau pod retrouve vos médiathèques et vos paramètres.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~jellyfin"
   kubectl get pvc -n "$NS"          # the /config block volume that holds all state
   ```

   L'état qui compte est le PVC `/config` — les bases SQLite ainsi que les métadonnées,
   les plugins et les paramètres utilisateur. Si vous avez activé la clé d'API facultative
   (`enable_api_key = true`), sa valeur de 32 caractères est stockée dans Secret Manager sous le nom
   `secret-<prefix>-<app>-api-key` ; notez que les clés d'API applicatives propres à Jellyfin se
   créent séparément dans **Dashboard → API Keys**.

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Surveillez le CPU pendant
   la lecture — une saturation prolongée signifie généralement qu'un client déclenche un transcodage
   et que vous devriez relever `cpu_limit` ou orienter les clients vers la lecture directe. Le module
   peut provisionner un **test de disponibilité** (uptime check, lorsqu'il est activé) ; consultez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Jellyfin.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de vivacité
  cible `/health`, qui ne renvoie `Healthy` qu'une fois que le serveur a terminé
  l'initialisation de son stockage SQLite sur le PVC `/config` monté.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC en état Pending / pod bloqué en planification :** vérifiez que la PersistentVolumeClaim est liée et
  qu'Autopilot a pu provisionner le disque :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc>
  ```
- **Médiathèques ou paramètres disparus après un redéploiement :** vérifiez que le chemin de médias que vous
  avez indiqué se trouve sous `/config` (le montage du PVC). Un chemin hors de `/config` est
  éphémère et est perdu à chaque recyclage de pod.
- **La lecture saccade ou expire :** il s'agit presque toujours d'un transcodage sous une limite de 1 vCPU.
  Privilégiez les médias en lecture directe, ou relevez `cpu_limit`/`memory_limit`.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quota, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de
  service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à
chaque paramètre (notamment conserver `max_instance_count = 1` et dimensionner le CPU pour le transcodage).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la **PersistentVolumeClaim** `/config` (**y compris vos bases
SQLite, les métadonnées et tous les médias que vous y avez copiés**), les secrets Secret Manager et
les images d'Artifact Registry. Si vous souhaitez conserver votre médiathèque, copiez d'abord les médias hors du PVC
(tâche 3). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre,
les comptes de service partagés) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet avec un PVC en mode bloc `/config` et construit l'image (pas de base de données externe) |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/health` renvoie `Healthy` ; l'assistant de configuration se charge à l'IP du LoadBalancer |
| 3 — Exemple guidé | Manuel | Terminer l'assistant, créer l'administrateur, ajouter une médiathèque sur le PVC `/config`, l'analyser et la parcourir |
| 4 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, conserver un réplica unique, dimensionner le CPU, mettre à jour la version, gérer les secrets/le stockage |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de persistance, de transcodage, de planification et de récupération d'image |
| 7 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le PVC `/config` |
