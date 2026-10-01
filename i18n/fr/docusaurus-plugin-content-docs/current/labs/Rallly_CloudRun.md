---
title: "Rallly sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Rallly sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Rallly_CloudRun.md @ 3055034 sha256:4957260572a3 -->

# Rallly sur Cloud Run — Guide de lab {#rallly-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Rallly_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Rallly est une application open source et auto-hébergée de planification de réunions et de sondages de groupe —
une alternative respectueuse de la vie privée à Doodle — construite avec Next.js et Prisma. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Rallly on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Rallly. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Rallly_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les paramètres SMTP.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Rallly (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Rallly_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si vous disposez déjà d'un relais SMTP,
   renseignez dès maintenant `smtp_user` et `smtp_password` (la valeur par défaut de `smtp_host` est
   `smtp.gmail.com`) afin que la connexion par e-mail fonctionne dès le premier démarrage. Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_PASSWORD`, `NEXTAUTH_SECRET`,
   un `SMTP_PWD` facultatif et le mot de passe de la base), construit l'image de conteneur,
   et exécute un job ponctuel d'initialisation de la base qui crée la base de données vide
   et le rôle. Les premiers déploiements prennent environ **15 à 25 minutes** (la création de Cloud SQL
   représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~rallly" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est entièrement prêt — base de données migrée et joignable. Le point de terminaison
   d'état de Rallly ne renvoie un code 2xx qu'une fois que l'application a terminé la migration Prisma
   du premier démarrage et confirmé ses dépendances (il s'agit d'une vérification plus stricte que
   la sonde de démarrage TCP de la plateforme, qui confirme seulement que le port est ouvert) :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/status"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. La connexion à Rallly est **sans mot de passe et
   basée sur l'e-mail** — il n'existe aucun compte administrateur pré-créé. Saisissez votre e-mail sur la
   page de connexion ; Rallly envoie un lien/code de vérification par e-mail via le relais SMTP
   configuré. Si rien n'arrive, vérifiez que SMTP est réellement configuré (tâche 3, étape 4)
   avant de conclure que le déploiement est défaillant.

3. Si vous prévoyez de placer le service derrière un domaine personnalisé, définissez `base_url` sur ce
   domaine et appliquez la modification via **Update** afin que les liens d'invitation et de connexion pointent vers l'adresse
   que les utilisateurs visitent réellement, plutôt que vers l'URL brute `run.app`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle est une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors de la prochaine application). Rallly conserve tout son état dans PostgreSQL ; il se met donc à l'échelle
   horizontalement sans cache ni système de fichiers partagé.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. Le script `./docker-start.sh` de Rallly exécute `prisma migrate deploy` à chaque
   démarrage, de sorte que les migrations de schéma s'appliquent automatiquement — aucune étape de migration distincte n'est
   nécessaire.

4. **Gérez les secrets et SMTP :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~rallly"
   gcloud run services describe "$SERVICE" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)'   # confirm SMTP_* / base URL env
   ```

   Ne renouvelez jamais `SECRET_PASSWORD` ni `NEXTAUTH_SECRET` en dehors d'une fenêtre de maintenance
   planifiée — voir la tâche 5.

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ralllydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^rallly" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation CPU / mémoire. Le module peut provisionner un **test de disponibilité** ; vérifiez qu'il
   est au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Rallly.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage est **TCP par conception** (et non `/api/status`, qui ne renvoie un code 2xx qu'une fois
  l'application entièrement prête) et accorde un budget d'environ 230 secondes (30 s de délai initial
  + 10 nouvelles tentatives à 20 s) pour couvrir la migration Prisma du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les utilisateurs ne peuvent pas se connecter :** la connexion à Rallly est sans mot de passe et basée sur l'e-mail. Vérifiez
  que `smtp_user` / `smtp_password` sont définis (la valeur par défaut `smtp_host = smtp.gmail.com` ne
  suffit pas à elle seule) et contrôlez les variables d'environnement `SMTP_*` de la révision en cours d'exécution.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job d'initialisation s'est terminé avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les liens d'invitation/de connexion pointent vers le mauvais hôte :** définissez `base_url` sur votre domaine
  personnalisé — sinon `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` prennent par défaut l'URL brute
  `run.app`.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle : ne jamais renouveler `SECRET_PASSWORD` ni
`NEXTAUTH_SECRET` après le premier démarrage, et la règle d'immuabilité de `db_name`/`db_user`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et les images d'Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15) et les secrets, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le point de terminaison d'état renvoie 200 ; connexion via le lien de vérification envoyé par e-mail |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/SMTP, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de SMTP et de build |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
