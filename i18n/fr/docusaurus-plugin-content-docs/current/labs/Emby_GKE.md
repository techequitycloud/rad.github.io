---
title: "Emby sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Emby sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Emby_GKE.md @ 3055034 sha256:4d108a2e77f1 -->

# Emby sur GKE Autopilot — Guide de lab {#emby-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Emby_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Emby est un serveur multimédia auto-hébergé qui diffuse vos propres films, séries,
musiques et photos sur n'importe quel appareil. La lecture de base et l'assistant de configuration sont gratuits —
aucune clé de licence ni aucun compte emby.media n'est requis — tandis qu'Emby Premiere (une offre payante
distincte et facultative) conditionne le transcodage matériel, les applications mobiles/TV complètes,
le DVR/la TV en direct et la synchronisation hors ligne. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Emby sur GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Emby. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Emby_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Terminer l'assistant de configuration initiale d'Emby et ajouter une médiathèque sur le PVC.
- Effectuer les opérations du jour 2 (day-2) — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- La **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Emby (GKE)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Emby_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** avec un **PersistentVolumeClaim** en mode bloc monté sur `/config`
   (`stateful_pvc_enabled = true` transforme automatiquement la charge de travail en StatefulSet et
   définit `enable_gcs_storage_volume` sur false). Le PVC contient la
   configuration d'Emby, ses bases SQLite internes, ses métadonnées, ses plugins et son cache de transcodage.
   La plateforme build l'image du conteneur (`emby/embyserver`, figée sur `4.10.0.15`
   lorsque `application_version = "latest"`). Emby n'a besoin d'**aucune base de données externe** —
   il utilise un stockage SQLite intégré sous `/config` : il n'y a donc ni instance Cloud SQL
   ni job d'initialisation de base de données. Le Service est par défaut de type
   `LoadBalancer` (Emby est une application destinée aux navigateurs et aux clients). Les premiers déploiements prennent
   environ **8–15 minutes** (le build de l'image en représente l'essentiel).

3. Connectez-vous au cluster et découvrez le namespace à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep emby | head -1 | cut -d/ -f2)
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

2. Vérifiez que le service est démarré. Contrairement à Jellyfin, Emby ne dispose d'**aucun point de terminaison
   de santé HTTP non authentifié confirmé et documenté** sur le port 8096 (`/health`
   renvoie 404 en production) — c'est pourquoi les sondes de démarrage et de vivacité du module lui-même sont des vérifications TCP sur
   ce port. Une preuve manuelle rapide que le serveur écoute et répond
   réellement :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 302 (redirect to /web)
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Emby sert son interface web sur `/web`
   (et sur `/`). Lors de la première visite, vous êtes directement dirigé vers l'**assistant de configuration** —
   il n'existe **aucun identifiant par défaut** ; le compte administrateur est créé pendant
   l'assistant (tâche 3).

---

## Tâche 3 — Exemple guidé : terminer l'assistant et ajouter une médiathèque [Manuel] {#task-3--worked-example-complete-the-wizard-and-add-a-media-library-manual}

Il s'agit du flux de travail central d'Emby. Vous allez terminer la configuration initiale, créer
l'administrateur initial, ajouter une médiathèque reposant sur le PVC persistant `/config`, puis
vérifier que vous pouvez la parcourir.

1. **Terminez l'assistant de configuration.** Avec `http://${EXTERNAL_IP}` ouvert dans le navigateur :
   - **Preferred display language** (langue d'affichage préférée) — choisissez votre langue et cliquez sur **Next**.
   - **Create your admin account** (créer votre compte administrateur) — saisissez un nom d'utilisateur et un mot de passe robuste. Ce compte
     devient le propriétaire d'Emby ; c'est le seul administrateur tant que vous n'en ajoutez pas d'autres.
     Aucun identifiant n'est pré-enregistré dans Secret Manager.
   - **Setup Media Libraries** (configurer les médiathèques) — vous pouvez ignorer cette étape ici et ajouter une médiathèque à l'étape
     suivante depuis le Dashboard, ou ajouter votre première médiathèque directement.
   - **Preferred metadata language / country** (langue / pays préférés pour les métadonnées) — définissez la langue utilisée par Emby lorsqu'il
     récupère les illustrations, les descriptions et les autres métadonnées, puis **Next**.
   - **Remote access** (accès distant) — laissez *Allow remote connections to this server* activé (le
     Service LoadBalancer l'expose déjà) ; vous pouvez laisser le mappage automatique des ports
     désactivé. Cliquez sur **Next**, puis sur **Finish**. Emby redémarre sur l'écran de connexion —
     connectez-vous avec le compte administrateur que vous venez de créer. (C'est à cette étape qu'Emby
     proposerait une connexion Emby Connect facultative — elle est purement informative et
     peut être entièrement ignorée.)

2. **Ajoutez une médiathèque.** Dans l'interface web, allez dans le menu utilisateur →
   **Dashboard** → **Libraries** → **Add Media Library** :
   - **Content type** (type de contenu) — choisissez ce que contient le dossier, par exemple **Movies**, **Shows**,
     **Music** ou **Photos**.
   - **Display name** (nom d'affichage) — donnez un nom à la médiathèque (par exemple `Movies`).
   - **Folders** (dossiers) — cliquez sur **+** et indiquez à Emby un chemin *situé sous le volume
     persistant*, par exemple `/config/media/movies`. Tout ce qui se trouve sous `/config` réside sur le PVC
     en mode bloc et survit aux redémarrages de pod, aux replanifications et aux redéploiements ; un chemin en dehors de
     `/config` réside sur le disque éphémère du pod et est perdu lorsque le pod est recyclé.
     Créez d'abord le dossier et déposez-y un fichier d'exemple s'il n'existe pas (voir la note
     ci-dessous sur le placement des médias dans le volume).
   - Acceptez les valeurs par défaut de téléchargement des métadonnées et cliquez sur **Ok**, puis de nouveau sur **Ok** pour
     enregistrer la médiathèque.

3. **Analysez et récupérez les métadonnées.** Emby analyse automatiquement la nouvelle médiathèque ; vous pouvez
   forcer une analyse depuis **Dashboard → Libraries → Scan All Libraries** (ou le menu à trois points
   de la médiathèque → **Scan Library**). Il compare chaque fichier aux fournisseurs en ligne
   et télécharge les titres, les illustrations et les descriptions dans la langue de métadonnées
   que vous avez choisie.

4. **Parcourez et vérifiez la lecture.** Revenez à l'écran d'accueil d'Emby — votre nouvelle
   médiathèque apparaît avec ses affiches. Ouvrez-la, sélectionnez un élément et appuyez sur **Play**.
   Pour une démonstration fluide, privilégiez les médias que le client peut lire **directement** (direct-play : un codec/conteneur
   pris en charge nativement par le navigateur) : le transcodage à la volée est gourmand en CPU et il n'y a
   pas de GPU sur Autopilot, de sorte que le transcodage d'un fichier volumineux peut saccader si vous n'avez pas
   augmenté le CPU. Le transcodage accéléré par le matériel nécessite en outre Emby
   Premiere.

> **Placer des médias sur le volume `/config` :** le PVC est un disque en mode bloc monté uniquement
> à l'intérieur du pod ; copiez donc les fichiers en passant par le pod lui-même. Transférez un fichier local
> directement dans le chemin de médiathèque que vous avez indiqué ci-dessus :
> ```bash
> POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
> kubectl exec -n "$NS" "$POD" -- mkdir -p /config/media/movies
> kubectl cp ./my-movie.mp4 "$NS/$POD:/config/media/movies/my-movie.mp4"
> ```
> Le stockage en mode bloc convient bien à une véritable médiathèque et au cache de transcodage. Pour
> une **grande** collection de médias, envisagez de la placer sur **NFS** (`enable_nfs`)
> plutôt que d'agrandir le PVC en mode bloc — le NFS partagé est dimensionné pour les médias en masse, tandis que le
> PVC conserve en local le stockage SQLite et le cache, sensibles à la latence.

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pod et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mise à l'échelle — conservez un seul réplica.** Emby est une application à serveur unique
   avec état : ses bases SQLite et son cache de transcodage résident sur un seul PVC `/config`
   et ne sont pas conçus pour des écritures concurrentes. Le module utilise par défaut un seul
   réplica (`min_instance_count = 1`, `max_instance_count = 1`) précisément pour cette
   raison — **conservez `max_instance_count = 1`**. Si la lecture a besoin de plus de marge, augmentez la
   taille de l'instance (relevez `cpu_limit` au-delà de la valeur par défaut `1000m` et `memory_limit` au-delà de `1Gi`
   pour le transcodage en direct) plutôt que le nombre de réplicas. Appliquez les modifications en éditant les paramètres et en cliquant sur
   **Update** — le module est propriétaire de la spécification de la charge de travail : un `kubectl scale` manuel serait
   annulé lors de l'application suivante.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est buildée et le pod du StatefulSet est
   remplacé. Comme l'état réside sur le PVC `/config` (qui est conservé lors du
   remplacement du pod), le nouveau pod reprend vos médiathèques et vos paramètres.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~emby"
   kubectl get pvc -n "$NS"          # the /config block volume that holds all state
   ```

   L'état qui compte est le PVC `/config` — les bases SQLite ainsi que les métadonnées,
   les plugins et les paramètres utilisateur. Si vous avez activé la clé d'API facultative
   (`enable_api_key = true`), sa valeur de 32 caractères est stockée dans Secret Manager sous le nom
   `secret-<prefix>-<app>-api-key` et injectée en tant que `EMBY_API_KEY` ; notez que les
   clés d'API propres à l'application Emby se créent séparément dans **Dashboard → API Keys**.

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Surveillez le CPU pendant la
   lecture — une saturation prolongée signifie généralement qu'un client déclenche un transcodage
   et que vous devriez relever `cpu_limit` ou orienter les clients vers la lecture directe. Le module
   peut provisionner un **test de disponibilité** (uptime check) (lorsqu'il est activé) ; examinez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Emby à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  est une vérification **TCP** sur le port 8096 — elle réussit dès que l'écouteur d'Emby est lié ; un
  pod qui échoue à cette sonde signifie donc presque toujours que le conteneur n'a jamais atteint ce stade
  (un problème de build ou de point d'entrée, ou un échec de montage du PVC), et non un problème de santé au niveau de l'application.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC en Pending / pod bloqué à la planification :** vérifiez que le PersistentVolumeClaim est lié et
  qu'Autopilot a pu provisionner le disque :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc>
  ```
- **Les médiathèques ou les paramètres ont disparu après un redéploiement :** vérifiez que le chemin de médias que vous
  avez indiqué se trouve sous `/config` (le montage du PVC). Un chemin en dehors de `/config` est
  éphémère et perdu à chaque recyclage de pod.
- **La lecture saccade ou expire :** il s'agit presque toujours d'un transcodage sous une limite de 1 vCPU.
  Privilégiez les médias en lecture directe, ou relevez `cpu_limit`/`memory_limit`. Le transcodage
  matériel nécessite Emby Premiere et n'est de toute façon pas disponible sur Autopilot.
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment conserver `max_instance_count = 1` et dimensionner le CPU pour le transcodage).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, le **PersistentVolumeClaim** `/config` (**y compris vos bases
SQLite, vos métadonnées et tous les médias que vous y avez copiés**), les secrets Secret Manager et
les images Artifact Registry. Si vous souhaitez conserver votre médiathèque, copiez d'abord les médias hors du PVC
(tâche 3). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre,
les comptes de service partagés) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet avec un PVC en mode bloc `/config` et build l'image (sans base de données externe) |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/` renvoie un 302 vers l'assistant de configuration à l'IP du LoadBalancer |
| 3 — Exemple guidé | Manuel | Terminer l'assistant, créer l'administrateur, ajouter une médiathèque sur le PVC `/config`, l'analyser et la parcourir |
| 4 — Exploiter | Manuel | Inspecter le StatefulSet et le PVC, conserver un seul réplica, dimensionner le CPU, mettre à jour la version, gérer les secrets et le stockage |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de persistance, de transcodage, de planification et de récupération d'image |
| 7 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le PVC `/config` |
