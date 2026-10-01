---
title: "Payload CMS sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Payload CMS sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Payload_CloudRun.md @ 3055034 sha256:a5ca8b3eebad -->

# Payload CMS sur Cloud Run — Guide de lab {#payload-cms-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Payload_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Payload CMS est un CMS headless et un framework applicatif natif TypeScript, orienté code, construit
directement sur Next.js. Contrairement à la plupart des modules de ce catalogue, il n'existe **aucune image Docker
officielle de Payload** — ce module construit à partir des sources une véritable application de démarrage vérifiée localement (un
modèle `create-payload-app` vierge utilisant l'adaptateur PostgreSQL). Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Payload on Cloud Run** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités de modélisation de contenu propres à Payload. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Payload_CloudRun) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris en créant le premier compte administrateur Payload.
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
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Payload (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Payload_CloudRun) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15) avec ses
   secrets Secret Manager (`PAYLOAD_SECRET` et le mot de passe de la base de données), **construit l'application
   Payload à partir des sources via Cloud Build** (il n'existe aucune image préconstruite à récupérer), et exécute deux
   jobs séquentiels : `db-init` (crée le rôle et la base de données) puis
   `payload-migrate` (applique le schéma Payload — ce job nécessite l'intégralité des sources de l'application et de
   l'arborescence des dépendances, et pas seulement l'environnement d'exécution allégé qui sert le trafic). Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL et le build Cloud Build à partir des sources en représentent l'essentiel).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les commandes continuent
   de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~payload" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. La route de l'interface d'administration de Payload répond sans authentification une fois que le
   serveur Node.js a démarré :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/admin"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL/admin` dans un navigateur. Payload ne dispose **d'aucune commande CLI permettant de créer le premier utilisateur
   administrateur de manière non interactive** — lorsque la collection `users` est vide, Payload affiche automatiquement un
   formulaire d'inscription. Saisissez votre adresse e-mail et un mot de passe, puis validez pour créer le premier administrateur ;
   vous êtes alors connecté au tableau de bord d'administration. Il s'agit d'une étape manuelle obligatoire et unique — il n'existe
   aucun identifiant administrateur pré-provisionné dans Secret Manager.

3. Vérifiez que les API REST et GraphQL sont bien raccordées (toutes deux exigent l'authentification que vous venez de créer) :
   ```bash
   curl -s "$SERVICE_URL/api/users" -o /dev/null -w '%{http_code}\n'   # 401/403 without auth — expected
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ; le trafic
   bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails
   du déploiement — le module est propriétaire de la spécification du service ; la mise à l'échelle est donc un changement de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans la plateforme RAD et
   en l'appliquant via **Update** ; une nouvelle exécution Cloud Build reconstruit à partir des sources l'application de démarrage Payload intégrée
   et déploie une nouvelle révision (il n'existe aucun tag d'image amont à incrémenter — la mise à jour reconstruit
   toujours).

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~payload"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + payload-migrate + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. payloaddemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^payload" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU et de la
   mémoire. Le module peut provisionner un **test de disponibilité** (uptime check) (lorsque `uptime_check_config.enabled =
   true` — la valeur par défaut est `false`) ; s'il est activé, vérifiez qu'il est au vert sous Monitoring → Uptime
   checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de Payload.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses journaux pour repérer des
  erreurs de démarrage. La sonde de démarrage cible `/admin` et accorde environ 12 minutes au premier démarrage
  pour que le job `payload-migrate` se termine.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les requêtes en base échouent / « relation does not exist » :** le schéma n'a jamais été appliqué. Vérifiez que
  `payload-migrate` s'est terminée avec succès (elle dépend de la fin préalable de `db-init`) :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-payload-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et que le secret du
  mot de passe de la base existe.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec — rappelez-vous que ce
  module construit toujours à partir des sources ; un Dockerfile défectueux ou un changement de dépendance se manifeste donc ici,
  et non sous la forme d'une erreur de récupération d'image.
  ```bash
  gcloud builds list --project="$PROJECT" --limit=10
  ```
- **Premier compte administrateur absent / impossible de se connecter :** le premier administrateur est créé manuellement via le
  formulaire d'inscription `/admin` — il n'existe aucun identifiant pré-provisionné dans Secret Manager sur lequel se rabattre.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre
(notamment pourquoi `enable_gcs_storage` et les variables Redis n'ont aucun effet sur ce module).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple
après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime
le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement
le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run, la base de données Cloud SQL,
les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées
ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'application Payload à partir des sources via Cloud Build, provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, et exécute `db-init` → `payload-migrate` |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; créer le premier compte administrateur via le formulaire d'inscription `/admin` |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version (reconstruction à partir des sources), gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job de migration, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
