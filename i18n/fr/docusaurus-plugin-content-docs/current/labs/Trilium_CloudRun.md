---
title: "Trilium sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Trilium sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Trilium_CloudRun.md @ 3055034 sha256:f8fede123086 -->

# Trilium sur Cloud Run — Guide de lab {#trilium-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Trilium Notes (le fork TriliumNext, activement maintenu) est une application de prise de notes
hiérarchique et auto-hébergée, dotée d'une base de données SQLite intégrée. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Trilium on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Trilium. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à l'application, vérifier son point de terminaison de santé et effectuer l'étape « Set Password » du premier lancement.
- Effectuer les opérations du jour 2 — inspecter le service, conserver une mise à l'échelle à instance unique et mettre à jour la version.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris le piège du chemin de la sonde de santé.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Trilium (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme construit une image d'encapsulation légère au-dessus de `triliumnext/notes` (via Cloud
   Build), provisionne un bucket de données Cloud Storage dédié monté sur
   `/home/node/trilium-data` et déploie un unique service Cloud Run (port 8080,
   1 vCPU / 1 GiB par défaut). Il n'y a **ni instance Cloud SQL ni Redis** —
   le stockage de documents de Trilium est entièrement une base de données SQLite intégrée sur le
   volume monté. Les premiers déploiements prennent généralement **5–10 minutes** (la construction de l'image en représente l'essentiel ;
   il n'y a aucune base de données à attendre).

3. Repérez le service déployé avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~trilium" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Trilium expose un point de terminaison de santé
   non authentifié — notez qu'il ne s'agit **pas** du chemin racine :

   ```bash
   curl -s "$SERVICE_URL/api/health-check"   # expect {"status":"ok"}
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 302 (redirect to setup)
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, Trilium affiche un écran
   **« Set Password »** — aucun identifiant administrateur prédéfini n'existe dans Secret Manager,
   contrairement aux applications dotées d'un mot de passe généré automatiquement. Choisissez un mot de passe robuste et
   terminez la configuration avant de partager l'URL avec qui que ce soit, en particulier si
   `ingress_settings = "all"` (la valeur par défaut, publique).

3. Vérifiez la persistance : créez une note, puis rechargez la page et confirmez qu'elle est toujours
   là — tout réside dans le bucket Cloud Storage monté :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~trilium"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne procédez pas à une mise à l'échelle horizontale.** Le module fixe délibérément
   `min_instance_count = max_instance_count = 1` : la base de données SQLite intégrée ne prend
   pas en charge plusieurs écrivains — une seconde instance risque de corrompre `document.db`.
   Les modifications de ressources (`cpu_limit`, `memory_limit`) passent par **Update** sur la
   page de détails du déploiement, et non par un `gcloud run services update` manuel (une modification
   manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.
   Trilium applique lui-même ses migrations de schéma au démarrage ; aucune étape de migration
   distincte n'est donc nécessaire.

4. **Il n'y a aucune session de base de données à ouvrir.** `database_type = "NONE"` — pas d'instance Cloud
   SQL, pas de job db-init, pas de mot de passe de base de données. Le seul état durable est
   le bucket de données.

5. **Sauvegardez les notes :**

   ```bash
   DATA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~trilium" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$DATA_BUCKET" "gs://<your-backup-bucket>/trilium-$(date +%F)"
   ```

   Trilium dispose également de sa propre fonctionnalité d'export/sauvegarde intégrée (Menu → Export) pour
   exporter une seule note ou l'arborescence entière au format `.zip`, indépendamment de la copie
   du bucket au niveau de l'infrastructure ci-dessus.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence et l'utilisation du CPU / de la mémoire. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsque `uptime_check_config.enabled = true` — la valeur par défaut est
   `false`) ciblant `/api/health-check` ; s'il est activé, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Trilium.

- **La révision ne devient jamais Ready :** vérifiez d'abord le chemin de la sonde. Si une sonde
  `startup_probe`/`liveness_probe` personnalisée a été définie sur `/` au lieu de la valeur par défaut
  `/api/health-check`, la redirection 302 qu'elle renvoie fait échouer la plupart des vérifications d'état HTTP.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **L'application démarre mais les notes disparaissent après un redémarrage :** vérifiez que le bucket de données est
  effectivement monté et que ses `mount_options` incluent `uid=1000,gid=1000` — un
  uid/gid incorrect amène gcsfuse à monter le répertoire avec root comme propriétaire, ce que
  Trilium (exécuté avec l'uid 1000) ne peut pas écrire, et l'application ne démarrerait alors pas
  du tout plutôt que de perdre silencieusement des données — ce symptôme indique donc plutôt un
  bucket mal configuré ou erroné dans `gcs_volumes`.
- **L'écran « Set Password » réapparaît à chaque visite :** cela signifie que la base de données SQLite
  elle-même n'est pas persistée — vérifiez que le montage du bucket a survécu à une mise à jour de
  révision (cherchez un fichier `document.db` avec `gcloud storage ls gs://<bucket>/`).
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec ;
  l'image est une encapsulation légère au-dessus de `triliumnext/notes`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution sur
  le bucket de données.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de terminer « Set Password » immédiatement pour
tout déploiement accessible publiquement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD
ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run, le
bucket de données Cloud Storage (toutes les notes et pièces jointes) et les images
Artifact Registry. Copiez d'abord les notes (tâche 3, étape 5) si vous souhaitez les conserver.
Les ressources appartenant à **Services_GCP** (le VPC, Artifact Registry) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne le service Cloud Run et le bucket de données (pas de base de données, pas de Redis) |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit sur `/api/health-check` ; effectuer l'étape « Set Password » du premier lancement ; vérifier la persistance des notes |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver une mise à l'échelle à instance unique, mettre à jour la version, sauvegarder les notes |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de chemin de sonde, de montage du stockage, de persistance et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket de données |
