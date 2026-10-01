---
title: "Chibisafe sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Chibisafe sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Chibisafe_CloudRun.md @ 3055034 sha256:fd2dfd759171 -->

# Chibisafe sur Cloud Run — Guide de lab {#chibisafe-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chibisafe_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Chibisafe est un outil auto-hébergé de téléversement de fichiers et d'images, avec téléversement par glisser-déposer,
albums et API publique. Ce module déploie la **pile Chibisafe complète** —
le backend chibisafe-server, l'interface web Next.js et un reverse proxy Caddy,
réunis dans une seule image construite sur mesure et à l'écoute sur le port 8000 — sous la forme d'un unique
service Cloud Run v2 sans base de données externe — SQLite, les fichiers téléversés et les journaux résident tous dans un même bucket
Cloud Storage monté via GCS Fuse. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Chibisafe on Cloud Run** : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Chibisafe. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chibisafe_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à l'interface web de Chibisafe et vérifier le service via son endpoint de santé.
- Effectuer les opérations du jour 2 — inspecter les révisions, gérer le secret administrateur
  facultatif et comprendre pourquoi le service est limité à une seule instance.
- Inspecter l'état SQLite/fichiers téléversés/journaux sur le volume adossé à Cloud Storage.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Chibisafe (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chibisafe_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit et publie l'image chibisafe-server personnalisée (épinglée sur
   `v6.5.5`, sauf si vous définissez une version précise), provisionne le service Cloud Run v2
   et provisionne systématiquement un bucket Cloud Storage `storage` monté sur
   `/data` via GCS Fuse. Aucune instance Cloud SQL n'est créée — `database_type` est
   fixé à `NONE`. Si `enable_api_key = true`, un secret contenant un mot de passe administrateur aléatoire
   est également créé dans Secret Manager. Comme il n'y a aucune base de données à provisionner,
   les premiers déploiements prennent généralement **10 à 20 minutes** (le build de l'image personnalisée
   représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~chibisafe" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Dans le conteneur, Caddy route
   `/api/*` (ainsi que la référence OpenAPI `/docs`) vers le backend, sert les fichiers
   téléversés par leur nom et envoie tout le reste à l'interface web. L'endpoint de santé
   sollicite à la fois le proxy et le backend :

   ```bash
   curl -s "$SERVICE_URL/api/health"   # expect HTTP 200, {"status":"yes"}
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 200 — the Chibisafe web UI (HTML)
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur — l'interface web de Chibisafe se charge (tableau de bord,
   connexion, téléversements, albums). L'API REST se trouve à `$SERVICE_URL/api` (la sortie
   `api_url` du module), vers laquelle pointent les clients de type ShareX.

3. **Identifiant administrateur :** connectez-vous au tableau de bord en tant que `admin`. Par défaut
   (`enable_api_key = false`), le compte administrateur du premier lancement utilise
   le mot de passe par défaut amont de Chibisafe (`admin`) — changez-le immédiatement
   après la première connexion. Pour éviter complètement ce mot de passe par défaut bien connu, redéployez avec
   `enable_api_key = true` ; le module génère alors une valeur aléatoire, la stocke
   dans Secret Manager et l'injecte en tant que `ADMIN_PASSWORD`. Récupérez-la avec :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chibisafe AND name~api-key"
   gcloud secrets versions access latest --secret=<api-key-secret-name> --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui soit saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une seule instance.** `min_instance_count = max_instance_count
   = 1` par défaut, et il s'agit d'une exigence stricte, et non d'une valeur par défaut ajustable :
   Chibisafe est une application SQLite à écrivain unique partageant un seul montage GCS Fuse,
   et la sémantique de verrouillage de fichiers POSIX de GCS Fuse est plus faible que celle d'un véritable
   système de fichiers. Un second écrivain concurrent risque de corrompre la base de données
   SQLite. Si vous avez besoin d'un stockage durable et pouvant monter en charge en toute sécurité, utilisez plutôt
   `Chibisafe_GKE` (PVC en mode bloc).

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; l'image est
   reconstruite avec l'argument de build épinglé `CHIBISAFE_VERSION` et une nouvelle révision
   est déployée.

4. **Gérez le secret administrateur facultatif :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chibisafe"
   ```

5. **Inspectez directement l'état stocké** — il n'y a aucun client de base de données auquel
   se connecter ; SQLite, les fichiers téléversés et les journaux résident sur le bucket monté :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~chibisafe" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${BUCKET}/database" "gs://${BUCKET}/uploads" "gs://${BUCKET}/logs"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation CPU / mémoire
   (attendez-vous à une instance unique et stable en utilisation normale). Un test
   de disponibilité est disponible mais **désactivé par défaut**
   (`uptime_check_config.enabled = false`) — activez-le dès que vous disposez d'une URL publique
   stable, puis vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Chibisafe.

- **Révision non saine / boucle de redémarrage :** les sondes de démarrage et de vivacité
  ciblent `/api/health` par défaut, qui passe par Caddy jusqu'au backend
  et renvoie littéralement un 200 `{"status":"yes"}`. Conservez-les sur ce chemin — `/` est servi
  par l'interface web et ne sollicite pas le backend. Le conteneur exécute le
  backend, l'interface web et Caddy sous un même superviseur qui s'arrête si l'un d'eux
  tombe, si bien qu'un plantage de n'importe quel processus se manifeste par un redémarrage ; les journaux indiquent lequel.
  Si vous avez redéfini `startup_probe` / `liveness_probe`, rétablissez le chemin
  `/api/health`.
- **Les téléversements de plus de 32 MiB échouent :** Cloud Run limite le corps des requêtes HTTP/1 à
  32 MiB, alors que la taille de fragment de téléversement par défaut de Chibisafe est supérieure (~81 MB). Réduisez
  **Chunk Size** dans les paramètres du tableau de bord en dessous de 32 MiB.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les fichiers téléversés ou la base de données semblent réinitialisés ou corrompus :** la sémantique de verrouillage
  de fichiers POSIX de GCS Fuse n'est pas entièrement sûre pour des écritures SQLite soutenues/concurrentes.
  Vérifiez que `max_instance_count = 1` n'a pas été modifié, et considérez
  cette variante Cloud Run comme adaptée à un usage léger / à faible trafic — passez à
  `Chibisafe_GKE` (PVC en mode bloc) pour des charges de travail plus lourdes ou de production.
- **Service injoignable alors que les contrôles d'état réussissent :** vérifiez que
  `ingress_settings = "all"` (public) — ce module a par le passé été touché par un bogue
  à l'échelle du parc qui réglait par défaut l'ingress de certains modules sur `internal` ; la
  valeur par défaut actuelle du code source est bien `all`, mais vérifiez la configuration
  que vous avez déployée.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build en échec.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment le risque lié au modèle de persistance, le
compromis de sécurité de `enable_api_key`, et les variables inertes `startup_probe_config` /
`health_check_config` / `enable_redis` / `enable_cloudsql_volume`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
le bucket de données Cloud Storage (base SQLite, fichiers téléversés et journaux) et le
secret facultatif du mot de passe administrateur. Il n'y a aucune base de données Cloud SQL à supprimer — aucune
n'a jamais été créée. Les ressources appartenant à **Services_GCP** (le VPC, Artifact
Registry) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et provisionne Cloud Run, un bucket de données GCS (`/data` via GCS Fuse) et un secret administrateur facultatif — pas de Cloud SQL |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état sur `/api/health` réussit ; l'interface web de Chibisafe se charge sur `/` ; se connecter en tant que `admin` et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, gérer le secret administrateur, inspecter SQLite/fichiers téléversés/journaux sur le bucket ; ne jamais dépasser 1 instance |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de chemin de sonde, de taille de téléversement, de sûreté des écritures GCS Fuse, d'ingress, d'IAM et de build |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire le service, le bucket et le secret facultatif |
