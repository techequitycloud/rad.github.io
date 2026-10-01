---
title: "NetBox sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez NetBox sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Netbox_CloudRun.md @ 3055034 sha256:b8c016cc359e -->

# NetBox sur Cloud Run — Guide de lab {#netbox-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netbox_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 90 minutes

NetBox est l'outil open source de référence pour la documentation des réseaux et
des infrastructures et l'IPAM (gestion des adresses IP) — inventaire des équipements et des baies,
suivi des adresses IP et des préfixes, câblage et topologie réseau,
modélisés sous forme de données structurées derrière une API complète. Ce lab vous fait parcourir le
cycle de vie opérationnel complet du module **NetBox on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit NetBox. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Netbox_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, notamment en confirmant que les fichiers multimédias téléversés
  sont réellement conservés dans Cloud Storage.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, notamment
  une mauvaise configuration de Redis ou du worker d'arrière-plan.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **NetBox (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Netbox_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY`, `SUPERUSER_PASSWORD`
   et le mot de passe de la base de données), un bucket Cloud Storage `media`, construit
   l'image de conteneur personnalisée (qui encapsule `netboxcommunity/netbox`) et exécute un
   job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **20 à 35 minutes** (la création de Cloud SQL domine).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~netbox" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. La page de connexion publique de NetBox ne répond
   qu'une fois le serveur entièrement initialisé et PostgreSQL joignable :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/login/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL/login/` dans un navigateur. Récupérez les identifiants
   administrateur générés automatiquement et connectez-vous :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Connectez-vous en tant que `admin` (ou votre `admin_user` configuré) avec ce mot de passe.
   Vous devriez arriver sur le tableau de bord de NetBox.

3. **Vérifiez que les fichiers multimédias téléversés sont réellement conservés** — cela met en jeu exactement le
   chemin de code pour lequel ce module a eu besoin d'un véritable correctif. Dans l'interface de NetBox, téléversez une
   image en pièce jointe sur un objet quelconque (par exemple, ajoutez une image en pièce jointe à un équipement ou à un
   site), puis confirmez qu'elle a bien atterri dans le bucket GCS sous-jacent, et pas seulement sur le
   disque local du conteneur :

   ```bash
   MEDIA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~media" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$MEDIA_BUCKET/"
   ```

   Le fichier téléversé devrait apparaître en quelques secondes. Si le bucket est
   vide alors que le téléversement semblait réussi dans l'interface, consultez la tâche 5.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service ; la mise à l'échelle
   est donc une modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). Notez que le worker RQ d'arrière-plan de NetBox
   (webhooks, rapports, scripts, jobs planifiés) est hébergé dans le même
   conteneur et ne s'exécute que lorsqu'une instance est active avec la mise à l'échelle par défaut
   qui privilégie le coût (`cpu_always_allocated = false`, `min_instance_count = 0`)
   — définissez ensemble `cpu_always_allocated = true` et `min_instance_count >= 1`
   pour le maintenir actif en permanence.

3. **Mettez à jour l'étiquette de version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite (en transmettant
   `application_version` comme ARG de build `APPLICATION_VERSION` du Dockerfile)
   et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~netbox"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. netboxdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^netbox" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation du CPU et de la mémoire. Le module peut provisionner un
   **test de disponibilité** (`uptime_check_config.enabled = true`, défini par défaut sur `true`
   avec `path = "/login/"`) ; confirmez qu'il est au vert sous Monitoring → Uptime
   checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de NetBox.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et confirmez que les variables d'environnement et les secrets ont été résolus. La
  sonde de démarrage cible `/login/` et autorise jusqu'à 60 tentatives à 10 secondes
  d'intervalle lors du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La connexion échoue avec une erreur CSRF :** le paramètre `CSRF_TRUSTED_ORIGINS` du service doit
  correspondre à son URL réelle. Vérifiez :
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" \
    --format='value(status.url)'
  ```
  Si elle ne correspond pas à l'URL que vous consultez, le déploiement est
  mal configuré — revérifiez le câblage de `service_url` plutôt que de supposer un
  problème de cookie côté navigateur.
- **Les téléversements « réussissent » dans l'interface mais n'apparaissent jamais dans le bucket GCS :** c'est
  exactement la catégorie de bug pour laquelle ce module a déjà été corrigé une fois — un volume GCS Fuse
  monté au mauvais chemin laisse les téléversements sur le système de fichiers éphémère du conteneur,
  où ils se relisent sans problème (ce qui trompe une vérification rapide dans l'interface) mais disparaissent
  à la révision ou au redémarrage suivant. Confirmez que le chemin de montage est le véritable
  `MEDIA_ROOT` de NetBox (`/etc/netbox/media`, et non `/opt/netbox/netbox/media`) et vérifiez
  le bucket directement plutôt que de vous fier à la seule interface :
  ```bash
  gcloud storage ls "gs://$MEDIA_BUCKET/"
  ```
- **Les webhooks, rapports ou jobs planifiés ne s'exécutent jamais :** le worker RQ d'arrière-plan
  de NetBox ne s'exécute que lorsqu'une instance est active avec la mise à l'échelle par défaut qui privilégie le coût.
  Définissez `cpu_always_allocated = true` et `min_instance_count >= 1` si un
  traitement d'arrière-plan continu est nécessaire.
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base de données existe et que le job d'initialisation
  s'est terminé avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, les buckets
GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le bucket media, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; se connecter avec l'identifiant administrateur généré automatiquement ; confirmer que les fichiers multimédias téléversés arrivent dans GCS |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de CSRF, de persistance des fichiers multimédias, de worker d'arrière-plan, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
