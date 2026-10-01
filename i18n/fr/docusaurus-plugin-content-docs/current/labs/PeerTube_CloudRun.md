---
title: "PeerTube sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez PeerTube sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PeerTube_CloudRun.md @ 3055034 sha256:73b0f9928757 -->

# PeerTube sur Cloud Run — Guide de lab {#peertube-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PeerTube_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60–90 minutes

PeerTube est une plateforme open source d'hébergement vidéo fédérée via ActivityPub —
une alternative auto-hébergée à YouTube qui fédère les vidéos, les commentaires et les chaînes
avec d'autres instances PeerTube (et plus largement le Fediverse). Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **PeerTube on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de PeerTube. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/PeerTube_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans
le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le compte administrateur créé automatiquement.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Comprendre le périmètre de ce module (VOD/transcodage léger) et savoir quand utiliser plutôt la variante GKE.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le réseau Cloud SQL, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **PeerTube (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PeerTube_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si vous disposez déjà
   d'un vrai domaine, définissez `host` dès maintenant (il devient immuable dès qu'un contenu
   ActivityPub réel existe) — sinon, laissez-le vide et le déploiement dérivera automatiquement
   un domaine de fédération fonctionnel basé sur `run.app`. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15),
   ses secrets Secret Manager (`PEERTUBE_SECRET`,
   `PT_INITIAL_ROOT_PASSWORD`, les clés d'accès/secrètes HMAC GCS), deux buckets Cloud Storage
   (un bucket `videos` public et un bucket `data` privé monté via FUSE),
   construit l'image de conteneur personnalisée via Cloud Build et exécute un
   job ponctuel d'initialisation de la base de données (création du rôle et de la base, plus les
   extensions `pg_trgm`/`unaccent`). Les premiers déploiements prennent environ **20 à 35
   minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin
   que les commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~peertube" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel et sert son point de terminaison de configuration public :

   ```bash
   curl -s "$SERVICE_URL/api/v1/config" | head -c 500   # expect real JSON (instance name, signup config, etc.)
   ```

2. Récupérez le mot de passe de l'administrateur `root` créé automatiquement. Contrairement à certaines
   applications ActivityPub de ce catalogue, PeerTube ne nécessite **aucune étape d'amorçage
   manuelle** — le compte `root` est créé automatiquement au premier démarrage à partir
   du secret `PT_INITIAL_ROOT_PASSWORD` :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~root-password" --format="value(name)")
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL/login` dans un navigateur et connectez-vous en tant que `root` avec le
   mot de passe récupéré. Vérifiez que le domaine de fédération public de l'instance
   (Settings → visible dans le pied de page / la page « About » de l'instance) correspond à
   ce que vous attendez — si vous avez laissé `host` vide, il doit afficher le nom d'hôte
   `run.app` dérivé.

4. Si vous prévoyez d'exploiter cette instance en production, décidez dès maintenant de la politique
   d'inscription : `enable_open_registration` vaut `false` par défaut. Conservez cette valeur
   sauf si vous souhaitez délibérément une instance ouverte aux inscriptions publiques.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update**
   sur la page de détails du déploiement — le module est propriétaire de la spécification du service, la
   mise à l'échelle est donc une modification de configuration, et non une modification manuelle via `gcloud` (une
   modification manuelle serait annulée lors de la prochaine application). Ce module utilise par défaut
   `cpu_always_allocated = true` (la file BullMQ de transcodage/fédération de PeerTube
   a besoin de CPU même entre les requêtes entrantes) — ne le basculez pas vers une
   facturation à la requête à moins de comprendre que les jobs en arrière-plan risquent de se bloquer.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite via
   l'ARG de build dédié `PEERTUBE_VERSION` et une nouvelle révision est déployée.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~peertube"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # the db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. peertubedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^peertube" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez les buckets de stockage des vidéos :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~peertube"
   gcloud storage ls gs://<videos-bucket>/
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation CPU / mémoire. Comme `cpu_always_allocated =
   true` par défaut, attendez-vous à un coût CPU de base non nul même avec un faible volume
   de requêtes — c'est normal (traitement en arrière-plan BullMQ). Si un test de
   disponibilité est activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks,
   et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de PeerTube.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision
  et ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  La sonde de démarrage est en **TCP** sur le port 9000 (et non en HTTP) — si la révision
  ne devient jamais prête, c'est probablement que le conteneur n'écoute pas du tout sur le port
  (vérifiez s'il y a un échec de connexion à la base de données ou un secret manquant) plutôt
  qu'une vérification de disponibilité applicative trop lente.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le job `db-init` s'est terminé
  avec succès. Rappelez-vous qu'ici Cloud Run se connecte à l'IP privée via TCP chiffré
  (et non via un socket Unix) — voir la §3 du Guide de configuration pour en comprendre la raison.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **L'envoi ou la lecture de vidéos échoue avec une erreur d'accès :** vérifiez que la
  prévention de l'accès public du bucket `videos` est à `inherited`, et non à `enforced`
  — si une modification manuelle l'a rétablie, l'attribution `allUsers:objectViewer` dont PeerTube
  a besoin échouera :
  ```bash
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal
  du build en échec — une cause fréquente est une valeur `application_version` invalide qui ne
  correspond à aucun tag `chocobozzz/peertube` réel.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution,
  et en particulier l'attribution du compte de service de stockage dédié sur
  le bucket `videos`.
- **Le streaming en direct ne fonctionne pas :** c'est le comportement attendu avec ce module —
  `enable_live_streaming` n'a aucun effet sur Cloud Run, quelle que soit sa valeur.
  L'ingestion RTMP (ports 1935/1936) est un protocole TCP brut que les services Cloud Run
  ne peuvent pas exposer. Utilisez `PeerTube_GKE` (dès qu'il sera disponible) pour le streaming en direct.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais modifier `host`
une fois qu'un contenu ActivityPub réel existe, et de ne jamais désactiver `enable_redis`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a
créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS `videos` et `data`, et les images d'Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, les buckets `videos`/`data`, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Le point de terminaison de configuration répond ; se connecter en tant qu'administrateur `root` créé automatiquement |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base et aux buckets |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, d'IAM du stockage, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
