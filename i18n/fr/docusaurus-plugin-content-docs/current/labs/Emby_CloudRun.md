---
title: "Emby sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Emby sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Emby_CloudRun.md @ 3055034 sha256:bd55b6feb35c -->

# Emby sur Cloud Run — Guide de lab {#emby-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Emby_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Emby est un serveur multimédia auto-hébergé qui diffuse vos propres films, séries,
musiques et photos sur n'importe quel appareil. La lecture de base et l'assistant de configuration sont gratuits —
aucune clé de licence ni aucun compte emby.media n'est requis — tandis qu'Emby Premiere (une offre payante
distincte et facultative) conditionne le transcodage matériel, les applications mobiles/TV complètes,
le DVR/la TV en direct et la synchronisation hors ligne. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Emby sur Cloud Run** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Emby. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Emby_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Terminer l'assistant de configuration initiale d'Emby et ajouter une médiathèque.
- Effectuer les opérations du jour 2 (day-2) — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- La **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Emby (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Emby_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket Cloud Storage monté sur
   `/config` via GCS FUSE (`enable_gcs_storage_volume = true`) pour conserver la
   configuration d'Emby, ses bases SQLite internes, ses métadonnées, ses plugins et son cache de transcodage,
   et build l'image du conteneur (`emby/embyserver`, figée sur `4.10.0.15` lorsque
   `application_version = "latest"`). Emby n'a besoin d'**aucune base de données externe** — il
   utilise un stockage SQLite intégré sous `/config` : il n'y a donc ni instance Cloud SQL
   ni job d'initialisation de base de données. Les premiers déploiements prennent environ **8–15 minutes**
   (le build de l'image en représente l'essentiel).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~emby" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est démarré. Contrairement à Jellyfin, Emby ne dispose d'**aucun point de terminaison
   de santé HTTP non authentifié confirmé et documenté** (`/health` renvoie 404 en production) — c'est pourquoi
   les sondes de démarrage et de vivacité du module lui-même sont des vérifications TCP sur le port 8096.
   Une preuve manuelle rapide que le serveur écoute et répond réellement :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 302 (redirect to /web)
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Emby sert son interface web sur `/web` (et sur
   `/`) sur le port 8096 du conteneur. Lors de la première visite, vous êtes directement dirigé vers
   l'**assistant de configuration** — il n'existe **aucun identifiant par défaut** ; le compte
   administrateur est créé pendant l'assistant (tâche 3).

---

## Tâche 3 — Exemple guidé : terminer l'assistant et ajouter une médiathèque [Manuel] {#task-3--worked-example-complete-the-wizard-and-add-a-media-library-manual}

Il s'agit du flux de travail central d'Emby. Vous allez terminer la configuration initiale, créer
l'administrateur initial, ajouter une médiathèque reposant sur le volume persistant `/config`, puis
vérifier que vous pouvez la parcourir.

1. **Terminez l'assistant de configuration.** Avec `$SERVICE_URL` ouvert dans le navigateur :
   - **Preferred display language** (langue d'affichage préférée) — choisissez votre langue et cliquez sur **Next**.
   - **Create your admin account** (créer votre compte administrateur) — saisissez un nom d'utilisateur et un mot de passe robuste. Ce compte
     devient le propriétaire d'Emby ; c'est le seul administrateur tant que vous n'en ajoutez pas d'autres.
     Aucun identifiant n'est pré-enregistré dans Secret Manager.
   - **Setup Media Libraries** (configurer les médiathèques) — vous pouvez ignorer cette étape ici et ajouter une médiathèque à l'étape
     suivante depuis le Dashboard, ou ajouter votre première médiathèque directement.
   - **Preferred metadata language / country** (langue / pays préférés pour les métadonnées) — définissez la langue utilisée par Emby lorsqu'il
     récupère les illustrations, les descriptions et les autres métadonnées, puis **Next**.
   - **Remote access** (accès distant) — laissez *Allow remote connections to this server* activé
     (Cloud Run expose déjà le service en HTTPS) ; vous pouvez laisser le mappage automatique des ports
     désactivé. Cliquez sur **Next**, puis sur **Finish**. Emby redémarre sur l'écran de
     connexion — connectez-vous avec le compte administrateur que vous venez de créer. (C'est à cette étape
     qu'Emby proposerait une connexion Emby Connect facultative — elle est purement informative
     et peut être entièrement ignorée.)

2. **Ajoutez une médiathèque.** Dans l'interface web, allez dans le menu utilisateur →
   **Dashboard** → **Libraries** → **Add Media Library** :
   - **Content type** (type de contenu) — choisissez ce que contient le dossier, par exemple **Movies**, **Shows**,
     **Music** ou **Photos**.
   - **Display name** (nom d'affichage) — donnez un nom à la médiathèque (par exemple `Movies`).
   - **Folders** (dossiers) — cliquez sur **+** et indiquez à Emby un chemin *situé sous le volume
     persistant*, par exemple `/config/media/movies`. Tout ce qui se trouve sous `/config` repose sur le
     bucket GCS FUSE et survit aux redémarrages et aux redéploiements ; un chemin en dehors de `/config`
     réside sur le disque éphémère du conteneur et est perdu lorsque l'instance est recyclée.
     Créez d'abord le dossier et déposez-y un fichier d'exemple s'il n'existe pas
     (voir la note ci-dessous sur le placement des médias dans le volume).
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
   pas de GPU sur Cloud Run, de sorte que le transcodage d'un fichier volumineux peut saccader avec 1 vCPU
   par défaut. Le transcodage accéléré par le matériel nécessite en outre Emby Premiere.

> **Placer des médias sur le volume `/config` :** comme `/config` est un bucket GCS
> monté via FUSE, le moyen le plus simple d'y déposer du contenu est de copier les fichiers directement dans le
> bucket. Trouvez le bucket et téléversez dans le chemin de médiathèque que vous avez indiqué
> ci-dessus :
> ```bash
> BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
>   --filter="name~emby" --format="value(name)" | head -1)
> gcloud storage cp ./my-movie.mp4 "gs://${BUCKET}/media/movies/"
> ```
> GCS FUSE convient bien à un usage léger ou de démonstration ; pour une véritable médiathèque volumineuse ou une diffusion
> intensive, la **variante GKE avec un PVC en mode bloc** est plus adaptée (voir le lab
> [Emby sur GKE](Emby_GKE.md)).

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mise à l'échelle — conservez une seule instance.** Emby est une application à serveur unique
   avec état : ses bases SQLite et son cache de transcodage résident sur un seul volume `/config`
   et ne sont pas conçus pour des écritures concurrentes. Le module utilise par défaut
   `min_instance_count = 1` et `max_instance_count = 1` précisément pour cette raison —
   **conservez `max_instance_count = 1`**. Si la lecture a besoin de plus de marge, augmentez la taille de l'instance
   (relevez `cpu_limit` au-delà de la valeur par défaut `1000m` et `memory_limit` au-delà de `1Gi` pour
   le transcodage en direct) plutôt que le nombre d'instances. Appliquez les modifications en éditant les paramètres et en cliquant sur
   **Update** — le module est propriétaire de la spécification du service : une modification manuelle avec `gcloud` serait
   annulée lors de l'application suivante.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est buildée et une nouvelle révision est déployée.
   Comme l'état réside sur `/config`, la nouvelle révision reprend vos médiathèques et vos
   paramètres.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~emby"
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~emby" --format="value(name)" | head -1)
   gcloud storage ls "gs://${BUCKET}/"
   ```

   L'état qui compte est le volume `/config` — les bases SQLite ainsi que les
   métadonnées, les plugins et les paramètres utilisateur. Sauvegardez-le en copiant le bucket
   (`gcloud storage cp -r "gs://${BUCKET}" gs://<backup-bucket>`). Si vous avez activé la
   clé d'API facultative (`enable_api_key = true`), sa valeur de 32 caractères est stockée dans
   Secret Manager sous le nom `secret-<prefix>-<app>-api-key` et injectée en tant que `EMBY_API_KEY` ;
   notez que les clés d'API propres à l'application Emby se créent séparément dans
   **Dashboard → API Keys**.

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation du CPU et de la
   mémoire. Surveillez le CPU pendant la lecture — une saturation prolongée signifie généralement qu'un
   client déclenche un transcodage et que vous devriez relever `cpu_limit` ou orienter les clients
   vers la lecture directe. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il est
   au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Emby à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage, et vérifiez que le volume `/config` est monté. La sonde de
  démarrage est une vérification **TCP** sur le port 8096 — elle réussit dès que l'écouteur d'Emby
  est lié ; une révision qui échoue à cette sonde signifie donc presque toujours que le conteneur n'a jamais
  atteint ce stade (un problème de build ou de point d'entrée), et non un problème de santé au niveau de l'application.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les médiathèques ou les paramètres ont disparu après un redéploiement :** vérifiez que le chemin de médias que vous
  avez indiqué se trouve sous `/config` (le montage GCS FUSE persistant). Un chemin en dehors de
  `/config` est éphémère et perdu à chaque recyclage d'instance.
- **La lecture saccade ou expire :** il s'agit presque toujours d'un transcodage sous une limite de 1 vCPU.
  Privilégiez les médias en lecture directe, ou relevez `cpu_limit`/`memory_limit`. Notez que GCS FUSE
  ajoute de la latence en lecture, ce qui aggrave le transcodage d'un fichier volumineux. Le transcodage
  matériel nécessite Emby Premiere et n'est de toute façon pas disponible sur ce module Cloud Run.
- **Des médias n'apparaissent pas dans une médiathèque :** relancez **Scan Library** et vérifiez que le fichier
  a bien été déposé dans le chemin du bucket (`gcloud storage ls`).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution,
  y compris la lecture/écriture sur le bucket GCS FUSE.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment conserver `max_instance_count = 1` et dimensionner le CPU pour le transcodage).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
le bucket GCS `/config` (**y compris vos bases SQLite, vos métadonnées et tous les médias
que vous y avez copiés**), les secrets Secret Manager et les images Artifact Registry. Si vous
souhaitez conserver votre médiathèque, sauvegardez d'abord le bucket (tâche 4). Les ressources appartenant à
**Services_GCP** (le VPC, le registre, les comptes de service partagés) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le service Cloud Run et un bucket GCS FUSE `/config`, et build l'image (sans base de données externe) |
| 2 — Accéder et vérifier | Manuel | `/` renvoie un 302 vers l'assistant de configuration ; l'assistant se charge à l'URL du service |
| 3 — Exemple guidé | Manuel | Terminer l'assistant, créer l'administrateur, ajouter une médiathèque sur `/config`, l'analyser et la parcourir |
| 4 — Exploiter | Manuel | Inspecter les révisions, conserver une seule instance, dimensionner le CPU, mettre à jour la version, sauvegarder `/config` |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de persistance, de transcodage, d'analyse, de build et d'IAM |
| 7 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le bucket `/config` |
