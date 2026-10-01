---
title: "ToolJet sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez ToolJet sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/ToolJet_CloudRun.md @ 3055034 sha256:e834b4f0127c -->

# ToolJet sur Cloud Run — Guide de lab {#tooljet-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/ToolJet_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

ToolJet est une plateforme low-code open source permettant de créer et de
déployer des outils internes — tableaux de bord, panneaux d'administration et
applications CRUD — grâce à un éditeur par glisser-déposer qui s'appuie sur vos
propres bases de données et API. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **ToolJet on Cloud Run** sur Google Cloud : le déployer, y
accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités de ToolJet. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/ToolJet_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et terminer l'assistant de configuration initiale.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

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

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **ToolJet (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/ToolJet_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une instance Cloud SQL (PostgreSQL 15)
   avec **deux bases de données** (la base de métadonnées et la ToolJet Database) et
   leurs secrets Secret Manager (`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`,
   `PGRST_JWT_SECRET` et le mot de passe de la base de données), construit l'image de
   conteneur et exécute un job ponctuel d'initialisation de la base de données (qui crée
   les deux bases et le rôle applicatif `CREATEROLE`). Les premiers déploiements prennent
   environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois l'opération terminée, identifiez les ressources avec des filtres
   indépendants des noms (pour que les commandes continuent de fonctionner quel que
   soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~tooljet" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel et connecté à sa base de données. ToolJet
   expose un point de terminaison de santé public qui renvoie 200 une fois que le
   serveur a terminé ses migrations de démarrage et qu'il est à l'écoute :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/health"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, ToolJet
   présente un **assistant de configuration** — comme `DISABLE_SIGNUPS = "true"` est
   activé par défaut, c'est le seul moyen de créer le premier compte. Saisissez votre
   nom, votre adresse e-mail et un mot de passe pour créer l'**utilisateur administrateur
   et l'espace de travail** initiaux ; vous arrivez ensuite dans l'éditeur d'applications
   de ToolJet. Aucun identifiant administrateur pré-provisionné n'existe dans Secret Manager.

3. Depuis l'éditeur, créez une source de données (par exemple une connexion PostgreSQL ou
   REST) pour vérifier que le stockage des identifiants fonctionne — ToolJet la chiffre au
   repos avec la `LOCKBOX_MASTER_KEY`. La **ToolJet Database** intégrée (servie par le
   PostgREST du conteneur) est également disponible sous l'onglet *Database*.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est opérationnelle) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une
   modification de configuration et non une modification manuelle via `gcloud` (une
   modification manuelle serait annulée lors de la prochaine application). Conservez
   `min_instance_count = 1` et `cpu_always_allocated = true` afin que le worker en
   arrière-plan intégré au processus de ToolJet ne soit jamais réduit à zéro.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.
   Le point d'entrée réexécute `db:migrate:prod`, si bien que les modifications de schéma de la nouvelle version sont
   appliquées avant le basculement du trafic.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tooljet"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (notez les deux bases de données) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # The role and the metadata database are tenant-prefixed (e.g. tooljetdemo426161cf).
   # The second "ToolJet Database" is a literal name (ToolJet_Common's tooljet_db_name),
   # so it is excluded from the metadata-DB lookup below and used verbatim.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tooljet" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tooljet AND name!=tooljet_db" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database=tooljet_db --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Recherchez les lignes `[cloud-entrypoint]` qui confirment la configuration et
   l'exécution de `db:migrate:prod`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances
   (comportement de mise à l'échelle) et l'utilisation CPU / mémoire. Le module
   provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il
   est au vert sous Monitoring → Uptime checks et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de ToolJet.

- **Révision non opérationnelle / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les
  variables d'environnement et les secrets ont été résolus. La sonde de démarrage cible
  `/` par défaut (remplacez `startup_probe.path` par `/api/health` si vous le préférez)
  avec une large marge (30 × 15 s) pour absorber les migrations du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`relation "user_sessions" does not exist` (ou erreur similaire) :** les migrations ne
  se sont pas exécutées — recherchez l'étape `db:migrate:prod` dans les journaux et
  vérifiez qu'elle n'a pas échoué (le point d'entrée interrompt le démarrage en cas
  d'échec d'une migration).
- **`permission denied to create role` lors de la création d'un espace de travail :** il
  manque l'attribut `CREATEROLE` au rôle applicatif — relancez le job `db-init`.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base de données existe et que le job
  d'initialisation s'est terminé avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle
  qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du
  build en échec.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (dont la règle essentielle de ne jamais effectuer de rotation de
`LOCKBOX_MASTER_KEY` après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
les deux bases de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (deux bases PostgreSQL 15) et les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; terminer l'assistant de configuration pour créer l'administrateur et l'espace de travail, puis arriver dans l'éditeur d'applications |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/les sauvegardes, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de migration, de rôle, de base de données, de job d'initialisation et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
