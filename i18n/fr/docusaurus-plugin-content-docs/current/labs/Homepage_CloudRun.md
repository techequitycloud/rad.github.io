---
title: "Homepage sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Homepage sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Homepage_CloudRun.md @ 3055034 sha256:a463c373dac2 -->

# Homepage sur Cloud Run — Guide de lab {#homepage-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Homepage_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–45 minutes

Homepage est un tableau de bord d'applications auto-hébergé et hautement personnalisable — une
page d'accueil unique regroupant liens, favoris et widgets d'état/statistiques en direct pour
vos autres services auto-hébergés, entièrement configurée au moyen de fichiers YAML. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Homepage on
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités d'édition de tableau de bord propres à Homepage. Pour la
liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Homepage_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Comprendre pourquoi Homepage n'a ni base de données ni assistant de configuration au premier lancement, et où se trouve réellement sa configuration.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Homepage (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. La plupart des déploiements ne nécessitent aucune modification des valeurs par défaut — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Homepage_CloudRun)
   documente chaque paramètre par groupe. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run et un bucket GCS `storage`
   monté sur `/app/config`. **Il n'y a ni instance Cloud SQL, ni Redis, ni
   secret Secret Manager** — Homepage n'a besoin d'aucun d'eux. Les premiers déploiements
   se terminent généralement en **3–6 minutes**, plus vite que la plupart des modules de ce
   catalogue puisqu'il n'y a aucune base de données à provisionner.

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~homepage" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et répond — via le point de terminaison de santé
   propre à Homepage, accessible sans authentification :

   ```bash
   curl -s "$SERVICE_URL/api/healthcheck" -o /dev/null -w '%{http_code} %{size_download}\n'
   # expect: 200 <n-bytes>
   curl -s "$SERVICE_URL/api/healthcheck"
   # expect: "up"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. **Il n'y a ni assistant de configuration au premier lancement
   ni connexion** — Homepage affiche immédiatement son tableau de bord à partir de la
   configuration présente dans `/app/config` (les valeurs par défaut intégrées à l'image amont
   sur un déploiement neuf). Vous devriez voir la page d'accueil par défaut de Homepage.

3. Vérifiez où se trouve réellement la configuration — le bucket GCS monté
   sur `/app/config`, et non une base de données :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~homepage" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   gcloud storage cat "gs://$BUCKET/settings.yaml"
   ```

4. Effectuez une modification réelle et persistante, puis vérifiez qu'elle est conservée — modifiez
   `services.yaml` directement dans le bucket, puis rechargez la page :

   ```bash
   gcloud storage cp "gs://$BUCKET/services.yaml" /tmp/services.yaml
   # edit /tmp/services.yaml — add a service entry
   gcloud storage cp /tmp/services.yaml "gs://$BUCKET/services.yaml"
   ```

   Rechargez `$SERVICE_URL` dans le navigateur — Homepage lit sa configuration YAML en direct
   à chaque requête ; la nouvelle entrée apparaît donc immédiatement, sans redémarrage
   nécessaire. C'est la véritable preuve que le raccordement du stockage fonctionne de bout en bout.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** — la valeur par défaut du module est `min_instance_count = 0` /
   `max_instance_count = 3`. Contrairement à la plupart des applications avec état de ce catalogue,
   les deux sens sont réellement sans risque pour Homepage : il lit sa configuration en direct
   depuis le disque (aucun cache en processus à préchauffer) et n'a aucun état à écrivain unique
   susceptible de provoquer une concurrence ; il n'est donc pas nécessaire d'épingler `max_instance_count = 1` ici.

3. **Mettez à jour le tag de version de l'application** via le flux **Update** de la plateforme
   RAD. Comme l'image est réellement préconstruite (`ghcr.io/gethomepage/homepage`),
   aucune étape Cloud Build locale n'intervient — la plateforme fait simplement pointer la
   révision suivante vers le nouveau tag.

4. **Vérifiez qu'il n'y a aucun secret à gérer :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~homepage"
   # expect: no results — this is correct, not a misconfiguration
   ```

5. **Inspectez ou sauvegardez le volume de configuration :**

   ```bash
   gcloud storage ls "gs://$BUCKET/"
   gcloud storage rsync "gs://$BUCKET/" /tmp/homepage-config-backup/
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Vérifiez la ligne de journal du montage GCS FUSE.** Peu après le démarrage du conteneur, Cloud
   Logging affiche une ligne GCSFuse « CLI Flags » — un exemple utile et sans enjeu de
   vérification du comportement réel à l'exécution par rapport aux valeurs Terraform configurées (voir
   la section Pitfalls du Guide de configuration pour comprendre pourquoi cette ligne précise
   mérite d'être connue) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -i gcsfuse
   ```

3. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence, le nombre d'instances et l'utilisation du CPU / de la mémoire. Le
   module peut provisionner un **test de disponibilité** (uptime check) (désactivé par défaut) ; s'il est
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision
  et ses journaux. La sonde de démarrage cible `/api/healthcheck`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```

- **Les widgets ne chargent pas leurs données / les appels `/api/*` renvoient 400.** C'est presque toujours
  `HOMEPAGE_ALLOWED_HOSTS` qui rejette l'en-tête `Host` de la requête. La valeur par défaut
  est `*` (accepte n'importe quel hôte) ; cela ne devrait donc se produire que si elle a été restreinte
  et que le nom d'hôte déployé a changé depuis. Vérifiez la valeur injectée :
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -o 'HOMEPAGE_ALLOWED_HOSTS[^,]*'
  ```

- **Les modifications de configuration faites via le bucket n'apparaissent pas.** Vérifiez que vous
  avez modifié le fichier réellement monté sur `/app/config` (le bucket `storage`
  de la tâche 1) et que l'onglet du navigateur a été rechargé — Homepage n'a aucun
  cache côté serveur à invalider ; un affichage obsolète vient donc presque toujours d'un onglet
  de navigateur obsolète, et non d'un problème de raccordement.

- **Propriétaire de fichiers inattendu lors de l'inspection du montage.** Si vous vous connectez un jour
  par `kubectl`/shell dans le conteneur (non applicable directement sur Cloud Run,
  mais pertinent si vous comparez avec un futur déploiement GKE) et voyez
  `uid=2000`/`gid=2000` sur les fichiers au lieu du `uid=1000` configuré,
  c'est attendu — consultez la section Pitfalls du Guide de configuration sur la
  substitution des options de montage GCS FUSE.

- **Erreurs 403 / d'autorisation provenant de GCP lui-même :** vérifiez les rôles IAM du compte de
  service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez
plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. Cela supprime tout ce que le module a créé —
le service Cloud Run, le bucket GCS `storage` (et chaque fichier de configuration YAML
qu'il contient) ainsi que les éventuelles images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run et un bucket GCS `storage` sur `/app/config` — sans base de données, sans Redis, sans secrets |
| 2 — Accéder et vérifier | Manuel | `/api/healthcheck` renvoie `200 "up"` ; le tableau de bord s'affiche sans assistant de configuration ; une modification directe du YAML prouve le raccordement du stockage |
| 3 — Exploiter | Manuel | Inspecter les révisions, confirmer que la mise à l'échelle est sans risque dans les deux sens, mettre à jour la version, sauvegarder le bucket de configuration |
| 4 — Observer | Manuel | Interroger Cloud Logging (y compris la ligne des options de montage GCSFuse) ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer la santé des révisions, `HOMEPAGE_ALLOWED_HOSTS` et les problèmes de propagation de la configuration |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket de configuration |
