---
title: "Kimai sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Kimai sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Kimai_CloudRun.md @ 3055034 sha256:a721fb66d331 -->

# Kimai sur Cloud Run — Guide de lab {#kimai-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kimai_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Kimai est une application de suivi du temps gratuite et open source, utilisée par les
indépendants et les agences pour suivre les heures facturables, tenir des feuilles de
temps et produire des rapports qui alimentent la facturation. Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **Kimai on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Kimai. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kimai_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il
  provisionne.
- Accéder au service en cours d'exécution, le vérifier et vous connecter avec le
  compte administrateur créé à l'amorçage.
- Effectuer les opérations du jour 2 : inspecter, mettre à l'échelle, mettre à jour,
  gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s'il existe déjà dans
  le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et
  `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le
  projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Kimai (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kimai_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du
   déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (MySQL 8.0) avec ses secrets Secret Manager (`APP_SECRET`, `ADMINPASS` et le mot de
   passe de la base de données), le bucket Cloud Storage `storage`, construit l'image
   d'enveloppe personnalisée qui compose `DATABASE_URL`, et exécute la tâche
   d'initialisation `db-init` (qui crée la base de données, l'utilisateur et les
   droits). Un premier déploiement prend environ **15–25 minutes** (la création de
   Cloud SQL et le build de l'image en représentent l'essentiel).

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres
   indépendants des noms (pour que les commandes fonctionnent quel que soit le suffixe
   du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~kimai" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain — la page de connexion de Kimai renvoie **HTTP 200** :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/en/login"   # expect 200
   ```

2. Récupérez dans Secret Manager les identifiants de l'administrateur créé à
   l'amorçage — le nom d'utilisateur est toujours `admin` (codé en dur par l'image de
   l'éditeur), et le mot de passe est le secret `ADMINPASS` généré automatiquement :

   ```bash
   ADMINPASS_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec `admin` et le mot
   de passe récupéré ci-dessus.

4. Créez un projet, une activité et une entrée de feuille de temps de test pour
   confirmer l'écriture et la lecture de bout en bout sur la vraie base de données :
   **Administration → Projects** (créez-en un), **Administration → Activities**
   (créez-en une), puis enregistrez une entrée de feuille de temps associée depuis la
   vue principale des feuilles de temps. Rechargez la page — ou redéployez — et
   vérifiez que l'entrée est toujours présente.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en
   cliquant sur **Update** sur la page de détails du déploiement — le module gère la
   spécification du service ; la mise à l'échelle est donc une modification de
   configuration, et non une modification manuelle via `gcloud` (une modification
   manuelle serait annulée lors de l'application suivante).

3. **Mettez à jour la version de l'application** en modifiant `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est
   construite `FROM kimai/kimai2:<version>-apache` et une nouvelle révision est
   déployée. `kimai:install` se réexécute sans risque sur le schéma existant au premier
   démarrage du nouveau conteneur — aucune étape de migration manuelle n'est nécessaire.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~kimai"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. kimaidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^kimai" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Configurez un jeton d'API ou des utilisateurs supplémentaires.** Connecté avec le
   compte administrateur, allez dans **Profile → API access** pour générer un jeton
   d'API destiné aux intégrations de suivi du temps, ou dans **Administration → Users**
   pour inviter des collègues (l'inscription en libre-service est désactivée par
   défaut).

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, leur latence, le nombre d'instances (comportement de mise à
   l'échelle) ainsi que l'utilisation du CPU et de la mémoire. Le module peut
   provisionner un **test de disponibilité** (uptime check)
   (`uptime_check_config.enabled = true`) ; s'il est activé, vérifiez qu'il est au vert
   sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Kimai à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les
  variables d'environnement et les secrets ont été résolus. La sonde de démarrage
  (startup probe) cible `GET /en/login` avec un seuil généreux de 20 tentatives pour
  couvrir l'exécution de `kimai:install` au premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données au premier démarrage.** Vérifiez que la
  tâche `db-init` s'est terminée avec succès avant que le propre `kimai:install` de
  l'application (qui s'exécute à chaque démarrage du conteneur) n'ait eu l'occasion de
  s'exécuter :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
  Si le conteneur de l'application ne démarre pas en raison d'une erreur de base de
  données, vérifiez que `DB_IP` a été correctement résolu — il doit s'agir de l'adresse
  IP privée de l'instance Cloud SQL sur Cloud Run (ce module n'utilise pas le socket de
  l'Auth Proxy).
- **Hypothèse de port erronée.** Si vous comparez ce déploiement à une documentation ou
  à une autre installation de Kimai qui suppose le port 80, notez que la variante
  d'image `:apache` de ce module écoute sur le port **8001** — ce qui a été confirmé par
  des tests locaux et un déploiement réel. `container_port` doit indiquer `8001`.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le
  journal du build en échec — le build compile la fine image d'enveloppe
  `FROM kimai/kimai2`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.
- **Mot de passe administrateur oublié :** il n'est pas perdu — `ADMINPASS` est un
  secret Secret Manager persistant, réinjecté et réappliqué au compte `admin` à chaque
  démarrage du conteneur (de manière idempotente : récupérer à nouveau le secret et, si
  nécessaire, redémarrer le service donne toujours une connexion fonctionnelle) :
  ```bash
  gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
  ```

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a créé — le service
Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le
Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les secrets, le bucket de stockage, et exécute la tâche `db-init` |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé renvoie 200 sur `/en/login` ; connexion en tant que `admin` avec le secret `ADMINPASS` généré ; création d'une entrée de feuille de temps de test |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base, configurer l'API/les utilisateurs |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de port et de build |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
