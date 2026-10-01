---
title: "Netdata sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Netdata sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Netdata_CloudRun.md @ 3055034 sha256:07e37afc686e -->

# Netdata sur Cloud Run — Guide de lab {#netdata-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netdata_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Netdata est un agent open source de surveillance en temps réel des infrastructures et des applications,
qui collecte des milliers de métriques par seconde et les restitue sur un
tableau de bord intégré et via une API REST. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **Netdata on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Netdata. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netdata_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, et comprendre son exposition par défaut.
- Effectuer les opérations du jour 2 — inspecter, maintenir l'échelle à une seule instance, mettre à jour et gérer les secrets.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Netdata (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Netdata_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. **Portez une attention particulière à
   `ingress_settings` et `enable_admin_password`** : le module utilise par défaut
   `ingress_settings = "all"` (accès depuis l'internet public) associé à
   `enable_admin_password = true` (un identifiant stocké dans Secret Manager est
   généré pour satisfaire la garde du module au moment du plan) — mais le
   tableau de bord de Netdata lui-même n'a **aucune connexion intégrée** ; tel quel, le déploiement est donc
   **joignable publiquement et non authentifié**. Si ce n'est pas ce que vous voulez,
   définissez `ingress_settings = "internal"` avant de déployer. Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image personnalisée légère (`FROM netdata/netdata:<pinned
   version>`), la pousse dans Artifact Registry, provisionne le service Cloud Run,
   un bucket de données Cloud Storage monté comme volume **GCS FUSE** sur
   `/var/lib/netdata` (ce qui exige l'environnement d'exécution gen2) et — si
   `enable_admin_password = true` — un secret Secret Manager contenant
   `NETDATA_ADMIN_PASSWORD`. Il n'y a **aucune base de données** (`database_type = NONE`)
   et **aucun job d'initialisation** à attendre ; les premiers déploiements sont donc dominés par
   le build de l'image plutôt que par le provisionnement d'une base de données — généralement **10 à 20
   minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~netdata" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Netdata expose un point de terminaison d'information qui
   ne répond qu'une fois l'agent initialisé :

   ```bash
   curl -s "$SERVICE_URL/api/v1/info"   # expect a 200 JSON body describing the running agent
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Contrairement à la plupart des modules applicatifs, Netdata
   n'a **ni assistant de premier démarrage ni étape de création de compte administrateur** — le
   tableau de bord est pleinement fonctionnel dès que le service est Ready. Si vous avez conservé
   la valeur par défaut `ingress_settings = "all"`, ce tableau de bord (métriques complètes de CPU,
   de mémoire, de disque, de réseau et de conteneurs de l'hôte) est accessible à toute personne disposant
   de l'URL. Considérez ce comportement par défaut comme attendu mais risqué, et non comme un bug :
   - Pour une correction rapide, passez `ingress_settings` à `internal` dans la plateforme
     RAD et appliquez via **Update**.
   - Pour le garder public tout en ajoutant une barrière de connexion, activez `enable_iap` (connexion
     Google devant un équilibreur de charge externe) — consultez le Guide de
     configuration.

3. Si `enable_admin_password = true`, récupérez l'identifiant généré — il
   ne protège **pas** le tableau de bord de Netdata lui-même, mais il est disponible pour un
   proxy inverse géré par l'opérateur ou pour le processus de rattachement à Netdata Cloud :

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~netdata-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count` et
   `max_instance_count` valent tous deux `1` par défaut — Netdata conserve sa base de
   métriques sur le volume local adossé à GCS d'une instance unique ; une mise à l'échelle
   horizontale produit donc des agents indépendants et non fédérés plutôt qu'un
   tableau de bord partagé. Laissez ces valeurs à `1` sur la page de détails du déploiement.

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update**. `latest` est résolu en une
   étiquette figée connue pour fonctionner (`v2.2.6`) au moment du build, via l'argument de build propre à l'application
   `NETDATA_VERSION` — définissez une étiquette explicite pour suivre une
   autre version, puis confirmez que le nouveau build l'a bien prise en compte :

   ```bash
   gcloud run revisions describe "$(gcloud run revisions list --service="$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format='value(metadata.name)' --limit=1)" \
     --project="$PROJECT" --region="$REGION" --format='value(spec.containers[0].image)'
   ```

4. **Gérez les secrets et vérifiez la présence de jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~netdata"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # empty by default — Netdata has no init/backup jobs
   ```

5. **Vérifiez l'utilisation du stockage des métriques** — le bucket GCS FUSE qui sert de support à
   `/var/lib/netdata` contient le magasin de métriques dbengine, le journal des alarmes et la
   configuration :

   ```bash
   gcloud storage ls -L gs://<data-bucket>/ | head
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU et de la
   mémoire. Le module peut provisionner un **test de disponibilité** ciblant
   `/api/v1/info` (désactivé par défaut) ; s'il est activé, confirmez qu'il est au vert sous
   Monitoring → Uptime checks, et examinez Alerting → Policies. Le tableau de bord de Netdata
   lui-même est aussi une surface de surveillance — il indique sur sa page d'accueil l'état de ses collecteurs
   et le nombre de graphiques.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Netdata.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision
  et ses journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible `/api/v1/info`
  avec un délai initial de 15 secondes et 10 tentatives.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les métriques sont réinitialisées à chaque déploiement :** confirmez que `enable_gcs_storage_volume` (et
  le paramètre sous-jacent `create_cloud_storage`) est toujours activé, et que l'environnement
  d'exécution du service est **gen2** — GCS FUSE pour
  `/var/lib/netdata` l'exige ; gen1 ne peut pas monter le volume, et chaque nouvelle
  révision démarre alors avec une base de métriques vide.
- **Tableau de bord public de manière inattendue :** revérifiez `ingress_settings` — la valeur par défaut
  du module est `all`. Combinée à la valeur par défaut `enable_admin_password = true`,
  elle passe la validation au moment du plan mais laisse tout de même le tableau de bord brut
  non authentifié pour quiconque atteint l'URL. Passez à `internal`, ou ajoutez
  `enable_iap` / un proxy inverse avec authentification devant un équilibreur de charge externe.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en
  échec ; une cause fréquente est de figer `application_version` sur une étiquette qui n'existe
  pas en amont pour `netdata/netdata`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris l'association `ingress_settings` +
`enable_admin_password` et l'exigence gen2/GCS FUSE).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
le bucket de données GCS (et avec lui tout l'historique de surveillance accumulé), tout
secret Secret Manager et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit une image personnalisée figée, provisionne Cloud Run, un bucket de données GCS FUSE et (par défaut) un secret de mot de passe administrateur — ni base de données, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; le tableau de bord est immédiatement utilisable (aucune configuration d'administrateur) — confirmer l'exposition voulue (`ingress_settings`) |
| 3 — Exploiter | Manuel | Inspecter les révisions, maintenir une seule instance, mettre à jour la version, gérer les secrets, vérifier le stockage des métriques |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de GCS FUSE/persistance, d'exposition publique et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris l'historique des métriques accumulé |
