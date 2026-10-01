---
title: "Tolgee sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Tolgee sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Tolgee_CloudRun.md @ 3055034 sha256:4ba14b43f56f -->

# Tolgee sur Cloud Run — Guide de lab {#tolgee-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tolgee_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Tolgee est une plateforme open source de localisation (i18n) et de gestion des
traductions, pensée pour les développeurs et construite sur Spring Boot. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Tolgee on Cloud
Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Tolgee. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tolgee_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris sa base de données migrée par Liquibase.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Tolgee (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Tolgee_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (PostgreSQL 15) avec ses secrets Secret Manager (le mot de passe administrateur
   initial généré automatiquement, le secret de signature JWT et le mot de passe de
   la base de données), ainsi qu'un bucket Cloud Storage pour le stockage de
   fichiers facultatif. Il n'y a aucun job distinct d'initialisation de la base de
   données à attendre au-delà de la création du rôle et de la base — Tolgee crée
   et migre l'intégralité de son schéma avec Liquibase au premier démarrage. Les
   premiers déploiements prennent environ **15–30 minutes** (la création de Cloud
   SQL en représente l'essentiel).

3. Une fois l'opération terminée, identifiez les ressources avec des filtres
   indépendants des noms (pour que les commandes continuent de fonctionner quel
   que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~tolgee" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel et que les migrations Liquibase sont
   terminées. Le point de terminaison de santé Spring Boot Actuator de Tolgee ne
   répond qu'une fois l'application entièrement démarrée et PostgreSQL joignable :

   ```bash
   curl -s "$SERVICE_URL/actuator/health"   # expect {"status":"UP",...}
   ```

   Prévoyez plusieurs minutes au premier démarrage — Spring Boot et les migrations
   Liquibase initiales démarrent plus lentement qu'une application Node classique.

2. Récupérez le mot de passe administrateur initial généré et connectez-vous :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee AND name~admin-password"
   gcloud secrets versions access latest \
     --secret="<admin-password-secret-name>" --project="$PROJECT"
   ```

   Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous en tant que
   propriétaire initial — `admin@techequity.cloud` par défaut
   (`TOLGEE_AUTHENTICATION_INITIAL_USERNAME`) — avec le mot de passe récupéré
   ci-dessus. Changez immédiatement le mot de passe et configurez les éventuels
   fournisseurs d'authentification supplémentaires (Google/OAuth2/SSO) depuis
   l'interface de Tolgee avant la mise en service, surtout si `ingress_settings`
   reste à `all`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est opérationnelle) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances puis en cliquant sur **Update** sur la page de détails du
   déploiement — le module possède la spécification du service, la mise à
   l'échelle est donc une modification de configuration et non une modification
   manuelle via `gcloud` (une modification manuelle serait annulée lors de la
   prochaine application). Conservez `min_instance_count = 1` et
   `cpu_always_allocated = true`, sauf si votre déploiement est purement
   interactif, sans traduction automatique en masse, import ni suppression en
   masse — ces jobs s'exécutent de façon asynchrone dans le processus après le
   retour de la requête et ont besoin de CPU allouée pour se terminer.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et une nouvelle révision est déployée. Tolgee
   applique ses changesets Liquibase à chaque démarrage, si bien que le schéma
   est mis à niveau automatiquement — fixez `application_version` sur une
   version éprouvée en production plutôt que de suivre `latest`.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee"
   ```

   Le secret de signature JWT (`TOLGEE_AUTHENTICATION_JWT_SECRET`) est immuable
   en pratique — n'effectuez sa rotation que lors d'une fenêtre de maintenance
   planifiée, car sa rotation invalide immédiatement toutes les sessions
   utilisateur actives.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. tolgeedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tolgee" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tolgee" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
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
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation CPU /
   mémoire. Le module provisionne également un **contrôle de disponibilité**
   (uptime check) sur `/actuator/health` (lorsque le service est joignable
   publiquement) ; vérifiez qu'il est au vert sous Monitoring → Uptime checks et
   consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Tolgee.

- **Révision non opérationnelle / le service ne répond pas :** inspectez la
  dernière révision et ses journaux à la recherche d'erreurs de démarrage. La
  sonde de démarrage cible `/actuator/health` avec une large fenêtre au premier
  démarrage (les migrations Liquibase s'exécutent sur une base de données vierge
  au premier démarrage).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE`. Le pilote JDBC de Tolgee ne peut pas utiliser de socket
  Unix Cloud SQL ; sur Cloud Run, il se connecte donc via l'**IP privée** de
  l'instance avec `sslmode=require` — vérifiez que `enable_cloudsql_volume` est
  toujours à `false` (la valeur par défaut du module) ; le passer à `true` fait
  pointer l'application vers un répertoire de socket que le pilote ne peut pas
  utiliser et rompt la connexion.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Rôle/schéma de base de données non créé :** il n'existe pas de job
  d'initialisation dédié à relancer — l'étape `create-db-and-user.sh` de la
  fondation crée le rôle et la base de données, puis les migrations Liquibase de
  Tolgee construisent le schéma au démarrage. Listez le job de configuration et
  ses exécutions si la base de données semble vide :
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~tolgee"
  gcloud run jobs executions list --job=<job-name> --project="$PROJECT" --region="$REGION"
  ```
- **Utilisateurs déconnectés de façon inattendue :** vérifiez si
  `TOLGEE_AUTHENTICATION_JWT_SECRET` a fait l'objet d'une rotation — sa rotation
  après le premier démarrage invalide toutes les sessions actives.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le
  journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (dont le plancher de mémoire nécessaire aux
migrations Liquibase et la raison pour laquelle `enable_cloudsql_volume` doit
rester à `false` sur Cloud Run).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et le bucket Cloud Storage.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets et un bucket de stockage ; Tolgee se migre lui-même via Liquibase |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; se connecter avec l'identifiant administrateur initial généré et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de connectivité à la base de données, de job de configuration, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
