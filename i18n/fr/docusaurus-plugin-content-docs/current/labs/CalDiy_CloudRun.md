---
title: "CalDiy sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez CalDiy sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/CalDiy_CloudRun.md @ 3055034 sha256:cecfac3b5c26 -->

# CalDiy sur Cloud Run — Guide de lab {#caldiy-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalDiy_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Cal.diy est le fork sous licence MIT et auto-hébergeable de Cal.com — une plateforme
open source de planification de rendez-vous qui supprime les allers-retours liés à
l'organisation des réunions. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Cal.diy on Cloud Run** sur Google Cloud : le déployer, y
accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Cal.diy. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalDiy_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Cal.diy (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalDiy_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (PostgreSQL) avec ses secrets Secret Manager (`NEXTAUTH_SECRET` et
   `CALENDSO_ENCRYPTION_KEY`), construit l'image de conteneur d'encapsulation
   personnalisée et exécute trois jobs ponctuels d'initialisation de la base de
   données (`db-init`, `db-migrate`, `seed-app-store`). Un premier déploiement prend
   environ **20–35 minutes** (la création de Cloud SQL et le build de l'image en
   représentent l'essentiel).

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres
   indépendants des noms (pour que les commandes fonctionnent quel que soit le
   suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~cal" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain et que sa couche de sessions NextAuth est prête :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/auth/session"
   # expect 200
   ```

   > **Remarque sur le premier démarrage :** Cal.diy exécute une étape de réécriture
   > d'URL et les migrations Prisma avant de pouvoir servir des requêtes. La sonde de
   > démarrage accorde jusqu'à 6 minutes. Si vous obtenez une réponse autre que 200,
   > attendez 2–3 minutes et réessayez.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Cal.diy affiche un formulaire de création
   de compte lors de la première visite — créez-y votre compte administrateur. Il
   n'existe pas de secret contenant un mot de passe administrateur prédéfini ; les
   identifiants du compte sont définis par le premier utilisateur qui s'inscrit.

3. Vérifiez que les secrets propres à l'application ont été créés automatiquement :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~cal" \
     --format="table(name,createTime)"
   ```

   Vous devriez voir des secrets correspondant à `*-nextauth-secret` et `*-encryption-key`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification du service ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une
   modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~cal"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + backup jobs
   ```

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. caldiydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^caldiy" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances
   (comportement de mise à l'échelle) et l'utilisation du CPU et de la mémoire. Le
   module provisionne également un **test de disponibilité** (uptime check) ;
   vérifiez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Cal.diy à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les
  variables d'environnement et les secrets ont été résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Boucle de démarrage / 503 sur `/api/auth/session` :** Cal.diy exécute une passe de
  réécriture d'URL, les migrations Prisma et un peuplement (seed) de l'app store avant
  de pouvoir servir des requêtes. La sonde de démarrage accorde 6 minutes ; si
  l'instance est arrêtée avant la fin de cette fenêtre, vérifiez que
  `startup_probe.failure_threshold` n'a pas été abaissé en dessous de la valeur par
  défaut. Vérifiez aussi que `memory_limit` vaut au moins `2Gi` — sinon des arrêts pour
  OOM surviennent avant que l'application ne soit prête.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que les trois jobs
  d'initialisation se sont terminés avec succès.
- **Échec des jobs d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="name~cal"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL
partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL et les secrets, et exécute l'initialisation, la migration et le peuplement de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; création du compte lors de la première visite ; secrets vérifiés |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de démarrage, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
