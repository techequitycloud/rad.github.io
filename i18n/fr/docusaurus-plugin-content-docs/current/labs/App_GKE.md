---
title: "App GKE — Guide de lab"
description: "Lab pratique : déployez le module d'hébergement d'applications App GKE sur GKE Autopilot dans votre propre projet Google Cloud — configuration, exploitation et démantèlement."
---

<!-- translated-from: docs/labs/App_GKE.md @ 3055034 sha256:7e885178149e -->

# App GKE — Guide de lab {#app-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

`App GKE` est le **moteur de déploiement de base** de tous les modules d'application GKE Autopilot de cette plateforme. Il provisionne une charge de travail Kubernetes prête pour la production (Deployment ou StatefulSet) sur GKE Autopilot pour n'importe quelle application conteneurisée — avec, en option, Cloud SQL (PostgreSQL, MySQL ou SQL Server), Cloud Filestore NFS, le stockage GCS, Secret Manager via Workload Identity, la CI/CD Cloud Build, Cloud Monitoring et, en option, le WAF Cloud Armor. Les modules d'application tels que `Django_GKE` et `Ghost_GKE` appellent ce moteur en interne ; vous pouvez aussi le déployer directement pour une charge de travail générique. Ce lab vous accompagne tout au long du cycle de vie opérationnel du module **App GKE** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur la charge de travail qui s'exécute dans le conteneur. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisé par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

> **Ce lab se déploie sur une fondation `Services_GCP`.** Utilisez le **même `tenant_id`** que votre déploiement `Services_GCP` afin qu'`App GKE` se déploie dans le **cluster GKE Autopilot** partagé et se rattache au VPC partagé, à l'instance Cloud SQL, au serveur NFS et à Artifact Registry, au lieu de provisionner son propre cluster et sa propre infrastructure intégrés. (Le mode autonome — `require_services_gcp_module = false` — crée un cluster GKE intégré et prend beaucoup plus de temps ; l'objet de ce lab est de mettre en œuvre la fondation.)

> **Les paramètres sont validés au moment du plan.** Le module rejette les valeurs et combinaisons invalides — `stateful_pvc_enabled` avec `workload_type = "Deployment"`, IAP sans client OAuth, une source d'image `prebuilt` sans image, un job `mount_nfs` avec `enable_nfs = false`, une valeur de mémoire de ResourceQuota exprimée par un entier nu — *avant* que quoi que ce soit ne soit créé, avec un message d'erreur clair qui nomme la variable. Le tableau [*Configuration Pitfalls* du Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE) indique quelles combinaisons sont détectées de cette manière.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets, les jobs et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour ne comportent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

### Étape 1.0 — Choisir la configuration de votre lab {#step-10--choose-your-lab-configuration}

Choisissez un parcours selon la part du module que vous souhaitez mettre en œuvre. Les deux se rattachent à votre fondation `Services_GCP` via un `tenant_id` identique.

**Parcours A — Minimal (le plus rapide).** Valeurs par défaut : une charge de travail `Deployment` adossée à PostgreSQL (le Cloud SQL partagé), le NFS partagé et un job d'initialisation. Définissez uniquement `project_id` et `tenant_id`. Cela suffit pour parcourir les tâches 2 à 6.

**Parcours B — Complet (recommandé pour ce lab).** Met en œuvre l'étendue du moteur afin que chaque étape de vérification ait quelque chose à confirmer. Paramètres suggérés (tout le reste par défaut) :

```hcl
project_id           = "<your-project-id>"
tenant_id = "demo"          # MUST match your Services_GCP deployment

application_name     = "labgke"
application_version  = "1.0.0"

# Database — uses the shared Cloud SQL from Services_GCP (no per-deploy instance)
database_type        = "POSTGRES"
enable_cloudsql_volume = true

# Shared storage & cache (auto-discovered from Services_GCP)
enable_nfs           = true
enable_redis         = true
create_cloud_storage = true
storage_buckets      = [{ name_suffix = "data" }]

# Workload shape & scaling
# (leave stateful_pvc_enabled unset for a stateless Deployment; set it true to
#  exercise a StatefulSet with per-pod PVCs — do NOT also set workload_type)
min_instance_count   = 1
max_instance_count   = 3
enable_pod_disruption_budget = true    # reliability: keep a pod during disruptions

# Observability
uptime_check_config  = { enabled = true, path = "/healthz" }

# Access control (safe): IAP on GKE needs an OAuth client + support email — enforced
enable_iap           = true
iap_oauth_client_id     = "<oauth-client-id>"
iap_oauth_client_secret = "<oauth-client-secret>"
iap_support_email       = "<your-email>"
```

> **Option avancée facultative — domaine personnalisé + WAF/CDN.** `enable_custom_domain = true` (avec un domaine) provisionne un certificat géré par Google via la Gateway ; `enable_cloud_armor = true` et `enable_cdn = true` activent tous deux la Gateway et **aucun des deux n'exige de domaine personnalisé** — sans domaine, la Gateway obtient un certificat HTTPS `<ip>.nip.io` sans configuration. (La validation qui exigeait auparavant un domaine pour le CDN a été assouplie ; voir le commentaire 20 de `App_GKE/validation.tf`.) Ces options ajoutent un coût et une étape DNS après le déploiement — ne les activez que pour mettre en œuvre le chemin en périphérie.

> Le parcours B conserve IAP renseigné (pas de verrouillage) et laisse Binary Authorization / VPC-SC à leurs valeurs par défaut sûres. Les étapes de déploiement ci-dessous supposent le parcours B et signalent les vérifications propres à une fonctionnalité afin que les utilisateurs du parcours A puissent les ignorer.

### Étape 1.1 — Déployer {#step-11--deploy}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **App (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et `tenant_id`, et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   une base de données Cloud SQL facultative avec ses secrets Secret Manager, un stockage
   NFS/Redis/GCS facultatif, construit ou met en miroir l'image du conteneur et exécute les
   jobs d'initialisation configurés. Les premiers déploiements prennent environ **20–35 minutes**
   lorsque la création de Cloud SQL est incluse.

3. Connectez-vous au cluster et repérez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gkeapp | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

Vérifiez que chaque fonctionnalité que vous avez activée est bien opérationnelle. Les étapes marquées d'un indicateur ne s'appliquent qu'au parcours B (ou aux fonctionnalités que vous avez activées).

1. **Santé de la charge de travail.** Vérifiez que les pods sont `Running`/`Ready` et trouvez l'adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"   # expect 200 (or 403 if IAP is on)
   ```

2. **Forme de la charge de travail** — vérifiez que vous avez obtenu un `Deployment` (parcours A) ou un `StatefulSet` (`stateful_pvc_enabled = true`), ainsi que les PVC dans le cas d'un StatefulSet :

   ```bash
   kubectl get deploy,statefulset,pvc -n "$NS"
   ```

3. **Base de données** `[database_type != NONE]` — vérifiez la base de données et l'utilisateur propres à l'application dans le Cloud SQL partagé, et que le secret du mot de passe a été matérialisé dans l'espace de noms :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~db-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="table(name)"
   kubectl get secret -n "$NS" | grep -i db        # secret synced into the namespace
   ```

4. **Raccordement base de données / Redis / NFS** — vérifiez les variables d'environnement et les montages de volumes que la fondation a injectés dans le pod :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep -iE "DB_|REDIS_"   # DB_*/REDIS_* present
   kubectl describe pod "$POD" -n "$NS" | grep -iA2 "Mounts:"   # NFS / GCS / Cloud SQL volume mounts
   ```

5. **Job d'initialisation** — vérifiez que le job d'initialisation s'est terminé :

   ```bash
   kubectl get jobs -n "$NS"
   kubectl get job -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.succeeded}{"\n"}{end}'   # succeeded=1
   ```

6. **Contrôle d'accès IAP** `[enable_iap = true]` — une requête non authentifiée est bloquée ; une requête autorisée aboutit :

   ```bash
   curl -s -o /dev/null -w "anonymous: %{http_code}\n" "http://${EXTERNAL_IP}/"
   curl -s -o /dev/null -w "authed:    %{http_code}\n" -H "Authorization: Bearer $(gcloud auth print-identity-token)" "http://${EXTERNAL_IP}/"
   ```

7. **Test de disponibilité** `[uptime_check_config.enabled]` — vérifiez que le test de disponibilité (uptime check) Cloud Monitoring existe (Monitoring → Uptime checks, ou `gcloud monitoring uptime list-configs`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, les pods et (si activés) l'autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification de la charge de travail ; la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite ou mise en miroir et une mise à jour progressive remplace les
   pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gkeapp"
   kubectl get jobs,cronjobs -n "$NS"          # init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~gkeapp"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (lorsqu'une base de données est
   provisionnée) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Le module provisionne également un
   **test de disponibilité** (uptime check) (lorsqu'il est activé) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas selon la charge de travail déployée dans
le conteneur.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que les éventuelles jobs d'initialisation se sont terminés.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Échec du build ou de la mise en miroir de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec,
  sous Cloud Build → History.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity et que le
  compte de service de la charge de travail dispose des rôles IAM Secret Manager et Cloud SQL requis.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (elle fait oublier le déploiement à RAD). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL facultative, les secrets Secret Manager, les buckets GCS,
les Jobs Kubernetes et les images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Choisir la configuration et déployer | Automatisé | Choisir Minimal ou Complet ; le module se déploie dans le cluster GKE Autopilot partagé, se rattache au Cloud SQL/NFS/registre de la fondation, provisionne secrets/stockage et exécute les jobs d'initialisation |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; vérifier la santé et la forme de la charge de travail, la base de données + la synchronisation du secret, le raccordement base de données/Redis/NFS, la réussite du job d'initialisation, l'application d'IAP et le test de disponibilité |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer secrets/jobs/stockage, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification, de récupération d'image et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
