---
title: "GlitchTip sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez GlitchTip sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/GlitchTip_CloudRun.md @ 3055034 sha256:fa4da6bdfec6 -->

# GlitchTip sur Cloud Run — Guide de lab {#glitchtip-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/GlitchTip_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

GlitchTip est une plateforme open source de suivi des erreurs et de surveillance des performances,
compatible avec Sentry. Vos applications envoient les exceptions et les traces à son point de
collecte, et GlitchTip les stocke, les regroupe et émet des alertes à leur sujet. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **GlitchTip sur Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis le
supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit GlitchTip. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/GlitchTip_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder au service en cours d’exécution, le vérifier et vous connecter en tant qu’administrateur créé d’office.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **GlitchTip (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/GlitchTip_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec
   les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY`, le mot de passe initial du superutilisateur et le
   mot de passe de la base), un bucket de données Cloud Storage et un stockage NFS pour les pièces jointes, construit
   l’image de conteneur personnalisée légère (`FROM glitchtip/glitchtip:6.2.0`), et exécute deux jobs
   ponctuels — `db-init` (base de données/utilisateur) puis `glitchtip-migrate` (migrations Django + création du
   superutilisateur). Un premier déploiement prend environ **20 à 35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois le déploiement terminé, repérez les ressources à l’aide de filtres indépendants du nom (afin que les commandes
   continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~glitchtip" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. GlitchTip expose un point de contrôle de santé sans
   authentification qui renvoie 200 dès que le serveur est démarré et que PostgreSQL est joignable :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/_health/"   # expect 200
   ```

2. Récupérez le mot de passe de l’administrateur créé d’office (le job `glitchtip-migrate` a créé
   `admin@techequity.cloud` à partir de ce secret) :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous en tant que `admin@techequity.cloud` avec ce
   mot de passe. Créez votre première organisation et votre premier projet, puis copiez le DSN du projet pour
   faire pointer le SDK Sentry d’une application vers GlitchTip. L’inscription libre est désactivée par
   défaut ; laissez `enable_open_user_registration = false` sauf si vous souhaitez une inscription
   ouverte.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter le service et ses révisions** (chaque déploiement crée une révision immuable ;
   le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update** — le module
   est propriétaire de la spécification du service, la mise à l’échelle est donc une modification de configuration, et non une modification manuelle via `gcloud`
   (une modification manuelle serait annulée à l’application suivante). Conservez `min_instance_count ≥ 1` :
   le worker et le beat Celery s’exécutent dans le même processus (`SERVER_ROLE = all_in_one`), donc une mise à l’échelle à
   zéro arrêterait le traitement des événements en arrière-plan.

3. **Mettre à jour la version de l’application** en modifiant le paramètre de version dans la plateforme RAD
   et en l’appliquant via **Update** ; une nouvelle image est construite, les migrations s’exécutent au démarrage et une nouvelle
   révision est déployée.

4. **Gérer les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~glitchtip"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. glitchtipdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^glitchtip" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^glitchtip" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l’explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de mise à l’échelle) et l’utilisation du processeur et de la
   mémoire. Le module provisionne aussi un **test de disponibilité** (uptime check) ; vérifiez qu’il est au vert dans
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GlitchTip.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses journaux
  pour repérer des erreurs de démarrage, et vérifiez que les variables d’environnement et les secrets ont été résolus. La sonde de démarrage cible
  `/` (le chemin `startup_probe` par défaut du module) et accorde plusieurs minutes au premier démarrage
  pendant l’exécution des migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`, que le secret du
  mot de passe de la base existe et que le job `db-init` s’est terminé. Le point d’entrée compose
  `DATABASE_URL` à partir des variables `DB_*` injectées — sur Cloud Run, il s’agit de la forme socket
  Cloud SQL.
- **Le job de migration / de superutilisateur a échoué :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-glitchtip-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Tableau de bord vide / connexion impossible :** vérifiez que `glitchtip-migrate` a exécuté `createsuperuser` ;
  l’administrateur est `admin@techequity.cloud`, avec le mot de passe de superutilisateur stocké dans Secret Manager.
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment conserver `min_instance_count ≥ 1` et ne jamais renommer `db_name`/`db_user`).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est
conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le
gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les
ressources cloud. La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), des secrets, du stockage, et exécute `db-init` + `glitchtip-migrate` |
| 2 — Accéder et vérifier | Manuel | `/_health/` renvoie 200 ; connexion en tant que `admin@techequity.cloud`, créé d’office |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle, mettre à jour la version, gérer secrets/sauvegardes, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job de migration, de build et d’IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
