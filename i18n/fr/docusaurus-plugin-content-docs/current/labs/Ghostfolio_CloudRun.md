---
title: "Ghostfolio sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Ghostfolio sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Ghostfolio_CloudRun.md @ 3055034 sha256:70ae99f94a24 -->

# Ghostfolio sur Cloud Run — Guide de lab {#ghostfolio-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghostfolio_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Ghostfolio est une application open source de gestion de patrimoine permettant de suivre la valeur nette,
les portefeuilles d’investissement et l’allocation d’actifs sur plusieurs comptes de courtage.
Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Ghostfolio sur
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter
au quotidien, l’observer, diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Ghostfolio. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghostfolio_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder au service en cours d’exécution et le vérifier, y compris son contrôle de santé combiné base de données + Redis.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Ghostfolio (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghostfolio_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que `enable_redis` vaut
   `true` par défaut et est OBLIGATOIRE — ne le désactivez pas. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`ACCESS_TOKEN_SALT`,
   `JWT_SECRET_KEY` et le mot de passe de la base de données), construit l’image de conteneur et
   exécute un job ponctuel d’initialisation de la base de données. Un premier déploiement prend environ
   **20 à 35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois terminé, repérez les ressources à l’aide de filtres indépendants du nom (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ghostfolio" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté À LA FOIS à sa base de données ET à Redis.
   Le point de terminaison de santé de Ghostfolio contrôle les deux dépendances et renvoie 503 tant que
   les deux ne sont pas joignables :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/v1/health"   # expect 200
   curl -s "$SERVICE_URL/api/v1/health"                                    # expect {"status":"OK"}
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Ghostfolio n’a **aucun formulaire de connexion par e-mail et
   mot de passe** — cliquez sur **Get Started** et l’application génère un « Security
   Token » anonyme aléatoire qui sert d’identifiant au propriétaire de votre compte. Conservez ce jeton ; c’est votre seul
   identifiant pour ce compte (il n’existe pas d’e-mail de récupération). Il n’y a aucun compte administrateur
   à initialiser ni aucune option d’inscription à désactiver ensuite.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service ; la mise à l’échelle est donc
   une modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait
   annulée lors du prochain apply).

3. **Mettez à jour le tag de version de l’application** en modifiant le paramètre de version dans la
   plateforme RAD et en l’appliquant via **Update** ; une nouvelle image est construite et une nouvelle
   révision est déployée. Contrairement à de nombreux modules à image préconstruite de ce catalogue,
   le tag `latest` de Ghostfolio est réellement valide sur Docker Hub ; `latest` suit donc
   la dernière version publiée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ghostfolio"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init jobs
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ghostfoliodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ghostfolio" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de
   mise à l’échelle) et l’utilisation du CPU et de la mémoire. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsque `uptime_check_config.enabled = true` — sa valeur par défaut est
   `false`) ; s’il est activé, vérifiez qu’il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Ghostfolio à l’autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d’erreurs de démarrage. La sonde de démarrage cible `/api/v1/health`, qui
  échoue tant que la base de données ET Redis ne sont pas TOUS DEUX joignables — un 503 à ce stade signifie souvent que
  Redis n’est pas encore joignable, et non un problème de base de données.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base existe et que le job d’initialisation s’est terminé
  avec succès. Rappelez-vous que le `DATABASE_URL` de Ghostfolio se connecte toujours via
  l’adresse IP privée de Cloud SQL (jamais via le chemin de socket Unix) avec `sslmode=require`.
- **Erreurs de connexion à Redis :** si `redis_host` a été laissé vide, vérifiez que la
  VM du serveur NFS de la plateforme est `RUNNING` (`enable_nfs` ou une instance NFS
  `Services_GCP` découverte) ; sinon `REDIS_HOST` est vide et le contrôle de santé
  ne réussit jamais.
- **Le job d’initialisation a échoué :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de ne jamais faire tourner `ACCESS_TOKEN_SALT` après le
premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du
déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD
ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec
l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre, l’hôte Redis
NFS) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), des secrets, et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit (base de données + Redis) ; générer un Security Token anonyme via « Get Started » |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle, mettre à jour la version, gérer secrets/sauvegardes, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de Redis, de job d’initialisation, de build et d’IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
