---
title: "Wallabag sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Wallabag sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Wallabag_CloudRun.md @ 3055034 sha256:10b8a686876d -->

# Wallabag sur Cloud Run — Guide de lab {#wallabag-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallabag_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Wallabag est une application open source et auto-hébergée d'archivage d'articles « à lire plus tard » —
enregistrez des articles depuis une extension de navigateur, un bookmarklet, une application mobile ou l'API REST,
et lisez-les plus tard dans une vue épurée, sans distraction, avec recherche plein texte et
étiquetage. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module
**Wallabag on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Wallabag. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallabag_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et vous connecter avec le compte administrateur par défaut.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Wallabag (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallabag_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager (`APP_SECRET` et le mot de passe de la base de données), un
   bucket Cloud Storage générique, construit l'image de conteneur personnalisée et exécute la
   chaîne d'initialisation en deux étapes : `db-init` (crée la base de données, l'utilisateur et les droits)
   suivie de `wallabag-install` (l'installateur propre à Wallabag, qui crée le
   schéma et initialise le compte administrateur par défaut en une seule étape). Les premiers déploiements
   prennent environ **15–25 minutes** (la création de Cloud SQL et la construction de l'image
   en représentent l'essentiel).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~wallabag" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Wallabag redirige une requête non authentifiée
   sur le chemin racine vers sa page de connexion — attendez-vous à un **HTTP 302**, et non 200 :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Connectez-vous avec les identifiants administrateur par défaut
   documentés de Wallabag — **nom d'utilisateur `wallabag`, mot de passe `wallabag`** —
   créés par le job d'initialisation `wallabag-install`. **Changez ce mot de passe
   immédiatement** (menu en haut à droite → votre compte → changer le mot de passe). L'inscription
   en libre-service est désactivée par défaut ; c'est donc le seul compte tant que vous n'en créez pas
   d'autres depuis l'interface d'administration.

3. Enregistrez un article de test pour confirmer l'écriture et la lecture de bout en bout sur la vraie
   base de données : collez l'URL d'un article quelconque dans la zone « Save a new entry » et vérifiez
   qu'il apparaît dans votre liste avec son titre et son contenu récupérés. Rechargez la page
   (ou, mieux, redéployez — voir la tâche 3) et vérifiez que l'article enregistré est toujours
   là — c'est le signe le plus sûr que l'application écrit réellement dans Cloud SQL et
   non dans un fichier local jetable (voir la section Dépannage pour comprendre pourquoi cette
   distinction est importante).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service, la mise à l'échelle est donc
   une modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait
   annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite `FROM
   wallabag/wallabag:<version>` et une nouvelle révision est déployée. `wallabag-install`
   se réexécute sans risque sur le schéma existant (il est idempotent) — aucune étape de migration
   manuelle n'est nécessaire.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~wallabag"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. wallabagdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^wallabag" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Configurez l'extension de navigateur, l'application mobile ou l'accès à l'API.** Une fois connecté avec le
   compte administrateur, allez dans les paramètres de votre compte pour afficher les identifiants de votre client
   API, ou générez un nouveau client API sous Developer → My applications.
   Utilisez `$SERVICE_URL` comme adresse du serveur lors de la configuration de l'extension officielle
   Firefox/Chrome ou d'un client mobile (wallabag Android/iOS, ou tout client
   compatible Pocket prenant en charge un serveur personnalisé).

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes, le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU /
   de la mémoire. Le module peut provisionner un **test de disponibilité** (uptime check) ; s'il est activé,
   vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting →
   Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Wallabag.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et
  ses journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La
  sonde de démarrage est une sonde TCP sur le port 80 (elle n'exige que la liaison de nginx) ; une réponse 302 au
  `GET /` de la sonde de vivacité est attendue et saine.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les articles disparaissent après un redéploiement — le point n° 1 à vérifier sur ce module.**
  C'est le symptôme caractéristique d'un Wallabag qui s'installe silencieusement sur un
  fichier SQLite local au lieu de MySQL : l'application démarre, les vérifications d'état réussissent,
  les articles s'enregistrent et semblent fonctionner, mais tout disparaît au prochain
  redémarrage du conteneur. Cela se produit si `SYMFONY__ENV__DATABASE_DRIVER` est un jour
  supprimé ou remplacé — il doit valoir explicitement `pdo_mysql` (le
  `entrypoint.sh` fourni le définit ; n'ajoutez pas de `SYMFONY__ENV__DATABASE_DRIVER` contradictoire
  via `environment_variables`). Consultez la section *Configuration
  Pitfalls* du Guide de configuration pour l'explication complète — cette défaillance ne produit aucun
  message d'erreur, seulement des données disparues.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base existe et que le job `db-init` s'est terminé avec succès
  avant l'exécution de `wallabag-install`.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-wallabag-install" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.
- **Impossible de se connecter avec `wallabag` / `wallabag` :** si le mot de passe a déjà été
  modifié par un opérateur précédent, utilisez `gcloud sql connect` (tâche 3) ou les
  journaux du job d'installation pour confirmer que `wallabag-install` s'est bien exécuté ; un
  nouveau déploiement crée toujours les identifiants par défaut lors de la première installation réussie.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre — en particulier la règle essentielle sur `SYMFONY__ENV__DATABASE_DRIVER`
ci-dessus.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les secrets, le bucket de stockage, et exécute la chaîne d'initialisation `db-init` → `wallabag-install` |
| 2 — Accéder et vérifier | Manuel | La vérification d'état renvoie 302 vers `/login` ; se connecter avec les identifiants par défaut `wallabag`/`wallabag` ; enregistrer un article de test |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base, configurer l'extension/l'API |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation et de build — y compris le symptôme du basculement silencieux vers SQLite |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
