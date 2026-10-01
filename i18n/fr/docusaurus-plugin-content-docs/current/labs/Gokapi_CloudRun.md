---
title: "Gokapi sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Gokapi sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Gokapi_CloudRun.md @ 3055034 sha256:a1c16c7935de -->

# Gokapi sur Cloud Run — Guide de lab {#gokapi-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gokapi_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Gokapi est un serveur de partage de fichiers léger et auto-hébergé, écrit en Go — une
alternative auto-hébergée à WeTransfer, qui génère des liens de téléchargement partageables avec
expiration, limite du nombre de téléchargements et protection par mot de passe facultatives. Ce lab vous guide
à travers le cycle de vie opérationnel complet du module **Gokapi on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Gokapi. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gokapi_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et revendiquer le compte administrateur.
- Effectuer les opérations du jour 2 — inspecter le service, le mettre à l'échelle correctement, mettre à jour la
  version et gérer la clé d'API facultative.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Gokapi (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gokapi_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne un service Cloud Run à instance unique, un bucket Cloud Storage
   monté dans le conteneur via **GCS Fuse** sur `/data` (ce bucket est
   la seule persistance de Gokapi — il n'y a pas d'instance Cloud SQL ; `database_type` est
   fixé à `NONE` et Gokapi conserve sa propre base de données SQLite interne sur le
   montage), et construit l'image du conteneur à partir d'une fine surcouche de l'image amont
   `f0rc3/gokapi`. Aucun job d'initialisation de base de données ne s'exécute — Gokapi gère
   son propre stockage. Comme il n'y a pas d'instance Cloud SQL à provisionner, les premiers déploiements
   sont nettement plus rapides que ceux des modules adossés à une base de données — généralement **10–20
   minutes**, dominées par le build de l'image.

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gokapi" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. Les sondes de santé de Gokapi interrogent la racine publique ; un
   simple `curl` suffit donc comme test de disponibilité (aucun point de terminaison d'API ni authentification requis) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur **immédiatement**. Gokapi n'a aucun identifiant
   administrateur pré-initialisé — à la première visite, il affiche son propre assistant de configuration initiale,
   et la première personne qui y accède revendique le compte administrateur. Comme
   `ingress_settings = "all"` rend le service joignable publiquement par défaut,
   ne remettez pas cette étape à plus tard ; si vous avez besoin d'un délai avant de le revendiquer,
   redéployez d'abord avec `enable_iap = true` pour protéger l'URL derrière une connexion Google.

3. Vérifiez que les données arrivent bien sur le montage GCS Fuse après avoir utilisé
   l'interface pour téléverser un fichier :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --format="value(name)" --filter="name~storage" | grep -i gokapi | head -1)
   gcloud storage ls "gs://${BUCKET}/config"   # SQLite DB + app config
   gcloud storage ls "gs://${BUCKET}/data"     # uploaded files
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count = 1` /
   `max_instance_count = 1` est une limite opérationnelle stricte, et non une valeur par défaut ajustable —
   la base de données SQLite de Gokapi n'accepte qu'un seul rédacteur, sans clustering ni
   réplication ; augmenter `max_instance_count` risque donc de corrompre la base de données et
   de rendre les téléversements incohérents. Il n'y a rien à configurer ici ; laissez les deux à 1.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update**. Le Dockerfile de Gokapi associe la valeur par défaut
   `latest` de la plateforme à un tag fixé et éprouvé (`v1.9.6`) via un argument de build
   propre à l'application ; laisser la version sur `latest` est donc sûr et
   reproductible ; fixez-la explicitement si vous avez besoin d'une autre version.

4. **Gérez la clé d'API opérateur facultative** (présente uniquement si `enable_api_key =
   true` a été défini lors du déploiement — Gokapi n'a aucun secret obligatoire) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"
   gcloud secrets versions access latest --secret=<api-key-secret-name> --project="$PROJECT"
   ```

   Ce jeton n'est qu'une commodité — les véritables clés d'API de téléversement/téléchargement de Gokapi sont
   normalement générées depuis l'interface d'administration après la configuration.

5. **Inspectez directement le bucket de stockage** pour obtenir un instantané de l'état persisté
   (il n'y a pas de session de base de données à ouvrir — Gokapi n'a pas d'instance Cloud SQL) :

   ```bash
   gcloud storage ls "gs://${BUCKET}/config" "gs://${BUCKET}/data"
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
   de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU et de la mémoire (Gokapi est
   un binaire Go léger ; attendez-vous donc à une consommation faible en régime établi). Le test de disponibilité
   est **désactivé par défaut** (`uptime_check_config.enabled = false`) — activez-le
   pour un déploiement de production, puisque le service est joignable publiquement par
   défaut, puis vérifiez-le dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Gokapi.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. Les sondes de démarrage et de vivacité ciblent toutes deux `/`
  (non authentifié, sans dépendance à une base de données externe) — la sonde de démarrage autorise
  environ 100 secondes de nouvelles tentatives après un délai initial de 15 secondes.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les téléversements ou la base SQLite semblent disparaître ou se corrompre par intermittence :** le montage GCS
  Fuse sur `/data` est le seul chemin de persistance de Gokapi sur Cloud Run et ne
  fournit pas un véritable verrouillage de fichiers POSIX — il s'agit d'une combinaison à risque connue, inhérente
  à l'exécution d'une application adossée à SQLite sur Cloud Run, et non d'une erreur de configuration à corriger.
  Vérifiez que `execution_environment = "gen2"` (requis pour le montage GCS Fuse) et
  examinez le montage dans Cloud Run → service → Revisions → **Volumes**.
- **Quelqu'un d'autre a revendiqué le compte administrateur en premier :** comme
  l'assistant de configuration initiale est public et non authentifié, il n'existe aucune
  récupération intégrée — redéployer avec `enable_iap = true` l'empêche lors du prochain
  déploiement, mais ne retire pas un administrateur existant.
- **Secret de la clé d'API facultative introuvable :** vérifiez que `enable_api_key` était défini sur
  `true` lors du déploiement — sa valeur par défaut est `false` et aucun secret n'est créé
  dans le cas contraire.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment pourquoi `max_instance_count` et
`container_port` doivent conserver leurs valeurs par défaut).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — le service
Cloud Run, le bucket Cloud Storage (et avec lui la base de données SQLite et chaque
fichier téléversé — il n'existe par défaut aucune sauvegarde séparée de ces données), le
secret facultatif de la clé d'API et les images Artifact Registry. Les ressources détenues par
**Services_GCP** (le VPC, Artifact Registry) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un service Cloud Run à instance unique, un bucket de stockage monté via GCS Fuse, et construit l'image Gokapi fixée |
| 2 — Accéder et vérifier | Manuel | Le test de santé réussit ; revendiquer immédiatement le compte administrateur de configuration initiale (public par défaut) |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver la mise à l'échelle à 1, mettre à jour la version, gérer la clé d'API facultative, inspecter le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de GCS Fuse/SQLite, de course à la revendication de l'administrateur, de secret et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris la base SQLite et les téléversements |
