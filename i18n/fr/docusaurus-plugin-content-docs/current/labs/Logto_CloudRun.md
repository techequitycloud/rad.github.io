---
title: "Logto sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Logto sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Logto_CloudRun.md @ 3055034 sha256:fb9773a85d92 -->

# Logto sur Cloud Run — Guide de lab {#logto-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Logto_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Logto est un fournisseur d'identité open source — une alternative à Auth0 qui prend en charge OIDC
et OAuth 2.0, avec des flux de connexion, des connecteurs sociaux et d'entreprise, le multi-tenant et
une console d'administration. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Logto on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Logto. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Logto_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris atteindre la console d'administration pour
  la configuration initiale.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Logto (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Logto_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec son secret Secret Manager (le mot de passe de la base de données — Logto n'a pas de
   secret applicatif externe ; ses clés de signature OIDC sont générées dans la
   base de données au premier démarrage), un bucket Cloud Storage, construit l'image du conteneur et
   exécute un job ponctuel d'initialisation de la base de données qui crée le rôle applicatif
   (avec `CREATEROLE`) et la base de données. Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL domine).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~logto" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain et connecté à sa base de données. Logto expose un
   point de terminaison d'état non authentifié qui ne répond qu'une fois le cœur démarré et
   son schéma initialisé :

   ```bash
   curl -s "$SERVICE_URL/api/status"   # expect HTTP 200
   ```

2. **La console d'administration n'est pas accessible sur `$SERVICE_URL`.** Cloud Run publie un
   seul port de conteneur (3001, le cœur de Logto / OIDC), tandis que la console d'administration —
   où vous créez le premier administrateur et enregistrez les applications OIDC — s'exécute
   sur le port 3002. Pour effectuer la configuration initiale, vous devez placer devant Logto un proxy
   qui route vers 3002, ou déployer temporairement une seconde révision ou un second service Cloud Run
   avec `container_port = 3002` pointant vers la même image et la même base de données. Prévoyez cette
   route **avant** d'en avoir besoin ; il n'existe pas d'équivalent à `kubectl port-forward` sur
   Cloud Run.

3. Une fois la console d'administration accessible, créez le premier compte administrateur et
   enregistrez votre première application OIDC. Notez que l'URI de redirection enregistrée doit utiliser
   le même hôte que `ENDPOINT` (voir la tâche 5) — une discordance casse chaque rappel OAuth.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module détient la spécification du service, la mise à l'échelle est donc une
   modification de configuration et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). `min_instance_count` vaut `1` par défaut pour éviter
   la latence de démarrage à froid sur les requêtes OIDC ; `0` est sans risque pour les données (tout l'état est dans Postgres)
   si vous préférez accepter des démarrages à froid en échange d'un coût moindre.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. En production, figez `application_version` sur une version précise (par ex. `1.33`)
   plutôt que de suivre `latest`.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~logto"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. logtodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^logto" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^logto" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

   N'effacez ni ne réinitialisez jamais cette base de données en dehors d'une restauration volontaire — les clés
   de signature OIDC de Logto n'existent que dans celle-ci, et l'effacer invalide chaque jeton émis
   et chaque client enregistré.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Le point d'entrée affiche une
   ligne `[cloud-entrypoint]` indiquant le mode de connexion à la base de données résolu et
   `ENDPOINT`, c'est la première chose à vérifier pour diagnostiquer un problème de connexion ou
   d'URL d'émetteur :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Un **test de disponibilité** est désactivé par défaut
   (`uptime_check_config.enabled = false`) ; activez-le avec
   `path = "/api/status"` pour la surveillance en production, puis confirmez qu'il est au vert
   sous Monitoring → Uptime checks et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Logto.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour détecter des erreurs de démarrage, et confirmez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage cible `/api/status` et accorde une large fenêtre au premier démarrage (délai initial de 60 s
  + 30 tentatives) pour l'étape d'initialisation du schéma et des clés OIDC.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs OIDC / de rappel de connexion :** confirmez que `ENDPOINT` correspond exactement à l'hôte que
  le navigateur a utilisé pour atteindre Logto — Logto construit son émetteur OIDC et chaque URL de
  redirection absolue à partir de cette valeur.
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE` et
  que le secret du mot de passe de la base existe. Rappelez-vous que le pilote `slonik` de Logto ne sait pas analyser le
  DSN de socket Unix de Cloud SQL — le point d'entrée se connecte plutôt via l'**IP
  privée** injectée (`DB_IP`) avec `sslmode=no-verify`, même si
  `enable_cloudsql_volume` injecte toujours le sidecar Auth Proxy par souci de cohérence.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Console d'administration inaccessible :** c'est attendu sur le `$SERVICE_URL` par défaut —
  voir la tâche 2. La console d'administration (3002) n'est jamais publiée sur le service principal.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de ne jamais effacer la base de données Cloud SQL, puisque
la seule copie des clés de signature OIDC de Logto s'y trouve).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL (et avec elle la seule copie des clés de signature OIDC de Logto),
le secret Secret Manager, le bucket GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), un secret pour le mot de passe de la base, un bucket de stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; accès à la console d'administration par une route distincte pour créer le premier administrateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'OIDC/de rappel, de base de données, de job d'initialisation et d'accès à la console d'administration |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
