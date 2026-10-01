---
title: "LubeLogger sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez LubeLogger sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/LubeLogger_CloudRun.md @ 3055034 sha256:55d8fdf8913f -->

# LubeLogger sur Cloud Run — Guide de lab {#lubelogger-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LubeLogger_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

LubeLogger est un outil gratuit et open source de suivi de l'entretien des véhicules et de la consommation de carburant
(ASP.NET Core, base de données LiteDB embarquée). Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **LubeLogger on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit LubeLogger. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LubeLogger_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le flux d'inscription en libre-service
  au premier démarrage.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle (en comprenant pourquoi le service est figé à une
  instance), mettre à jour et gérer le stockage.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **LubeLogger (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LubeLogger_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (sans Cloud SQL — le mode par défaut de LubeLogger
   utilise un fichier de base de données LiteDB embarqué), deux buckets Cloud Storage
   (`storage` pour les données de l'application, `dpkeys` pour les clés ASP.NET Core Data Protection), et
   met en miroir l'image officielle préconstruite dans Artifact Registry. Il n'y a pas d'étape de build
   ni de job d'initialisation de la base de données, les premiers déploiements sont donc rapides — généralement
   **5 à 10 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~lubelogger" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. LubeLogger expose sa page publique et non authentifiée
   `/Login` — le même chemin que celui utilisé par les sondes de santé de la plateforme :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/Login"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL/Login` dans un navigateur. Il n'y a **aucun identifiant administrateur
   préconfiguré** — cliquez sur **Register** et créez le premier compte (nom, adresse e-mail,
   mot de passe). Comme `EnableAuth = "true"` est activé par défaut, c'est le SEUL moyen
   d'obtenir l'accès ; la racine de l'application `/` redirige les visiteurs non authentifiés vers `/Login`.
   Effectuez cette étape immédiatement après le déploiement, car le formulaire Register lui-même est
   accessible à toute personne disposant de l'URL tant qu'aucun premier compte n'existe.

3. Une fois connecté, ajoutez un véhicule et un enregistrement d'entretien ou de carburant pour confirmer que le chemin
   d'écriture de la base de données (LiteDB embarquée, persistée sur le volume GCS `storage`)
   fonctionne. Actualisez la page et confirmez que l'enregistrement est toujours présent.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **La mise à l'échelle est volontairement figée à une instance.** `min_instance_count = 1` et
   `max_instance_count = 1` sont imposés par une validation au moment du plan —
   le mode par défaut de LubeLogger sert un unique fichier de base de données embarqué partagé depuis un seul
   volume, si bien qu'exécuter plusieurs réplicas risque de le corrompre. Il n'existe aucun moyen pris en charge
   de mettre ce module à l'échelle horizontalement dans sa configuration par défaut (LiteDB embarquée).

3. **Mettez à jour l'étiquette de version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update** ; comme l'image est préconstruite (et non
   construite sur mesure), cela sélectionne directement l'étiquette de version
   `ghcr.io/hargata/lubelogger` correspondante et une nouvelle révision est déployée.

4. **Inspectez le stockage :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~lubelogger"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99) et l'utilisation du CPU et de la mémoire (attendez-vous à une
   instance unique stable, sans activité de mise à l'échelle). Le module peut provisionner un **test de
   disponibilité** (lorsque `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il
   est activé, confirmez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LubeLogger.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour détecter des erreurs de démarrage. La sonde de démarrage cible `/Login` et devrait réussir dans
  les secondes qui suivent le démarrage du conteneur — un échec persistant signifie généralement que le
  conteneur n'écoute pas sur le port 8080, et non une lente migration au premier démarrage (il n'y en a
  pas).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les données ne persistent pas entre les révisions ou les redémarrages :** confirmez que le volume GCS `storage`
  est bien monté sur `/App/data` — vérifiez les montages de volumes de la révision dans
  `gcloud run revisions describe`.
- **Déconnexion inattendue après un redéploiement :** confirmez que le bucket `dpkeys` existe
  et qu'il est monté sur `/root/.aspnet/DataProtection-Keys` — s'il a déjà été
  supprimé puis recréé, toutes les sessions existantes sont invalidées (sans gravité, il suffit de
  se reconnecter).
- **`/` renvoie une redirection/401 au lieu de l'application :** comportement attendu lorsque
  `EnableAuth = "true"` et que vous n'êtes pas connecté — la racine de l'application est protégée par
  `[Authorize]`. Accédez directement à `/Login`.
- **Échec du build de l'image :** consultez l'historique Cloud Build — le module met en miroir
  l'image officielle ; un échec à ce niveau indique généralement une limite de débit de GHCR ou un problème
  réseau transitoire, et non un bogue de l'application.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de conserver `max_instance_count = 1`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run et les deux buckets Cloud Storage (**tous les enregistrements de véhicules et les documents téléversés sont perdus**). Les ressources appartenant à **Services_GCP** (le VPC, Artifact Registry) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, deux buckets Cloud Storage, et met en miroir l'image préconstruite (ni base de données, ni étape de build) |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; inscription du premier compte et confirmation qu'un enregistrement persiste |
| 3 — Exploiter | Manuel | Inspecter les révisions, comprendre la contrainte d'instance unique figée, mettre à jour la version, inspecter le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de stockage/persistance, de session et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris toutes les données |
