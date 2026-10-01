---
title: "Budibase sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Budibase sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Budibase_CloudRun.md @ 3055034 sha256:532a3bff0413 -->

# Budibase sur Cloud Run — Guide de lab {#budibase-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Budibase_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Budibase est une plateforme low-code open source permettant de créer des outils
internes, des applications métier et des workflows à partir de vos données. L'image
officielle est un conteneur **tout-en-un** qui regroupe CouchDB, MinIO et Redis aux
côtés des composants apps/worker/proxy de Budibase ; ce module ne nécessite donc
aucune base de données gérée externe. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Budibase on Cloud Run** sur Google Cloud : le déployer, y
accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Budibase. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Budibase_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et créer le compte administrateur initial.
- Effectuer les opérations du jour 2 — inspecter les révisions, comprendre pourquoi la
  mise à l'échelle est fixée à une seule instance, mettre à jour la version et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants, y compris une instabilité connue propre à la variante Cloud Run de ce module.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même au
  préalable : la plateforme détecte automatiquement s'il existe déjà dans le projet
  cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Budibase (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez
   en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Budibase_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme construit une image d'encapsulation minimale (`FROM budibase/budibase`)
   et la copie dans Artifact Registry, puis provisionne le service Cloud Run (une seule
   instance, `4000m` de CPU / `8Gi` de mémoire par défaut), un bucket de données Cloud
   Storage et sept secrets d'identifiants internes dans Secret Manager
   (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
   `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). Il n'y a **aucune
   instance Cloud SQL** ni job d'initialisation de base de données — Budibase
   provisionne lui-même ses CouchDB et MinIO intégrés au premier démarrage. Un premier
   déploiement prend environ **10–20 minutes**, essentiellement consacrées au build de
   l'image de conteneur.

3. Une fois l'opération terminée, repérez la ressource à l'aide d'un filtre
   indépendant des noms (pour que la commande fonctionne quel que soit le suffixe du
   déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~budibase" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. La sonde de démarrage (startup probe) est une sonde **TCP** sur le port 80 (nginx
   ouvre le port en quelques secondes, mais renvoie 502 jusqu'à ce que les services
   amont CouchDB/MinIO/application intégrés aient fini de démarrer) et accorde jusqu'à
   environ 10 minutes au premier démarrage. Les sondes de vivacité et de disponibilité
   (liveness et readiness) sont des sondes HTTP sur la racine non authentifiée `/`,
   avec un délai initial de 240 secondes pour couvrir la période qui suit le
   démarrage. Laissez à la première révision toute cette fenêtre avant de conclure
   qu'elle est en mauvaise santé :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 200 once fully booted
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Budibase auto-hébergé est livré **sans
   compte administrateur par défaut** — l'écran de configuration vous invite à créer
   l'administrateur initial (e-mail + mot de passe). Faites-le immédiatement après le
   déploiement ; tant qu'aucun administrateur n'a été créé, toute personne qui atteint
   l'URL peut s'approprier l'instance.

3. N'oubliez pas que sur Cloud Run, **tout l'état de Budibase (documents CouchDB +
   objets MinIO) réside dans le répertoire éphémère `/data` du conteneur** — il n'y a
   pas de disque local durable. Un redémarrage ou une nouvelle révision fait perdre
   tout ce que vous créez dans ce lab. Considérez ce déploiement comme réservé à la
   démonstration et à l'évaluation ; utilisez la
   [variante GKE](Budibase_GKE.md) pour tout ce que vous devez conserver.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne modifiez pas la mise à l'échelle.** `min_instance_count = max_instance_count = 1`
   est une exigence stricte, et non un point de départ — le conteneur tout-en-un
   conserve tout son état localement ; une deuxième instance ne partagerait donc pas
   le stockage de données (split-brain) et la mise à l'échelle à zéro le ferait
   disparaître entièrement. Ne touchez pas à ces deux paramètres.

3. **Mettez à jour la version de l'application** en modifiant `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; cela reconstruit l'image
   d'encapsulation minimale (épinglée via l'ARG de build `BUDIBASE_VERSION`) et déploie
   une nouvelle révision. Ne touchez jamais aux sept secrets générés automatiquement à
   cette occasion — voir l'étape 4.

4. **Gérez les secrets** — listez-les, mais n'en faites jamais tourner aucun après le
   premier démarrage ; les données de `/data` sont chiffrées avec ces valeurs exactes et
   deviennent illisibles si l'une d'elles change :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~budibase"
   ```

5. **Bucket Cloud Storage** — un bucket de données est provisionné pour l'intégration
   de stockage au niveau de la fondation, mais le stockage des ressources et pièces
   jointes propre à Budibase est le MinIO intégré sur `/data`, et non ce bucket :

   ```bash
   gcloud storage ls gs://$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~budibase" --format="value(name)" --limit=1)
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre d'instances (il doit rester stable à exactement une), la latence des
   requêtes et l'utilisation du CPU et de la mémoire. `cpu_always_allocated = true`
   maintient un vCPU complet facturé en continu afin que les processus d'arrière-plan
   CouchDB/MinIO/Redis intégrés continuent de tourner entre les requêtes — c'est
   attendu, et non une fuite. Si un **test de disponibilité** (uptime check) est
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Budibase à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière
  révision et ses journaux. N'oubliez pas que la sonde de démarrage est TCP (elle ne
  vérifie que l'écoute du port) — un HTTP 502 sur `/` pendant plusieurs minutes après
  le passage de la révision à l'état Ready est attendu tant que les services amont
  CouchDB/MinIO/application intégrés n'ont pas fini de démarrer.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Instance qui redémarre environ toutes les 60 secondes :** le tableau
  *Configuration Pitfalls* du Guide de configuration documente précisément ce symptôme
  comme une boucle de dépassement de mémoire lorsque la mémoire de
  `container_resources` est inférieure à la valeur par défaut de **8Gi** — le
  répertoire inscriptible `/data` (état CouchDB/MinIO/Redis) est en mémoire sur Cloud
  Run gen2 et compte dans la limite de mémoire ; avec 4Gi, le service boucle donc sur
  des erreurs OOM. Vérifiez d'abord que la limite de mémoire déployée est d'au moins 8Gi.
- **Problème connu non résolu — instabilité même avec le dimensionnement documenté de 8Gi/4vCPU :**
  en pratique, on a observé que la variante Cloud Run de ce module continue de
  relancer une nouvelle instance environ toutes les 60 secondes, **sans aucune sortie
  stdout/stderr du conteneur**, même avec la valeur par défaut (et documentée comme
  suffisante) de 8Gi de mémoire / 4 vCPU, bien au-delà de toute fenêtre de patience
  raisonnable des sondes. Il s'agit actuellement d'un problème **non résolu** du
  chemin Cloud Run, distinct de la boucle OOM due au manque de mémoire documentée
  ci-dessus. Conformément aux indications du module lui-même, selon lesquelles Cloud
  Run est « éphémère / réservé à la démonstration » pour Budibase, ne vous fiez pas à
  cette variante au-delà d'une évaluation rapide — si vous constatez des relances
  d'instance persistantes et silencieuses après avoir confirmé le dimensionnement de
  8Gi/4vCPU, considérez qu'il s'agit de ce problème connu plutôt que d'une erreur de
  configuration, et préférez la [variante GKE](Budibase_GKE.md).
- **Pas d'administrateur / instance non revendiquée :** si vous n'avez pas créé le
  compte administrateur immédiatement après le premier accès, toute personne qui
  atteint l'URL peut encore s'approprier l'instance — vérifiez qu'aucun compte
  administrateur inattendu n'existe déjà.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le
  journal du build en échec (le build produit l'image d'encapsulation minimale
  `FROM budibase/budibase:<version>`).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire
tourner l'un des sept identifiants internes générés automatiquement après le premier
démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
les secrets Secret Manager, le bucket GCS et les images Artifact Registry (et, avec
eux, les données éphémères CouchDB/MinIO, qui n'ont de toute façon jamais été
durables). Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit une image d'encapsulation minimale et provisionne Cloud Run (une seule instance, 8Gi/4vCPU), un bucket GCS et sept secrets d'identifiants internes — pas de Cloud SQL |
| 2 — Accéder et vérifier | Manuel | La sonde de démarrage TCP réussit ; HTTP `/` renvoie 200 ; création du compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, maintenir la mise à l'échelle fixée à 1/1, mettre à jour la version, gérer les secrets (ne jamais les faire tourner) |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision/sonde, la boucle OOM documentée due au manque de mémoire et le problème connu non résolu de relance d'instances sur cette variante |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module (les données éphémères de l'application sont perdues dans tous les cas) |
