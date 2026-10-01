---
title: "Calibre-Web sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Calibre-Web sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/CalibreWeb_CloudRun.md @ 3055034 sha256:16d60bcce40c -->

# Calibre-Web sur Cloud Run — Guide de lab {#calibre-web-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalibreWeb_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Calibre-Web est une application web auto-hébergée qui permet de parcourir, lire et
télécharger les livres numériques d'une bibliothèque Calibre — elle fournit une
liseuse dans le navigateur, un flux OPDS et la synchronisation Kobo, à partir de
l'image amont de LinuxServer.io. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Calibre-Web on Cloud Run** sur Google Cloud : le déployer, y
accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Calibre-Web. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalibreWeb_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, gérer l'identifiant administrateur et le bucket `/config`.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Calibre-Web (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalibreWeb_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme construit et copie l'image de conteneur (épinglée sur un tag `0.6.24`
   éprouvé lorsque `application_version = "latest"`), provisionne le service Cloud Run,
   un secret Secret Manager (`CALIBRE_ADMIN_PASSWORD`) et un bucket Cloud Storage
   (`create_cloud_storage = true` — créé, mais **non** monté sur `/config`). `/config`
   repose plutôt sur le volume **NFS** partagé (`enable_nfs` vaut `true` par défaut, et
   `nfs_mount_path` vaut `/config`) ; le volume GCS FUSE est volontairement désactivé
   (`enable_gcs_storage_volume = false`) car le fichier SQLite `app.db` de Calibre-Web
   s'y trouve. Il n'y a ni base de données ni job d'initialisation — Calibre-Web gère
   son propre stockage SQLite au premier démarrage. Un premier déploiement prend
   généralement **5–15 minutes** (essentiellement le build du conteneur).

3. Une fois l'opération terminée, repérez la ressource à l'aide d'un filtre
   indépendant des noms (pour que la commande fonctionne quel que soit le suffixe du
   déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~calibreweb" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Les sondes de démarrage et de vivacité de
   Calibre-Web ciblent toutes deux le chemin racine, qui sert la page de connexion
   sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Connectez-vous avec les identifiants par
   défaut intégrés à l'image amont — **`admin` / `admin123`** — le secret
   `CALIBRE_ADMIN_PASSWORD` généré automatiquement dans Secret Manager n'est **pas**
   relié au processus de connexion du conteneur. Immédiatement après la première
   connexion, changez le mot de passe administrateur dans l'interface de Calibre-Web
   (Admin → Edit User) ; vous pouvez utiliser la valeur du secret généré comme nouveau
   mot de passe :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Pointez Calibre-Web vers votre bibliothèque de livres numériques : utilisez
   l'assistant de configuration intégré à l'application pour définir l'emplacement de
   la bibliothèque sur `/books` (vide au premier lancement — téléversez-y ou
   synchronisez-y ensuite des livres numériques).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **N'augmentez pas `max_instance_count` au-delà de `1`.** Chaque instance Cloud Run
   monte le même volume adossé au NFS sur `/config` ; si plusieurs instances écrivent
   simultanément dans les mêmes fichiers SQLite (`app.db`, le `metadata.db` de
   Calibre), elles risquent de les corrompre. Pour le reste, la mise à l'échelle est
   une modification de configuration dans la plateforme RAD (modifiez les paramètres
   d'instances min/max et cliquez sur **Update**), et non une modification manuelle via
   `gcloud` — une modification manuelle serait annulée lors du prochain apply.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est
   construite (épinglée via l'ARG de build propre à l'application
   `CALIBREWEB_VERSION`) et une nouvelle révision est déployée.

4. **Inspectez le bucket `/config`** (qui contient les bases SQLite, la configuration,
   le cache et les journaux) :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~calibreweb" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

5. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~calibreweb"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # only user-supplied jobs, if any
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
   nombre de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation
   du CPU et de la mémoire. Les tests de disponibilité (uptime checks) sont
   **désactivés par défaut** (`uptime_check_config.enabled = false`) — activez-en un
   dans la plateforme RAD si vous souhaitez des alertes de disponibilité automatisées.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Calibre-Web à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage. La sonde de démarrage
  cible `/` (la page de connexion, `200`, sans authentification) avec un
  `failure_threshold=10` généreux à `period=10s`, de sorte qu'un conteneur lent à
  démarrer a tout de même le temps de réussir.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La connexion échoue avec les identifiants intégrés :** vérifiez que vous utilisez
  `admin` / `admin123` (la valeur par défaut amont), et non la valeur
  `CALIBRE_ADMIN_PASSWORD` de Secret Manager — ce secret est provisionné, mais n'est
  pas appliqué au processus de connexion réel du conteneur.
- **`/config` semble vide ou réinitialisé après un redéploiement :** vérifiez que le
  serveur NFS partagé est toujours détecté et toujours monté sur `/config`
  (`enable_nfs = true`, `nfs_mount_path = "/config"`) ; un volume NFS nouvellement
  provisionné expliquerait une bibliothèque apparemment « réinitialisée ». Le bucket
  GCS `storage` est toujours créé (`create_cloud_storage = true`), mais ce n'est pas lui
  qui sert de support à `/config`.
- **Corruption SQLite suspectée sous charge :** `/config` repose par défaut sur le NFS
  (`enable_nfs = true`), précisément parce que GCS FUSE ne supporte pas le journal de
  retour arrière SQLite de Calibre-Web (constaté en conditions réelles sur ce module :
  `BufferedWriteHandler.OutOfOrderError for object: app.db-journal`). Si vous voyez
  cette erreur, les valeurs par défaut ont été modifiées — `enable_gcs_storage_volume`
  activé, ou `enable_nfs` désactivé — rétablissez-les donc plutôt que de poursuivre
  les réglages. Pour un véritable périphérique en mode bloc, utilisez `CalibreWeb_GKE`
  (PVC en mode bloc).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre. Notez deux écarts confirmés entre la documentation et le
code source à garder à l'esprit lors du dépannage : le texte de description de la
variable `liveness_probe` mentionne un point de terminaison `/health` qui n'existe pas
(le chemin réellement configuré est `/` — ne le remplacez pas par `/health`), et la
description de la sortie `calibreweb_url` dans `outputs.tf` est un copier-coller
obsolète qui fait référence à une « REST API (port 6333) » provenant d'un module sans
rapport — la valeur est simplement l'URL normale du service Cloud Run.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
le secret `CALIBRE_ADMIN_PASSWORD`, le bucket Cloud Storage `/config` et les images
Artifact Registry (y compris votre bibliothèque de livres numériques et les bases
SQLite de Calibre-Web, puisqu'elles résident uniquement dans ce bucket). Les ressources
appartenant à **Services_GCP** (le VPC, Artifact Registry) sont gérées séparément et ne
sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, un secret Secret Manager pour le mot de passe administrateur, un point de montage `/config` adossé au NFS et un bucket GCS (distinct, non monté) ; pas de base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; connexion avec `admin`/`admin123` et changement immédiat du mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver `max_instance_count=1`, mettre à jour la version, inspecter le bucket `/config` |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring (test de disponibilité facultatif, désactivé par défaut) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de connexion, de stockage et de build ; deux écarts connus entre documentation et code source signalés |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris la bibliothèque de livres numériques et l'état SQLite |
