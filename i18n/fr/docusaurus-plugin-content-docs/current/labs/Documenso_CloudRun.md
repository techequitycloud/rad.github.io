---
title: "Documenso sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Documenso sur Cloud Run dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Documenso_CloudRun.md @ 3055034 sha256:8954946c4143 -->

# Documenso sur Cloud Run — Guide de lab {#documenso-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Documenso_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Documenso est une alternative open source à DocuSign — une application Next.js + Prisma
pour envoyer, signer et gérer des documents à signature électronique. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Documenso on Cloud
Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Documenso. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Documenso_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier, et effectuer la configuration initiale du compte
  de Documenso.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Documenso (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Documenso_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`NEXTAUTH_SECRET`,
   `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, une
   paire de clés HMAC pour le transport facultatif des téléversements via S3, et le mot de passe de la base de données),
   un bucket Cloud Storage `uploads`, une instance Cloud Filestore (NFS), construit
   l'image de conteneur personnalisée et exécute un job unique d'initialisation de la base
   de données. Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   en représente l'essentiel).

3. Une fois l'opération terminée, découvrez les ressources avec des filtres indépendants des noms (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~documenso" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service répond. Documenso n'a pas de point de terminaison de santé dédié, donc
   la sonde de démarrage vérifie seulement que le conteneur écoute sur son port —
   vérifiez plutôt la disponibilité en interrogeant directement l'application :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL"   # expect 200 (or a redirect to /signin)
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Documenso ne provisionne **aucun compte administrateur
   initial** — la première personne qui termine l'inscription via l'interface web
   de l'application devient propriétaire du compte. Créez ce compte maintenant.

3. Définissez `webapp_url` sur l'URL Cloud Run (ou sur un domaine personnalisé une fois celui-ci
   enregistré) via **Update**. Tant qu'il n'est pas défini explicitement, le point d'entrée
   recalcule `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` à partir de la variable `CLOUDRUN_SERVICE_URL`
   injectée par la plateforme à chaque démarrage, ce qui convient pour un test rapide mais n'est pas
   stable d'un redéploiement à l'autre ni avec un domaine personnalisé.

4. **Certificat de signature.** Si aucun certificat n'est fourni, l'application génère au démarrage un
   `.p12` jetable auto-signé afin que la signature de documents fonctionne de bout en bout pour les tests —
   mais la signature n'est pas reconnue comme fiable par les lecteurs PDF. Pour tout usage au-delà de ce
   lab, fournissez un vrai certificat (voir la tâche 3, étape 5).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification du service, la mise à l'échelle est donc un changement de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de l'application suivante).
   Documenso utilise par défaut `min_instance_count = 0` (mise à l'échelle jusqu'à zéro, ce qui ajoute
   une latence de démarrage à froid à la première requête après une période d'inactivité) et
   `max_instance_count = 1`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite (à partir de
   `docker.io/documenso/documenso:${DOCUMENSO_VERSION}`) et une nouvelle révision
   est déployée. Les migrations Prisma s'exécutent automatiquement au démarrage du conteneur — il n'y a
   pas de job de migration distinct à exécuter.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~documenso"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Branchez un certificat de signature de production** (recommandé avant un usage réel) : définissez
   `secret_environment_variables` pour associer `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`
   (un `.p12` encodé en base64) et `NEXT_PRIVATE_SIGNING_PASSPHRASE` à des secrets dans
   Secret Manager, puis appliquez via **Update**. Ne régénérez jamais
   `NEXT_PRIVATE_ENCRYPTION_KEY` sur place par la suite — elle déchiffre les données déjà
   stockées dans Postgres ; effectuez la rotation uniquement via l'emplacement de la clé secondaire.

6. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~documenso" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. documensodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^documenso" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU / de la mémoire. Le `uptime_check_config` de Documenso est désactivé par
   défaut ; activez-le via **Update** si vous souhaitez un uptime check dans Monitoring → Uptime checks et
   la règle d'alerte associée.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Documenso.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage est en **TCP** sur le port 3000 (et non en HTTP), donc
  une révision « en bonne santé » peut tout de même renvoyer des erreurs 500 si Postgres n'est pas joignable —
  consultez les journaux de l'application, pas seulement l'état de la révision.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données existe et que le job `db-init` s'est terminé. Si
  `enable_cloudsql_volume` est laissé à la valeur par défaut propre à ce module (`false`), le
  point d'entrée ne reçoit pas de `DB_HOST` de type socket Unix et se rabat sur une connexion
  par IP directe — définissez `enable_cloudsql_volume = true` si l'application ne parvient pas à
  joindre la base de données.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment `enable_cloudsql_volume`
qui vaut `false` par défaut sur ce module, l'immuabilité de `db_name`/`db_user`
après le premier déploiement, et l'interdiction de faire tourner `NEXT_PRIVATE_ENCRYPTION_KEY` sur place).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, l'instance Filestore et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), des secrets, un bucket de téléversements, Filestore, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le service répond ; création du compte propriétaire initial dans l'interface ; prise en compte de la réserve sur le certificat auto-signé |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, brancher un certificat de signature de production, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'uptime check (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de `enable_cloudsql_volume`, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
