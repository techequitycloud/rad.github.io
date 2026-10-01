---
title: "Beszel sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Beszel sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Beszel_CloudRun.md @ 3055034 sha256:776f29a1fd70 -->

# Beszel sur Cloud Run — Guide de lab {#beszel-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Beszel_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Beszel est un hub de supervision de serveurs léger et open source — métriques historiques de ressources, statistiques des conteneurs Docker et alertes configurables, construit sur PocketBase avec une base de données SQLite intégrée. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Beszel on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Beszel. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Beszel_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au hub en cours d'exécution, le vérifier et effectuer la configuration administrateur initiale.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour et gérer le bucket de données monté via FUSE.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Beszel (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Beszel_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (un seul conteneur Go sur le port
   8090), un bucket de données Cloud Storage dédié monté via FUSE sur `/beszel_data`
   (qui contient la base de données SQLite intégrée et tout l'historique de supervision), et
   met en miroir l'image Beszel dans Artifact Registry. **Aucun Cloud SQL, Redis ni
   job d'initialisation n'est créé** — Beszel est autonome ; le déploiement est donc rapide
   (généralement **10 à 20 minutes**).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~beszel" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le hub est sain. Le chemin de santé de Beszel est `/api/health`, un point de terminaison
   public et non authentifié qui renvoie HTTP 200 une fois le hub prêt (le premier
   démarrage crée le schéma SQLite ; prévoyez donc jusqu'à une minute sur un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/health"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier démarrage, Beszel présente la
   **configuration du superutilisateur (administrateur)** initiale de PocketBase — saisissez une adresse e-mail et un mot de passe administrateur pour
   la terminer. Aucun identifiant administrateur n'est stocké dans Secret Manager ; le compte que vous
   créez ici réside dans la base de données SQLite du bucket de données.

3. Après avoir créé l'administrateur, ajoutez un système à superviser : le hub affiche la commande
   d'installation de l'agent et sa clé publique. Installez l'agent Beszel sur une machine que vous
   souhaitez surveiller et confirmez qu'il commence à envoyer ses données à l'URL du hub. Notez que
   c'est `ingress_settings = "all"` (la valeur par défaut) qui permet aux agents distants d'atteindre le
   hub — conservez ce réglage sauf si tous les agents se trouvent dans le VPC.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **La mise à l'échelle est volontairement figée.** Beszel s'exécute avec `min_instance_count = 1` et
   `max_instance_count = 1` — une instance chaude, un seul processus d'écriture SQLite. **N'augmentez pas
   `max_instance_count`** : plusieurs instances sur la base de données partagée
   montée via FUSE risquent des conflits de verrouillage et une corruption. Toute modification est une
   modification de configuration effectuée via **Update** sur la page de détails du déploiement, et non
   une modification manuelle via `gcloud` (une modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; la nouvelle étiquette d'image est mise en miroir et une nouvelle
   révision est déployée. Beszel migre automatiquement sa base de données intégrée lors de la
   mise à niveau. Figez une étiquette explicite plutôt que `latest` pour maîtriser le moment où cela se produit.

4. **Inspectez l'état qui compte — le bucket de données.** Le bucket *est* la
   base de données (fichier SQLite, configuration, historique des métriques) :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~beszel"
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~beszel" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

   Il n'y a pas de session Cloud SQL à ouvrir dans ce lab — toute la persistance repose sur ce
   bucket. Traitez-le comme des données de production : ne le supprimez ni ne le videz jamais tant que le
   déploiement existe.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (qui doit rester stable à 1) et
   l'utilisation du CPU et de la mémoire. Le module provisionne également un **test de disponibilité** ;
   confirmez qu'il est au vert sous Monitoring → Uptime checks, et examinez Alerting →
   Policies. (Remarque : cette surveillance GCP observe le *hub* ; Beszel lui-même
   supervise les machines sur lesquelles s'exécutent ses agents.)

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Beszel.

- **Révision non saine / le service ne répond pas :** la sonde de démarrage cible
  `/api/health` avec une fenêtre de nouvelles tentatives qui couvre la création du schéma au premier démarrage.
  Inspectez la dernière révision et ses journaux avant de conclure à un échec du service :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **L'état n'est pas conservé / l'historique a disparu après un redéploiement :** vérifiez que l'environnement
  d'exécution est `gen2` (requis pour le montage GCS FUSE `/beszel_data`) et que
  le bucket de données existe et est monté sur la révision en cours d'exécution
  (`gcloud run services describe "$SERVICE" --format=json`, puis vérifiez les volumes).
- **Les agents ne parviennent pas à envoyer leurs données :** confirmez que `ingress_settings = "all"` et que IAP est
  **désactivé** — IAP bloque toutes les requêtes non authentifiées, y compris les envois de métriques
  des agents depuis des machines qui ne peuvent pas présenter d'identité Google.
- **Base de données verrouillée / erreurs 500 intermittentes :** vérifiez le nombre d'instances. Si
  `max_instance_count` a été porté au-delà de 1, deux processus d'écriture se disputent un même
  fichier SQLite — remettez-le immédiatement à 1.
- **Échec de la récupération de l'image :** le module met en miroir l'image Beszel en amont dans
  Artifact Registry (`enable_image_mirroring = true`) ; consultez l'historique Cloud Build
  pour le journal de l'étape de mise en miroir et confirmez que l'étiquette existe en amont.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution
  (il a besoin d'accéder au bucket de données pour le montage FUSE).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
le bucket de données Cloud Storage (qui **est** la base de données SQLite — tout l'historique de supervision
et le compte administrateur disparaissent avec lui) et les images Artifact Registry
mises en miroir. Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (port 8090), un bucket de données GCS FUSE, et met l'image en miroir — sans base de données ni Redis |
| 2 — Accéder et vérifier | Manuel | `/api/health` renvoie 200 ; terminer la configuration du superutilisateur PocketBase et connecter un agent |
| 3 — Exploiter | Manuel | Inspecter les révisions, respecter le blocage à une seule instance, mettre à jour la version, inspecter le bucket de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de persistance FUSE, d'entrée des agents, de verrou SQLite, de mise en miroir et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket de données |
