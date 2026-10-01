---
title: "Miniflux sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Miniflux sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Miniflux_CloudRun.md @ 3055034 sha256:408eabd9ce24 -->

# Miniflux sur Cloud Run — Guide de lab {#miniflux-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Miniflux_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un unique binaire
Go statique qui stocke tout son état dans PostgreSQL. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **Miniflux on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Miniflux. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Miniflux_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et vous connecter avec le compte administrateur pré-créé.
- Effectuer les opérations du jour 2 — inspecter les révisions, mettre à l'échelle, mettre à jour la version, et
  gérer les secrets et l'interrogateur de flux.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Miniflux (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Miniflux_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (2 vCPU / 4 Gio, CPU toujours allouée
   avec `min = 1` afin que l'interrogateur de flux intégré au processus continue de tourner), une base de données Cloud SQL
   (PostgreSQL 15) avec ses secrets Secret Manager (le `ADMIN_PASSWORD` généré
   automatiquement et le mot de passe de la base), un bucket Cloud Storage `data` par défaut
   (inutilisé), construit l'image de conteneur et exécute un job ponctuel d'initialisation
   de la base qui crée la base de données/le rôle `miniflux` et installe l'extension
   `hstore`. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   représente l'essentiel du temps).

3. Une fois le déploiement terminé, identifiez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~miniflux" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Miniflux renvoie un `200 OK` sans authentification sur
   le chemin racine, qui est aussi la cible de la sonde :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Récupérez dans Secret Manager le mot de passe initial du propriétaire pré-créé (le compte est
   créé au premier démarrage — il n'existe pas d'inscription en libre-service) :

   ```bash
   gcloud secrets versions access latest \
     --secret=secret-<resource-prefix>-miniflux-admin-password --project="$PROJECT"
   ```

   Remplacez `<resource-prefix>` par le nom réel du secret obtenu avec
   `gcloud secrets list --project="$PROJECT" --filter="name~miniflux"`.

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le nom d'utilisateur `admin` (ou le
   `ADMIN_USERNAME` que vous avez configuré) et le mot de passe récupéré. Si vous placez le
   service derrière un domaine personnalisé ou un équilibreur de charge, définissez `BASE_URL` (via
   `environment_variables`) sur cette URL afin que Miniflux génère des liens absolus corrects
   et des URL d'images correctes pour le proxy de flux.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle est une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors de la prochaine application). Conservez `min_instance_count = 1` (la valeur par défaut) afin que
   l'interrogateur de flux intégré au processus continue d'actualiser les flux entre les requêtes ; descendre à `0`
   (réduction à zéro) arrête l'interrogation en arrière-plan, sauf si vous l'externalisez avec un appel Cloud
   Scheduler vers `/v1/feeds/refresh`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. Miniflux applique lui-même ses migrations de schéma au démarrage, aucune étape de migration
   distincte n'est donc nécessaire — prévoyez un délai supplémentaire au premier démarrage après une mise à niveau.

4. **Gérez les secrets et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~miniflux"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"        # db-init + any scheduled jobs
   gcloud run jobs executions list --job="${SERVICE}-db-init" \
     --project="$PROJECT" --region="$REGION"
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. minifluxdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^miniflux" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^miniflux" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis le CLI ou l'explorateur de journaux (Logs Explorer). Au démarrage, le point d'entrée journalise son
   mode de connexion `DATABASE_URL` (socket / loopback / TCP sur IP privée) —
   utile pour diagnostiquer la connectivité à la base :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation CPU /
   mémoire. Comme `cpu_always_allocated = true` et `min = 1` sont les
   valeurs par défaut, attendez-vous à ce qu'une instance reste active en permanence (c'est le compromis
   lié à l'interrogateur de flux intégré au processus). Le module peut également provisionner un **test de
   disponibilité** ; s'il est activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks, et
   consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Miniflux.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage cible `/` (racine, sans authentification) avec une fenêtre généreuse pour le premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job `db-init` s'est terminé avec succès (il
  crée la base de données/le rôle `miniflux` et l'extension `hstore` appartenant au rôle
  de l'application).
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les flux ne s'actualisent pas :** l'interrogateur de flux s'exécute dans le processus selon
  `POLLING_FREQUENCY`. Si le service est réduit à zéro (`cpu_always_allocated =
  false` / `min_instance_count = 0`), l'interrogation s'arrête pendant l'inactivité, sauf si vous déclenchez
  `/v1/feeds/refresh` de l'extérieur via Cloud Scheduler.
- **Impossible de se connecter / mot de passe administrateur perdu :** relisez le secret `ADMIN_PASSWORD`
  (voir la tâche 2) ; `CREATE_ADMIN` ne crée le compte qu'au premier démarrage et est
  idempotent lors des démarrages suivants.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment l'immuabilité de `db_name`/`db_user` après le premier déploiement et
les conséquences de la désactivation de `cpu_always_allocated`/`min_instance_count`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS, ainsi que tout montage NFS Filestore
et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets et un bucket de stockage par défaut, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; récupérer le mot de passe administrateur pré-créé et se connecter |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/les jobs, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, d'interrogateur de flux et de build/IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
