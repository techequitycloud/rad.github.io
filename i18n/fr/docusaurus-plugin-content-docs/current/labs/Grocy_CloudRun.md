---
title: "Grocy sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Grocy sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Grocy_CloudRun.md @ 3055034 sha256:56335912ccf7 -->

# Grocy sur Cloud Run — Guide de lab {#grocy-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Grocy_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Grocy est un ERP auto-hébergé pour les courses et le foyer — suivi des stocks avec lecture
de codes-barres, gestion des corvées et des tâches, listes de courses et planification des repas. Ce lab vous guide
à travers le cycle de vie opérationnel complet du module **Grocy on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Grocy. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Grocy_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, notamment en vous connectant avec les identifiants
  par défaut et en les modifiant.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour, et gérer le volume persistant `/config`.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, notamment le
  piège du backend de stockage que la configuration par défaut de ce module vise à éviter.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Filestore/NFS, Artifact Registry et les
  comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Grocy (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Grocy_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, réplique l'image de conteneur Grocy
   dans Artifact Registry et monte un volume Cloud Filestore (NFS) sur `/config` —
   **et non** un bucket GCS ; voir la tâche 5 pour comprendre pourquoi. Il n'y a aucune base de données à provisionner (Grocy
   utilise une base de données SQLite intégrée) ni de job d'initialisation par défaut. Un premier
   déploiement prend environ **10–20 minutes**, dominées par la création de l'instance Filestore
   si aucun serveur NFS partagé n'existe déjà dans le projet.

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~grocy" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service répond. Grocy n'a pas de point de terminaison de santé dédié — la
   page de connexion elle-même (`200`, non authentifiée) sert de cible aux sondes :

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"
   # expect: 200 <nonzero size>
   curl -s "$SERVICE_URL/" | grep -o '<title>[^<]*</title>'
   # expect: <title>Login | Grocy</title>
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Connectez-vous avec les identifiants par défaut intégrés
   à Grocy — **`admin` / `admin`** — il n'y a aucun identifiant pré-initialisé à rechercher dans Secret
   Manager ; l'image amont est livrée directement avec cette valeur par défaut.

3. **Changez immédiatement le mot de passe administrateur.** Allez dans le menu utilisateur → **Manage
   users** → modifiez `admin` → définissez un nouveau mot de passe. Comme `ingress_settings = "all"`
   est la valeur par défaut du module (accès public depuis Internet), laisser les identifiants par défaut
   en place sur un déploiement en production constitue une véritable exposition.

4. Ajoutez un élément réel — par exemple un produit sous **Master data → Products**, ou une corvée
   sous **Chores** — et vérifiez qu'il apparaît dans la vue de liste correspondante. Il s'agit de
   l'écriture avec état qui prouve que le volume `/config` (qui contient la base de données SQLite
   intégrée) est réellement accessible en écriture et durable, et pas seulement que la page de connexion
   s'est affichée.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **La mise à l'échelle est volontairement verrouillée à une instance.** Contrairement à la plupart des modules de ce
   catalogue, n'augmentez pas `max_instance_count` au-delà de `1` — la base de données SQLite intégrée
   de Grocy n'accepte qu'un seul rédacteur et ne prend pas en charge le clustering. Il n'existe ni Redis ni
   équivalent à activer qui rendrait la mise à l'échelle horizontale sûre ici.

3. **Mettez à jour le tag de version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite (fixée via l'ARG de build
   `GROCY_VERSION`, et non via le générique `APP_VERSION`) et une nouvelle révision est
   déployée. Le volume persistant `/config` n'est pas affecté par une mise à jour de l'image.

4. **Inspectez le volume persistant `/config`** (Filestore/NFS) qui contient la
   base de données SQLite intégrée, la configuration, les téléversements et les sauvegardes :

   ```bash
   gcloud filestore instances list --project="$PROJECT" --zone="${REGION}-a"
   ```

5. **Sauvegardez `/config` manuellement si nécessaire** — ce module ne comporte aucun job de sauvegarde automatisé
   propre à Grocy ; utilisez les paramètres génériques de la plateforme `backup_schedule` /
   `enable_backup_import`, ou créez directement un instantané de l'instance Filestore via
   la Console.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

   Pour vérifier spécifiquement la santé du stockage, assurez-vous de l'absence de ces
   chaînes (leur présence indique la défaillance liée au schéma d'écriture de GCS-FUSE que la valeur
   NFS par défaut de ce module vise à éviter — voir la tâche 5) :
   `OutOfOrderError`, `429`, `stale file`, `database is locked`, `disk I/O error`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes, le nombre d'instances (qui doit rester exactement à `1`) et l'utilisation du CPU et
   de la mémoire. Le module peut provisionner un **test de disponibilité** (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé,
   vérifiez qu'il est au vert dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Grocy.

- **Le piège du backend de stockage que les valeurs par défaut de ce module visent à éviter.** Si vous
  voyez des `BufferedWriteHandler.OutOfOrderError` répétés, des réponses HTTP `429` ou
  des erreurs de descripteur de fichier obsolète (stale file handle) dans les journaux, accompagnés d'une boucle de plantage et de redémarrage, la cause la plus
  probable est que `/config` a été rebasculé (volontairement ou à la suite d'une
  erreur de configuration) sur GCS FUSE au lieu de NFS. La base de données SQLite intégrée de Grocy
  écrit un fichier journal toutes les 1 à 2 secondes — une fréquence d'écriture que la couche de traduction
  vers le stockage objet de GCS FUSE ne peut pas soutenir. Vérifiez que `enable_nfs = true` et
  `nfs_mount_path = "/config"` sont tous deux définis, et que `enable_gcs_storage_volume` sur
  le module Common sous-jacent vaut `false`.
  ```bash
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --limit=200 | grep -E 'OutOfOrderError|429|stale file|database is locked'
  ```
- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que le montage NFS s'est correctement attaché.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La page de connexion se charge, mais les données ne persistent pas après le redémarrage d'une révision :** cela
  indique que `/config` n'est pas réellement monté sur un stockage durable — revérifiez le câblage NFS
  ci-dessus plutôt que de supposer un bogue de l'application.
- **Échecs de build lors du déploiement ou de la mise à jour de version :** consultez l'historique Cloud Build pour
  le journal du build en échec. Un remplacement `container_image_source = "prebuilt"` égaré dans
  `deploy.tfvars` est un piège connu qui ignore silencieusement tout le build du Dockerfile
  personnalisé — vérifiez que la variable n'est pas définie ou vaut `"custom"`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution,
  y compris l'accès à l'instance Filestore.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne
peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
le bucket Cloud Storage `storage` et les images Artifact Registry. Une instance Filestore (NFS)
partagée avec d'autres applications du même tenant n'est **pas** supprimée ici ;
les ressources détenues par **Services_GCP** (le VPC, le Filestore partagé, le registre) sont
gérées séparément.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, réplique l'image du conteneur, monte `/config` via NFS |
| 2 — Accéder et vérifier | Manuel | Le test de santé réussit ; se connecter avec `admin`/`admin`, changer le mot de passe, écrire un élément réel |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, vérifier que la mise à l'échelle reste à 1, inspecter/sauvegarder le volume NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging (y compris la vérification de la signature de défaillance du stockage) ; examiner Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer le piège de stockage GCS-FUSE contre NFS, ainsi que les problèmes de révision, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, sauf l'instance Filestore partagée |
