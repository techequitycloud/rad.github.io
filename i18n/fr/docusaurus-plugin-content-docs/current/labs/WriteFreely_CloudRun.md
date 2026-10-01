---
title: "WriteFreely sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez WriteFreely sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/WriteFreely_CloudRun.md @ 3055034 sha256:5bc97674d0c8 -->

# WriteFreely sur Cloud Run — Guide de lab {#writefreely-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/WriteFreely_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

WriteFreely est une plateforme de blog open source, minimaliste et fédérée, écrite en
Go — une alternative légère à Medium pour publier des textes épurés, sans
distraction. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module
**WriteFreely on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit WriteFreely. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/WriteFreely_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au blog en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **WriteFreely (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/WriteFreely_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager (trois clés AES-256 —
   `cookies-auth`, `cookies-enc`, `email-key` — plus le mot de passe de la base de données), un
   bucket Cloud Storage dédié `writefreely-uploads`, construit l'image de conteneur
   personnalisée de génération de configuration (config-gen) et exécute un job ponctuel d'initialisation de la base de données.
   Le premier déploiement prend environ **15 à 25 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~writefreely" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service fonctionne. WriteFreely n'a pas de point de terminaison `/health` dédié —
   la sonde de vivacité est un `GET /` HTTP qui attend un `200` de la page d'accueil :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur pour confirmer que la page d'accueil du blog s'affiche.
   Les inscriptions sont **fermées par défaut** (`open_registration = false`) et aucun
   compte administrateur n'est créé d'office ; créez donc le premier compte maintenant :

   - Définissez temporairement `WF_OPEN_REGISTRATION = "true"` dans `environment_variables`
     et appliquez via **Update**, inscrivez-vous depuis l'interface, puis remettez la valeur à
     `"false"` et appliquez de nouveau ; **ou**
   - Exécutez la commande intégrée de création d'administrateur de WriteFreely sur le
     conteneur en cours d'exécution (voir la tâche 3, étape 5, pour savoir comment obtenir l'équivalent d'un shell/`exec`
     via un job ponctuel, puisque Cloud Run ne permet pas d'`exec` persistant dans une
     révision en cours d'exécution).

3. **Ne faites pas de rotation des clés AES-256** (`cookies-auth`, `cookies-enc`,
   `email-key`) après ce premier démarrage — cela déconnecte tous les utilisateurs et rend
   indéchiffrables les adresses e-mail précédemment chiffrées.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur
   la page de détails du déploiement — le module gère la spécification du service, si bien que la mise à l'échelle
   est une modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait
   annulée au prochain apply). WriteFreely utilise par défaut `min_instance_count = 0`
   (mise à l'échelle jusqu'à zéro) et `max_instance_count = 1` ; définissez `min_instance_count = 1` si
   le délai occasionnel de démarrage à froid après une période d'inactivité n'est pas souhaitable.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle
   révision est déployée. En production, épinglez une version précise plutôt que de laisser
   `application_version = "latest"`, afin que les reconstructions restent reproductibles.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" \
     --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Ouvrez une session sur la base de données** pour l'inspecter ou en assurer la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. writefreelydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^writefreely" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^writefreely" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'Explorateur de journaux. Au premier démarrage, recherchez les
   lignes de progression du point d'entrée (`WriteFreely: rendered config.ini …`, `… seeded
   stable encryption keys …`, `… starting server …`) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation du CPU et de la mémoire. Le module provisionne aussi un
   **test de disponibilité** (uptime check, lorsque le point de terminaison est joignable publiquement) ; vérifiez qu'il est
   au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de WriteFreely.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont bien été résolus. La
  sonde de démarrage est TCP (Ready dès que le port 8080 est lié) ; la sonde de vivacité
  est un `GET /` HTTP.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base existe et que le job d'initialisation s'est terminé
  avec succès. Sur Cloud Run, WriteFreely se connecte en **TCP sur IP privée**
  (`enable_cloudsql_volume = false`), et non via un socket — ne confondez pas avec
  le sidecar Auth Proxy de la variante GKE.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec
  — `container_image_source` doit rester à `custom`, car le point d'entrée config-gen
  n'est présent dans aucune image amont préconstruite.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire de rotation des
clés AES-256 après le premier démarrage, et pourquoi `db_name`/`db_user` sont immuables après
le premier déploiement).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé — le
service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), 3 secrets de clés AES-256 et un bucket de stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La page d'accueil renvoie 200 ; créer le compte initial via une ouverture temporaire des inscriptions |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
