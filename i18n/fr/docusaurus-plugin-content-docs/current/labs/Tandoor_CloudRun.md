---
title: "Tandoor sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Tandoor sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Tandoor_CloudRun.md @ 3055034 sha256:2b044a1c32a9 -->

# Tandoor sur Cloud Run — Guide de lab {#tandoor-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tandoor_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Tandoor Recipes est un gestionnaire de recettes et planificateur de repas open source
et auto-hébergé, capable d'importer des recettes à partir d'une URL. Ce lab vous fait parcourir tout le
cycle de vie opérationnel du module **Tandoor on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Tandoor. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Tandoor_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, notamment en récupérant l'identifiant superutilisateur généré.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Tandoor (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Tandoor_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY`,
   `DJANGO_SUPERUSER_PASSWORD` et le mot de passe de la base), un bucket Cloud Storage
   `data`, et exécute deux jobs ponctuels : `db-init` (crée la base de données
   et l'utilisateur) et `create-superuser` (initialise le compte administrateur initial).
   Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   domine).

3. Une fois terminé, identifiez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~tandoor" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. Tandoor n'a pas de point de terminaison de santé
   dédié non authentifié ; les sondes de la plateforme (et cette vérification) ciblent donc la page
   de connexion publique de Django :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/accounts/login/"   # expect 200
   ```

2. Récupérez l'identifiant superutilisateur généré — Tandoor n'a **ni parcours
   d'auto-inscription ni identifiant par défaut fixe**, contrairement à certaines
   applications de ce catalogue :

   ```bash
   SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~tandoor-superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL/accounts/login/` dans un navigateur et connectez-vous avec le nom d'utilisateur
   `admin` (ou le `admin_username` que vous avez configuré) et le mot de passe récupéré
   ci-dessus. Envisagez de changer le mot de passe dès la première connexion, par
   bonne pratique de sécurité.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update**
   sur la page de détails du déploiement — le module possède la spécification du service, la
   mise à l'échelle est donc une modification de configuration et non une modification manuelle via `gcloud` (une modification
   manuelle serait annulée lors de la prochaine application). Tandoor n'a pas de worker
   d'arrière-plan ; une mise à l'échelle au-delà d'une instance ne nécessite donc aucune coordination particulière.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle révision est
   déployée. Tandoor publie un véritable tag `latest` en amont, ce qui reflète donc
   les vraies versions publiées en amont (contrairement à certaines applications de ce catalogue dont le
   tag de version est purement cosmétique).

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tandoor"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. tandoordemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tandoor" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
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
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de
   mise à l'échelle) et l'utilisation CPU / mémoire. Le module peut provisionner un
   **contrôle de disponibilité** (uptime check, lorsque `uptime_check_config.enabled = true` — il
   vaut `false` par défaut) ; s'il est activé, vérifiez qu'il est au vert sous Monitoring →
   Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Tandoor.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision
  et ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets
  ont été résolus. La sonde de démarrage cible `/accounts/login/` et requiert
  la connectivité à Postgres ainsi que des migrations appliquées pour renvoyer 200.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le job `db-init` s'est terminé
  avec succès.
- **Connexion impossible / aucun identifiant connu :** récupérez
  `DJANGO_SUPERUSER_PASSWORD` dans Secret Manager (tâche 2, étape 2) — il n'existe
  aucun identifiant fixe de repli.
- **Échec du job `create-superuser` :** listez les exécutions et lisez les journaux de celle
  qui a échoué — une cause fréquente est l'exécution du job avant la fin de `db-init`
  (il devrait figurer comme dépendance ; le job effectue jusqu'à deux nouvelles tentatives) :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-create-superuser" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build
  en échec (Tandoor est préconstruit ; cela ne s'applique donc que si `container_image_source`
  a été remplacé par `custom`).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`SECRET_KEY` après le premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Delete retire tout ce que le module
a créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément
et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets et le bucket de stockage, et exécute `db-init` + `create-superuser` |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; récupérer l'identifiant superutilisateur généré et se connecter |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer secrets/sauvegardes, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
