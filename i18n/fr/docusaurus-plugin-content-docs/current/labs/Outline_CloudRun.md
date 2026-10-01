---
title: "Outline sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Outline sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Outline_CloudRun.md @ 3055034 sha256:3985293f6d8a -->

# Outline sur Cloud Run — Guide de lab {#outline-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Outline_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Outline est une base de connaissances et un wiki d'équipe rapides et collaboratifs, de style Notion, avec édition en temps réel et une recherche puissante. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Outline on Cloud Run** sur Google Cloud : le déployer, raccorder le fournisseur d'authentification requis, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Outline. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Outline_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vérifier le service en cours d'exécution et configurer le fournisseur d'authentification OIDC **requis**.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Outline (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Outline_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (le mot de passe de la base ainsi que les `SECRET_KEY` et
   `UTILS_SECRET` d'Outline), un partage NFS Filestore pour les fichiers téléversés, un bucket GCS
   `storage` dédié, construit l'image de conteneur personnalisée via Cloud Build et exécute une tâche ponctuelle
   d'initialisation de la base de données. Les premiers déploiements prennent environ **20–35 minutes**
   (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~outline" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le chemin de santé d'Outline est `/`, qui répond une fois
   que le point d'entrée s'est connecté à PostgreSQL, a exécuté les migrations Sequelize et s'est
   connecté à Redis (prévoyez plus de 60 secondes lors d'un nouveau déploiement / d'un démarrage à froid) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. **Attendez-vous à une page de connexion vide** — c'est le
   point le plus important du premier démarrage de ce module, et non un échec : les variables `OIDC_*` sont livrées
   volontairement vides, et sans fournisseur d'identité configuré, Outline n'enregistre **aucun**
   fournisseur d'authentification. Le service est en bonne santé ; la connexion nécessite l'étape suivante.

3. **Configurez le fournisseur OIDC requis.** Créez un client OAuth auprès de votre fournisseur d'identité (IdP)
   (par exemple Google : APIs & Services → Credentials) avec
   `$SERVICE_URL/auth/oidc.callback` comme URI de redirection autorisée — le callback
   doit se trouver sur le **même hôte** que l'`URL` injectée. Raccordez ensuite les points de terminaison :

   ```bash
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --update-env-vars="OIDC_AUTH_URI=https://accounts.google.com/o/oauth2/v2/auth,OIDC_TOKEN_URI=https://oauth2.googleapis.com/token,OIDC_USERINFO_URI=https://openidconnect.googleapis.com/v1/userinfo,OIDC_USERNAME_CLAIM=email"
   ```

   Liez les identifiants du client sous forme de secrets. **Piège :** `OIDC_CLIENT_ID` et
   `OIDC_CLIENT_SECRET` existent en tant que *variables d'environnement simples et vides* ; gcloud refuse donc une conversion
   directe en secret (« already set with a different type ») — supprimez-les d'abord, puis liez-les :

   ```bash
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --remove-env-vars=OIDC_CLIENT_ID,OIDC_CLIENT_SECRET
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --update-secrets="OIDC_CLIENT_ID=<client-id-secret>:latest,OIDC_CLIENT_SECRET=<client-secret-secret>:latest"
   ```

   Rechargez la page de connexion — le bouton de votre fournisseur apparaît ; le premier utilisateur à se connecter
   crée l'espace de travail. Le secret du mot de passe de la base peut être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~outline" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). La
   valeur par défaut est la mise à l'échelle jusqu'à zéro (`min = 0`, `max = 1`) ; définissez `min = 1` si les démarrages à froid
   gênent vos rédacteurs.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; Cloud Build reconstruit l'image personnalisée et une nouvelle révision est déployée — le point d'entrée exécute au démarrage les éventuelles migrations Sequelize en attente.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~outline"   # DB password, SECRET_KEY, UTILS_SECRET
   gcloud run jobs list --project="$PROJECT" --region="$REGION"       # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~outline"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. outlinedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^outline" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Au démarrage, recherchez `Assembled DATABASE_URL`, `Database is ready.` et la sortie
   des migrations Sequelize.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU / de la mémoire. Un **test de disponibilité** (uptime check) peut être activé via
   `uptime_check_config` (désactivé par défaut) ; lorsqu'il est actif, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Outline.

- **Révision en mauvaise santé / le service ne répond pas :** la sonde de démarrage accorde 60 secondes
  plus six nouvelles tentatives au point d'entrée pour attendre PostgreSQL et exécuter les migrations.
  Inspectez la dernière révision et ses journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Page de connexion vide (le cas propre à l'application) :** il ne s'agit *pas* d'un échec de déploiement —
  les espaces réservés `OIDC_*` restent vides tant que vous n'avez pas configuré d'IdP (tâche 2). Si un
  fournisseur est configuré mais que la connexion boucle ou échoue, vérifiez que l'URI de redirection est
  `<URL>/auth/oidc.callback` sur l'hôte exact de l'`URL` injectée :
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" \
    --format="json(spec.template.spec.containers[0].env)" | grep -A1 '"URL"'
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que la tâche `db-init` s'est terminée
  avec succès. La connexion utilise le socket Auth Proxy — `enable_cloudsql_volume`
  doit rester à `true`.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs Redis / boucle de reconnexion dans les journaux :** Outline nécessite Redis. Vérifiez que
  `enable_redis = true` et que l'hôte NFS partagé (qui héberge aussi Redis) est en cours
  d'exécution, ou que `redis_host` pointe vers un point de terminaison joignable.
- **Montage NFS / fichiers téléversés non persistants :** vérifiez que `enable_nfs = true`, que l'environnement
  d'exécution est `gen2` et que `nfs_mount_path` vaut `/var/lib/outline/data`.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
  Il s'agit d'un module à build personnalisé — l'image amont ne comporte pas le point d'entrée qui
  assemble `DATABASE_URL`/`REDIS_URL`/`URL` et exécute les migrations.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager (mot de passe de la base, `SECRET_KEY`, `UTILS_SECRET`),
les buckets GCS (y compris le bucket `storage`), le partage NFS Filestore et les images Artifact
Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), NFS, le bucket GCS, les secrets, construit l'image et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | La vérification d'état réussit ; configurer le fournisseur OIDC requis et effectuer la première connexion |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'OIDC, de base de données, de tâche d'initialisation, de Redis, de NFS, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
