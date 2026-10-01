---
title: "App CloudRun — Guide de lab"
description: "Lab pratique : déployez le module d'hébergement d'applications App CloudRun dans votre propre projet Google Cloud — configuration, vérification, exploitation et démantèlement."
---

<!-- translated-from: docs/labs/App_CloudRun.md @ 3055034 sha256:ddb04a44a818 -->

# App CloudRun — Guide de lab {#app-cloudrun--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

`App CloudRun` est le **moteur de déploiement de base** de tous les modules d'application Cloud Run de cette plateforme. Il provisionne un service Cloud Run v2 prêt pour la production pour n'importe quelle charge de travail conteneurisée — avec, en option, Cloud SQL (PostgreSQL, MySQL ou SQL Server), Cloud Filestore NFS, le stockage GCS, Secret Manager, la CI/CD Cloud Build, Cloud Monitoring et, en option, le WAF Cloud Armor. Les modules d'application tels que `Django_CloudRun` et `Ghost_CloudRun` appellent ce moteur en interne ; vous pouvez aussi le déployer directement pour une charge de travail générique. Ce lab vous accompagne tout au long du cycle de vie opérationnel du module **App CloudRun** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur la charge de travail qui s'exécute dans le conteneur. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisé par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

> **Ce lab se déploie sur une fondation `Services_GCP`.** Utilisez le **même `tenant_id`** que votre déploiement `Services_GCP` afin qu'`App CloudRun` découvre automatiquement le VPC partagé, l'instance Cloud SQL, le serveur NFS et Artifact Registry et s'y rattache, au lieu de provisionner ses propres copies intégrées. (Le déploiement autonome — avec `require_services_gcp_module = false` — est pris en charge, mais l'objet de ce lab est de mettre en œuvre la fondation.)

> **Les paramètres sont validés au moment du plan.** Le module rejette les valeurs invalides et les combinaisons de fonctionnalités invalides — un réplica en lecture sans instance principale, IAP sans utilisateurs autorisés, un environnement d'exécution `gen1` avec NFS, un job `mount_nfs` avec `enable_nfs = false`, une source d'image `prebuilt` sans image — *avant* que quoi que ce soit ne soit créé, avec un message d'erreur clair qui nomme la variable. Vous obtenez un échec rapide et explicite plutôt qu'un déploiement à moitié construit. Le tableau [*Configuration Pitfalls* du Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun) indique quelles combinaisons sont détectées de cette manière.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets, les jobs et le stockage.
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
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour ne comportent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

### Étape 1.0 — Choisir la configuration de votre lab {#step-10--choose-your-lab-configuration}

Choisissez un parcours selon la part du module que vous souhaitez mettre en œuvre. Les deux se rattachent à votre fondation `Services_GCP` via un `tenant_id` identique.

**Parcours A — Minimal (le plus rapide).** Valeurs par défaut : un service Cloud Run adossé à PostgreSQL (le Cloud SQL partagé), le NFS partagé et un job d'initialisation. Définissez uniquement `project_id` et `tenant_id`. Cela suffit pour parcourir les tâches 2 à 6.

**Parcours B — Complet (recommandé pour ce lab).** Met en œuvre l'étendue du moteur afin que chaque étape de vérification ait quelque chose à confirmer. Paramètres suggérés (tout le reste par défaut) :

```hcl
project_id           = "<your-project-id>"
tenant_id = "demo"          # MUST match your Services_GCP deployment

application_name     = "labapp"
application_version  = "1.0.0"

# Database — uses the shared Cloud SQL from Services_GCP (no per-deploy instance)
database_type        = "POSTGRES"
enable_cloudsql_volume = true

# Shared storage & cache (auto-discovered from Services_GCP)
enable_nfs           = true
enable_redis         = true            # falls back to the NFS/Memorystore host
create_cloud_storage = true
storage_buckets      = [{ name_suffix = "data" }]
gcs_volumes          = [{ name = "data", mount_path = "/mnt/data" }]   # GCS Fuse (gen2)

# Runtime
execution_environment = "gen2"         # required for NFS + GCS Fuse
min_instance_count   = 0               # scale-to-zero for a lab
max_instance_count   = 2

# Observability
uptime_check_config  = { enabled = true, path = "/healthz" }

# Access control (safe): IAP requires at least one authorized identity — enforced
enable_iap           = true
iap_authorized_users = ["user:<your-email>"]
```

> **Option avancée facultative — domaine personnalisé + WAF.** Définir `enable_cloud_armor = true` provisionne un équilibreur de charge HTTPS global avec une stratégie Cloud Armor. `application_domains` est **facultatif** — laissez-le vide et le module dérive un certificat géré `<ip-dashed>.nip.io` sans configuration. Ne fournissez un domaine que si vous souhaitez votre propre nom d'hôte, ce qui nécessite ensuite un enregistrement DNS A après le déploiement et environ 10–60 min pour l'émission du certificat. Cela ajoute aussi le coût de l'équilibreur de charge. Ne l'activez que si vous souhaitez mettre en œuvre le chemin en périphérie ; sinon, laissez-le désactivé et accédez au service via son URL `*.run.app` (ou via IAP).

> Le parcours B laisse IAP renseigné (pas de verrouillage) et conserve Binary Authorization / VPC-SC à leurs valeurs par défaut sûres. Les étapes de déploiement ci-dessous supposent le parcours B et signalent les vérifications propres à une fonctionnalité afin que les utilisateurs du parcours A puissent les ignorer.

### Étape 1.1 — Déployer {#step-11--deploy}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **App (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et `tenant_id`, et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL facultative
   avec ses secrets Secret Manager, un stockage NFS/Redis/GCS facultatif, construit ou
   met en miroir l'image du conteneur et exécute les jobs d'initialisation configurés. Les premiers
   déploiements prennent environ **20–35 minutes** lorsque la création de Cloud SQL est incluse.

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~crapp" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

Vérifiez que chaque fonctionnalité que vous avez activée est bien opérationnelle. Les étapes marquées d'un indicateur ne s'appliquent qu'au parcours B (ou aux fonctionnalités que vous avez activées).

1. **Santé du service.** Lorsque IAP est activé, l'URL `*.run.app` renvoie 403 aux appelants non authentifiés (c'est le comportement attendu — voir l'étape 7) ; sans IAP :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"   # expect 200 (or 403 if IAP is on)
   ```

2. **Base de données** `[database_type != NONE]` — vérifiez que la base de données et l'utilisateur propres à l'application ont été créés dans l'instance Cloud SQL partagée, et que le secret du mot de passe existe :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~labapp" --format="value(name)"
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~db-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"   # the generated password
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="table(name)"
   ```

3. **Rattachement à la fondation** — vérifiez que le service a rejoint le VPC *partagé* (et non un VPC intégré) et qu'il référence le Cloud SQL partagé via le volume Auth Proxy :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.metadata.annotations)" | grep -E "cloudsql-instances|vpc-access"
   ```

4. **Montage NFS** `[enable_nfs = true]` — vérifiez que le volume NFS est monté dans la révision :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json(spec.template.spec.volumes)" | grep -iE "nfs|server"
   ```

5. **GCS Fuse + bucket** `[gcs_volumes / storage_buckets]` — vérifiez que le bucket existe et que le volume Fuse est monté :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~labapp" --format="value(name)"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json(spec.template.spec.volumes)" | grep -i "gcs\|bucket"
   ```

6. **Raccordement à Redis** `[enable_redis = true]` — vérifiez que `REDIS_HOST` / `REDIS_PORT` ont été injectés :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json(spec.template.spec.containers[0].env)" | grep -i redis
   ```

7. **Job d'initialisation** — vérifiez que le job d'initialisation (par exemple `db-init`) s'est exécutée avec succès pendant le déploiement :

   ```bash
   JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~init" --format="value(metadata.name)" --limit=1)
   gcloud run jobs executions list --job="$JOB" --project="$PROJECT" --region="$REGION" \
     --format="table(metadata.name, status.succeededCount, status.failedCount)"
   ```

8. **Contrôle d'accès IAP** `[enable_iap = true]` — une requête non authentifiée est bloquée, une requête autorisée (avec un jeton d'identité) aboutit :

   ```bash
   curl -s -o /dev/null -w "anonymous: %{http_code}\n" "$SERVICE_URL/"                                   # expect 403
   curl -s -o /dev/null -w "authed:    %{http_code}\n" -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL/"   # expect 200 if your email is authorized
   ```

9. **Test de disponibilité** — vérifiez que le module a provisionné un test de disponibilité (uptime check) Cloud Monitoring :

   ```bash
   gcloud monitoring uptime list-configs --project="$PROJECT" --format="table(displayName,monitoredResource.labels.host)" 2>/dev/null | grep -i labapp || echo "(check Monitoring → Uptime checks in the console)"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification du service ; la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite ou mise en miroir et une nouvelle révision est déployée.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~crapp"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~crapp"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (lorsqu'une base de données est
   provisionnée) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --project="$PROJECT"
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
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU
   et de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il
   est au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas selon la charge de travail déployée dans
le conteneur.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et est accessible au compte de service, et que les éventuelles
  jobs d'initialisation se sont terminés avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="<job-name>" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build ou de la mise en miroir de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec,
  sous Cloud Build → History.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution et
  que tous les secrets référencés existent dans Secret Manager.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (elle fait oublier le déploiement à RAD). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL facultative, les secrets Secret Manager, les buckets GCS, les Cloud Run Jobs
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL
partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Choisir la configuration et déployer | Automatisé | Choisir Minimal ou Complet ; le module se rattache à la fondation `Services_GCP` et provisionne Cloud Run, la base de données Cloud SQL partagée, les secrets, le raccordement NFS/GCS/Redis, et exécute les jobs d'initialisation |
| 2 — Accéder et vérifier | Manuel | Vérifier la santé, la base de données + le secret, le rattachement à la fondation, le montage NFS, GCS Fuse + bucket, l'environnement Redis, la réussite du job d'initialisation, l'application d'IAP et le test de disponibilité |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer secrets/jobs/stockage, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module ; les ressources partagées appartenant à `Services_GCP` sont conservées |
