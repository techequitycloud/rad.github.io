---
title: "App GKE — Guide de lab"
description: "Labs pratiques : déployez un socle, puis choisissez des labs de fonctionnalités pour chaque groupe de configuration — chacun avec un objectif, des paramètres testés, une vérification, des pièges et des étapes de retour arrière — ainsi que les opérations, l'observabilité et la suppression."
---

<!-- translated-from: docs/labs/App_GKE.md @ 2be24ed1 sha256:c12a94017439 -->

# App GKE — Guide de lab {#app-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** parcours principal (Tâches 1–2) ~45–60 minutes ; chaque lab de fonctionnalité 10–40 minutes ; ensemble des labs ~12 heures.

`App GKE` est le **moteur de déploiement socle** pour tous les modules applicatifs GKE Autopilot de cette plateforme. Il provisionne une charge de travail Kubernetes prête pour la production (Deployment ou StatefulSet) sur GKE Autopilot pour toute application conteneurisée — avec en option Cloud SQL (PostgreSQL ou MySQL), du stockage partagé NFS, des buckets GCS et des montages GCS Fuse, des secrets Secret Manager synchronisés dans Kubernetes, des builds d'images et du CI/CD Cloud Build, Cloud Monitoring, ainsi qu'un équilibreur de charge Gateway API optionnel avec HTTPS, Identity-Aware Proxy et un WAF Cloud Armor. Les modules applicatifs tels que `Django_GKE` et `Ghost_GKE` appellent ce moteur en interne ; déployé directement, comme dans ce lab, il compile et exécute un **exemple d'application Flask intégré** (depuis le répertoire `scripts/` du module : `app.py` ainsi que son `Dockerfile`) afin que chaque fonctionnalité dispose d'une application réelle à tester.

L'application d'exemple écoute sur le port `8080` (gunicorn, exécuté sous l'utilisateur non-root `appuser`) et dessert quatre points de terminaison que vous utiliserez tout au long du lab :

| Point de terminaison | Ce qu'il renvoie | Utilisez-le pour prouver que |
|---|---|---|
| `/` | `Hello from Sample App! Visitor count: N` — incrémente un compteur dans la base de données à chaque requête | L'application répond **et** écrit dans Cloud SQL (en cas d'erreur de base de données, elle renvoie tout de même 200 avec `(DB unavailable: …)` dans le texte, lisez donc le corps) |
| `/healthz` | `{"status": "healthy"}` avec HTTP 200 | Le chemin de sonde et de test de santé de l'équilibreur de charge |
| `/db` | `{"status": "connected", "version": "PostgreSQL …"}`, ou HTTP 500 avec l'erreur | La connectivité à la base de données, isolée du compteur |
| `/whoami` | JSON avec `remote_addr`, les en-têtes de transfert et les **noms** des en-têtes de requête | Ce que l'équilibreur de charge / la Gateway transmet réellement au conteneur |

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur l'application d'exemple elle-même. Il s'agit de « plusieurs labs en un » : après un court parcours principal, vous choisissez les labs de fonctionnalités qui vous intéressent dans le menu.

> **Ce lab se déploie sur un socle `Services_GCP`.** Utilisez le **même `tenant_id`** que votre déploiement `Services_GCP` afin que `App GKE` se déploie dans le **cluster GKE Autopilot** partagé et se lie au VPC partagé, à l'instance Cloud SQL, au serveur NFS et à Artifact Registry au lieu de provisionner son propre cluster intégré (inline) et sa propre infrastructure. (Le mode autonome — `require_services_gcp_module = false` — crée un cluster GKE intégré (inline) et prend beaucoup plus de temps ; le but de ce lab est de mettre en pratique le module socle.)

> **Les entrées sont validées au moment du plan.** Le module rejette les valeurs et combinaisons non valides — `stateful_pvc_enabled` avec `workload_type = "Deployment"`, IAP sans client OAuth, une source d'image `prebuilt` sans image, un job `mount_nfs` avec `enable_nfs = false`, une valeur de mémoire ResourceQuota sous forme d'entier brut, VPA associé à un `min_instance_count` supérieur à 1, deux volumes montés sur le même chemin — *avant* que quoi que ce soit ne soit créé, avec une erreur claire indiquant la variable. Le tableau *Pièges de configuration* du [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE) indique quelles combinaisons sont interceptées de cette manière.

### Organisation de ce lab {#how-this-lab-is-organised}

- **Partie 1 — Cœur de configuration (Tâches 1–2).** Déployez un socle de référence et vérifiez-le. Tout le monde réalise cette partie ; chaque lab de fonctionnalité la prend pour acquise.
- **Partie 2 — Labs de fonctionnalités (Labs 2–22).** Un lab par groupe de variables, numéroté par groupe (Lab 4 = Groupe 4). Après le socle de référence, ils sont indépendants les uns des autres et peuvent être exécutés dans n'importe quel ordre ; chacun indique son objectif, sa durée, son coût et ses prérequis, et se termine par un **Retour arrière** afin de revenir au socle de référence. Lorsqu'un lab ultérieur s'appuie sur un lab précédent, cela est explicitement mentionné. Faites votre choix dans le menu ci-dessous.
- **Partie 3 — Exploiter, observer, dépanner, supprimer (Tâches 3–6).** Opérations de jour 2, journalisation et surveillance, modes de défaillance observés lorsque ce module a été testé groupe par groupe sur un projet réel, et une suppression propre qui inclut tout ce que les labs de fonctionnalités laissent derrière eux.

Le groupe 1 (projet et tenant) est couvert par la Tâche 1 plutôt que par un lab distinct. Les variables du groupe 0 correspondent au raccordement de la plateforme et ne sont jamais affichées sur le formulaire — voir l'[Annexe](#appendix--group-0-platform-wiring-variables).

### Menu des labs {#lab-menu}

| Lab | Groupe | Objectif (ce que vous serez capable de faire) | Durée | Coût additionnel ? | Configuration externe |
|---|---|---|---|---|---|
| [Lab 2](#lab-2--deployment-identity-group-2) | 2 | Router les alertes de surveillance vers des personnes et apposer des labels d'imputation des coûts sur chaque ressource, puis observer le tableau de bord et les alertes qui apparaissent | 15 min | Non (alerte/tableau de bord uniquement) | Aucune |
| [Lab 3](#lab-3--application-identity-group-3) | 3 | Renommer ce que voient les opérateurs (tableau de bord, descriptions) sans toucher aux noms des ressources, et comprendre quels champs d'identité sont immuables | 10 min | Non | Aucune |
| [Lab 4](#lab-4--runtime--scaling-group-4) | 4 | Dimensionner et mettre à l'échelle la charge de travail avec le HPA, choisir entre VPA et HPA, et apprendre quels paramètres d'exécution ne prennent effet qu'à la création | 30 min | Oui (pods supplémentaires) | Aucune |
| [Lab 5](#lab-5--environment-variables--secrets-group-5) | 5 | Injecter une configuration simple et des secrets Secret Manager dans le pod, et observer les valeurs ressemblant à des identifiants être déplacées automatiquement dans un Kubernetes Secret | 20 min | Négligeable | Aucune (vous créez un secret) |
| [Lab 6](#lab-6--gke-backend-config-group-6) | 6 | Façonner le Service Kubernetes (ports, affinité), la stratégie de déploiement et le délai de grâce, et verrouiller l'espace de noms avec une NetworkPolicy sans interrompre le trafic | 30 min | Non | Le maillage de services nécessite ASM (non disponible dans les projets gérés par RAD) |
| [Lab 7](#lab-7--statefulset--pvc-group-7) | 7 | Convertir la charge de travail en StatefulSet avec un disque persistant par pod et **prouver** la persistance par un cycle écriture–redémarrage–lecture | 35 min | Oui (un disque de 10 GiB par pod) | Aucune |
| [Lab 8](#lab-8--resource-quota-group-8) | 8 | Plafonner ce que l'espace de noms peut consommer avec une ResourceQuota dimensionnée pour que les mises à jour progressives fonctionnent toujours | 15 min | Non | Aucune |
| [Lab 9](#lab-9--reliability-group-9) | 9 | Maintenir l'application disponible pendant les mises à niveau des nœuds avec un PodDisruptionBudget et répartir les réplicas sur plusieurs zones | 20 min | Oui (un deuxième pod) | Aucune |
| [Lab 10](#lab-10--observability-group-10) | 10 | Ajuster les sondes de démarrage/vivacité/disponibilité (readiness) (qui pilotent également le test de santé de la Gateway), et ajouter un test de disponibilité et une alerte personnalisée | 25 min | Faible (test de disponibilité) | Aucune |
| [Lab 11](#lab-11--workload-automation-group-11) | 11 | Exécuter des jobs d'initialisation ordonnés, un CronJob planifié et un service frère que l'application joint via une URL injectée | 30 min | Faible (un pod supplémentaire) | Aucune |
| [Lab 12](#lab-12--cicd-group-12) | 12 | Activer Binary Authorization pour le cluster ; examiner le déclencheur Cloud Build piloté par GitHub et le pipeline Cloud Deploy | 20 min (BinAuthz) | Non | **Le CI/CD et Cloud Deploy nécessitent un dépôt GitHub + un jeton** |
| [Lab 13](#lab-13--nfs-storage-group-13) | 13 | Déplacer le montage NFS partagé, prouver que les fichiers survivent à un redémarrage, et voir pourquoi NFS est également ce qui fournit Redis | 20 min | Non | Aucune |
| [Lab 14](#lab-14--cloud-storage-group-14) | 14 | Provisionner un bucket, le monter dans le pod avec GCS Fuse, y écrire en tant qu'utilisateur applicatif non-root, et le chiffrer avec CMEK | 30 min | Faible (bucket, clé KMS) | Aucune |
| [Lab 15](#lab-15--redis-cache-group-15) | 15 | Pointer l'application vers un hôte/port Redis et voir comment la définition d'un mot de passe modifie ce qui est injecté | 15 min | Non | Aucune |
| [Lab 16](#lab-16--database-configuration-group-16) | 16 | Créer des alias pour les variables de connexion DB pour les applications aux noms non standard et exécuter une réelle rotation de mot de passe sans interruption | 40 min | Faible (job de rotation) | Aucune |
| [Lab 17](#lab-17--backup--maintenance-group-17) | 17 | Planifier le CronJob d'export de base de données, exécuter une sauvegarde à la demande, et restaurer la sauvegarde d'exemple fournie | 25 min | Faible (bucket de sauvegarde) | Aucune (un `backup.sql` d'exemple est prépositionné pour vous) |
| [Lab 18](#lab-18--custom-sql-scripts-group-18) | 18 | Exécuter vos propres scripts SQL ordonnés depuis un bucket GCS sur la base de données de l'application | 20 min | Négligeable | Vous prépositionnez un bucket |
| [Lab 19](#lab-19--access--networking-group-19) | 19 | Placer l'application derrière l'équilibreur de charge Gateway API avec un certificat HTTPS `nip.io` sans configuration (ou votre propre domaine) et contrôler son IP statique | 40 min | Oui (LB global + IP) | Propre domaine facultatif (enregistrement DNS) |
| [Lab 20](#lab-20--identity-aware-proxy-group-20) | 20 | Exiger une connexion Google devant l'application avec IAP | 30 min | Faible | **Écran de consentement OAuth + client OAuth** |
| [Lab 21](#lab-21--cloud-armor--cdn-group-21) | 21 | Associer un WAF Cloud Armor qui bloque les attaques SQLi/XSS et limite le débit, et observer ce que `enable_cdn` fait et ne fait pas | 35 min | Oui (règle Armor, LB) | Aucune |
| [Lab 22](#lab-22--vpc-service-controls--audit-logging-group-22) | 22 | Activer la journalisation d'audit du projet ; examiner un périmètre VPC Service Controls en mode simulation (dry-run) | 15 min | Oui (volume de logs) | **VPC-SC nécessite une organisation** |

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser chaque ressource qu'il provisionne — espace de noms, charge de travail, Service, Jobs, secrets, buckets, base de données.
- Vous connecter au cluster GKE et vérifier la charge de travail en cours d'exécution en relisant sa configuration réelle, et non en faisant aveuglément confiance à un apply réussi.
- Modifier n'importe quel groupe de paramètres avec **Update**, prédire si la modification est sans risque sur un déploiement en cours, et vérifier son effet.
- Configurer la mise à l'échelle, la persistance (NFS, disques par pod, GCS), les secrets, les jobs, les sondes et la surveillance pour une charge de travail GKE.
- Exposer la charge de travail via la Gateway API avec HTTPS, et la protéger avec IAP et Cloud Armor.
- Exploiter, observer, dépanner et supprimer le déploiement, y compris ce que les labs de fonctionnalités laissent derrière eux.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si ce
  n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés, ainsi que le composant **`gke-gcloud-auth-plugin`** (`gcloud components install gke-gcloud-auth-plugin`) afin que `kubectl` puisse s'authentifier auprès de GKE ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Rôle IAM **Project Owner** (ou équivalent) sur le projet — vous avez besoin d'un accès de niveau `container.developer` au cluster pour exécuter les vérifications `kubectl`.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Project Owner, puis cliquez sur **Verify**) et d'attribuer au compte de service de déploiement RAD le rôle **Owner**. Un projet que RAD crée pour vous ne nécessite aucune de ces étapes.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version dans les tâches du jour 2 — sont modifiés ultérieurement via **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, accessible à tout compte tant que les builds sont inclus dans le prix (sur un environnement de lab, seul un administrateur peut l'utiliser). Les mises à jour n'entraînent jamais de frais de module.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables de shell une seule fois ; chaque tâche et lab ci-dessous les réutilise. Exécutez le deuxième bloc **après** que la Tâche 1 est terminée, car il découvre des noms qui n'existent qu'une fois le module déployé :

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"           # the region you deploy into
export TENANT="demo"                  # tenant_id — must match your Services_GCP deployment
export APP="gkeapp"                   # application_name (the module default)
```

```bash
# Connect kubectl to the shared Services_GCP cluster
CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
LOCATION=$(gcloud container clusters list --project="$PROJECT" --format="value(location)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$LOCATION" --project="$PROJECT"

# Names the module derives (verified in code):
#   SERVICE = application_name + tenant_id + 8-hex hash   (e.g. gkeappdemo1a2b3c4d)
#   NS      = SERVICE (unless you set namespace_name)
#   PREFIX  = tenant_id + 8-hex hash — the TENANT-scoped prefix used for the
#             Gateway, NetworkPolicy, PDB and the synced "<PREFIX>-secrets" Secret
export NS=$(kubectl get ns -o name | sed 's|^namespace/||' | grep -E "^${APP}${TENANT}[0-9a-f]{8}$" | head -1)
export SERVICE="$NS"
export PREFIX="${SERVICE#"$APP"}"
export WL="deploy/$SERVICE"           # becomes sts/$SERVICE in Lab 7
echo "Cluster=$CLUSTER  NS=$NS  SERVICE=$SERVICE  PREFIX=$PREFIX"
```

> Le conteneur applicatif porte le nom de `application_name` (`$APP`) et n'a **pas de binaire `curl`** (il est basé sur `python:3.11-slim`). Les vérifications HTTP à l'intérieur du pod dans ce lab utilisent donc `python3 -c "import urllib.request; …"`.

## Comment modifier les paramètres dans les labs de fonctionnalités {#how-to-change-settings-in-the-feature-labs}

- **Le flux Update.** Ouvrez le déploiement depuis la page **Deployments**, cliquez sur **Update**, cochez **Enable advanced mode** pour que tous les groupes soient affichés, modifiez uniquement les paramètres indiqués par le lab, puis soumettez. La plateforme recalcule le plan et applique le module sur le même déploiement. Les extraits HCL de chaque lab indiquent les valeurs à saisir ; chaque ligne correspond à un champ de formulaire portant le même nom.
- **Sécurisé pour la mise à jour (Update-safe) ou non.** Le tableau des paramètres de chaque lab comporte une colonne **Update-safe** issue des métadonnées du module lui-même. Un champ marqué comme sécurisé pour la mise à jour peut être modifié sur un déploiement en cours. Un champ **sans** ce drapeau affiche un avertissement avant que vous ne le modifiiez, car le changement peut détruire ou remplacer une ressource (un bucket, la charge de travail, une adresse IP). Lorsque le déploiement est configuré sur **Enforce Update Safe**, les champs non marqués sont en lecture seule — il s'agit d'une protection de la plateforme pour un déploiement en production, pas d'un bug. Dans un projet de lab, lisez l'avertissement, comprenez ce qui sera remplacé, puis poursuivez.
- **Certains champs sont masqués dans les projets gérés par RAD.** Quelques paramètres (VPC-SC, maillage de services, `protect_sensitive_environment_variables`) sont retirés du formulaire lorsque le projet est géré par RAD et sont rétablis côté serveur lors de la mise à jour. Ils sont toujours documentés ci-dessous ; exécutez ces parties dans votre propre projet.
- **La validation au moment du plan fait partie de l'apprentissage.** Si une combinaison n'est pas valide, la mise à jour échoue dès l'étape du **plan** avec une erreur nommant les variables, et rien n'est modifié. Plusieurs labs vous en présentent délibérément une.
- **Un lab à la fois.** Appliquez un lab, vérifiez-le, puis effectuez le **Retour arrière** (ou conservez-le si un lab ultérieur indique qu'il s'appuie dessus). Mélanger les labs rend difficile l'identification de la cause de chaque effet.
- **Vérifiez en relisant la ressource déployée.** Chaque étape de vérification lit l'objet en direct — `kubectl get … -o jsonpath`, `gcloud … describe`, une variable d'environnement à l'intérieur du pod, un `curl` sur le point de terminaison, ou un cycle écriture–redémarrage–lecture pour le stockage. Lorsque ce module a été testé groupe par groupe, plusieurs paramètres se sont appliqués avec succès sans rien changer (ils sont signalés dans la section *Attention à* de chaque lab). Un apply réussi n'est pas une preuve.

---

## Tâche 1 — Déployer le socle de référence [Automatisé] {#task-1--deploy-the-baseline-automated}

### Étape 1.1 — Paramètres du socle de référence {#step-11--baseline-settings}

Définissez uniquement les entrées du **Groupe 1** et laissez tout le reste à sa valeur par défaut :

```hcl
project_id = "<your-project-id>"
tenant_id  = "demo"          # MUST match your Services_GCP deployment
region     = "us-central1"   # used when the Services_GCP subnet region cannot be discovered
```

Voilà l'intégralité du Groupe 1 — il n'y a pas de lab dédié au Groupe 1. Le `tenant_id` est composé de 1 à 7 lettres minuscules ou chiffres et est intégré dans chaque nom de ressource (la limite d'identifiant de compte de service GCP fixe le plafond à 7 caractères) ; **ne le modifiez jamais après le déploiement**.

Les valeurs par défaut vous fournissent ensuite :

| Élément | Valeur par défaut | Ce que vous obtenez |
|---|---|---|
| Image | `container_image_source = "custom"`, `application_version = "1.0.0"` | Cloud Build compile l'application Flask d'exemple depuis le répertoire `scripts/Dockerfile` du module et la pousse vers l'Artifact Registry partagé |
| Charge de travail | `workload_type = null`, `stateful_pvc_enabled = null` | Un **Deployment**, 1 réplica, HPA `min 1 / max 3` sur CPU 70 % / mémoire 80 % |
| Déploiement progressif | `deployment_strategy = null` | **Recreate** — déduit car l'application monte du NFS (deux pods sur un même partage peuvent bloquer une mise à jour progressive) |
| Ressources | `container_resources` | `1000m` CPU / `512Mi` de mémoire (les requêtes correspondent par défaut aux limites) |
| Service | `service_type = "LoadBalancer"`, `reserve_static_ip = true` | Un équilibreur de charge externe L4 sur une IP statique réservée nommée `<SERVICE>-lb-ip`, port `80` → conteneur `8080` |
| Base de données | `database_type = "POSTGRES"`, `enable_cloudsql_volume = true` | Une base de données et un utilisateur (tous deux nommés d'après `SERVICE`) dans l'instance Cloud SQL partagée, accessible via un sidecar Cloud SQL Auth Proxy sur `127.0.0.1` |
| Jobs | Valeur par défaut `initialization_jobs` | Jobs Kubernetes `<SERVICE>-db-create` (socle), `<SERVICE>-db-init` (script d'exemple) et `<SERVICE>-nfs-setup` |
| Stockage | `enable_nfs = true`, `create_cloud_storage = true` | Le partage NFS partagé monté sur `/mnt/nfs` (une sous-arborescence `/share/<SERVICE>` dédiée à l'application), plus un bucket de sauvegarde `gcs-<SERVICE>-backups` |
| Cache | `enable_redis = true` | `REDIS_HOST`/`REDIS_PORT`/`REDIS_URL` pointant vers le Redis co-hébergé sur la VM NFS de Services_GCP |
| Sondes | `startup_probe_config`, `health_check_config` | Sondes HTTP sur `/healthz` |
| Fiabilité | `enable_pod_disruption_budget = true` | Un PDB nommé `<PREFIX>-pdb` (créé car `max_instance_count` > 1) |

### Étape 1.2 — Déployer {#step-12--deploy}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **App (GKE)** depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et `tenant_id`, puis vérifiez les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/App_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, crée la base de données et son secret Secret Manager, compile l'image de conteneur et exécute les jobs d'initialisation. Un premier déploiement prend environ **20–35 minutes** (davantage si `Services_GCP` est provisionné en premier). Sur un cluster flambant neuf, la première application GKE peut nécessiter un second apply pour se terminer (le module d'extension de synchronisation Secret Manager s'enregistre lors du premier) — le pipeline de la plateforme exécute cette seconde passe pour vous.

3. Lorsque la page d'état indique le succès, exécutez le **deuxième bloc de shell** des Prérequis pour connecter `kubectl` et découvrir les noms, puis réalisez un inventaire :

   ```bash
   kubectl get deploy,sts,pods,svc,hpa,pdb,jobs,cronjobs -n "$NS"
   ```

   Résultat attendu : un Deployment `$SERVICE`, un pod `2/2 Running` (l'application plus le sidecar `cloud-sql-proxy`), un Service `LoadBalancer` `$SERVICE` avec une IP externe, un HPA `$SERVICE` (`1/3`), un PDB `$PREFIX-pdb`, trois Jobs `Complete` et un CronJob `$SERVICE-db-export` (la sauvegarde de la base de données).

> **Si l'espace de noms n'existe pas après un apply « réussi »**, consultez la *Tâche 5 → L'apply a réussi mais il n'y a pas de charge de travail*. Il s'agissait de la défaillance la plus grave observée lors des tests, et le module échoue désormais lors du plan au lieu d'ignorer silencieusement la charge de travail.

---

## Tâche 2 — Accéder au socle de référence et le vérifier [Manuel] {#task-2--access--verify-the-baseline-manual}

1. **Santé de la charge de travail et adresse externe :**

   ```bash
   kubectl get pods -n "$NS" -l app="$APP" -o wide          # 2/2 Running, 0 restarts
   export LB_IP=$(kubectl get svc "$SERVICE" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "LB_IP=$LB_IP"
   gcloud compute addresses list --project="$PROJECT" --filter="name=$SERVICE-lb-ip" \
     --format="table(name,address,status)"                    # same address, IN_USE
   ```

2. **Les quatre points de terminaison** — lisez les corps des réponses, pas seulement les codes d'état :

   ```bash
   curl -s "http://$LB_IP/"; echo                            # Hello from Sample App! Visitor count: 1
   curl -s "http://$LB_IP/"; echo                            # ... Visitor count: 2  (the DB write works)
   curl -s "http://$LB_IP/healthz"; echo                     # {"status":"healthy"}
   curl -s "http://$LB_IP/db"; echo                          # {"status":"connected","version":"PostgreSQL ..."}
   curl -s "http://$LB_IP/whoami"; echo                      # remote_addr is your public IP (L4 LB preserves it)
   ```

   Si `/` indique `(DB unavailable: …)`, l'application est active mais la liaison vers la base de données ne l'est pas — rendez-vous à la Tâche 5.

3. **Le chemin de la sonde renvoie un 200 textuel sur l'IP du pod.** Le kubelet de GKE accepte tout code 2xx/3xx, mais un test de santé d'équilibreur de charge Google (utilisé à partir du Lab 19) nécessite exactement `200` :

   ```bash
   kubectl exec -n "$NS" "$WL" -c "$APP" -- python3 -c \
     "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/healthz').status)"   # 200
   ```

4. **Base de données, utilisateur et secret.** La base de données et l'utilisateur sont nommés d'après `SERVICE` (les tirets deviennent des traits de soulignement) — **pas** d'après `application_database_name`/`application_database_user` :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --filter="databaseVersion~POSTGRES" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
   gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)" | grep -v github | head -1)
   echo "DB password secret: $DB_SECRET"
   kubectl get secret "$PREFIX-secrets" -n "$NS"              # the Secret Manager → Kubernetes sync target
   ```

5. **Ce que le module a injecté dans le conteneur :**

   ```bash
   kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'env | grep -E "^(DB_|REDIS_|NFS_|GKE_SERVICE_URL)" | sed -E "s/(PASSWORD=).*/\1***/" | sort'
   ```

   Attendu : `DB_HOST=127.0.0.1` (le sidecar proxy), `DB_NAME`/`DB_USER` = le nom du service, `DB_PASSWORD` (depuis le Secret synchronisé), `REDIS_HOST` = `NFS_SERVER_IP`, et `GKE_SERVICE_URL=http://<LB_IP>`.

6. **Volumes et jobs :**

   ```bash
   kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{range .items[0].spec.containers[0].volumeMounts[*]}{.mountPath}{"\t"}{.name}{"\n"}{end}'
   kubectl get jobs -n "$NS" -o custom-columns=NAME:.metadata.name,SUCCEEDED:.status.succeeded
   kubectl logs -n "$NS" job/"$SERVICE"-db-init --all-containers | tail -5
   ```

   Attendu : `/mnt/nfs` (`nfs-data-volume`) parmi les montages et chaque Job avec `SUCCEEDED 1`.

7. **L'image :**

   ```bash
   kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
   gcloud builds list --project="$PROJECT" --region="$REGION" --limit=3 --format="table(id,status,createTime)"
   ```

Vous disposez désormais du socle de référence sur lequel démarre chaque lab de fonctionnalité.

---

## Partie 2 — Labs de fonctionnalités {#part-2--feature-labs}

### Lab 2 — Identité de déploiement (Groupe 2) {#lab-2--deployment-identity-group-2}

> **Objectif :** Envoyer des alertes de surveillance à des personnes désignées et appliquer des labels d'imputation des coûts sur chaque ressource créée par le module.

**Vous allez :** ajouter `support_users` et voir apparaître les canaux de notification, les alertes par défaut et le tableau de bord GKE · ajouter `resource_labels` et confirmer qu'ils sont appliqués à un espace de noms, un Deployment et un bucket **déjà existants**.
**Durée :** 15 min · **Coût :** aucun au-delà des objets d'alerte/tableau de bord · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `support_users` | `[]` | Oui | Destinataires e-mail des alertes Cloud Monitoring. Une liste non vide active également la surveillance : un canal de notification e-mail par adresse, des alertes d'utilisation CPU et mémoire, et un tableau de bord GKE. N'accorde aucun accès IAM. |
| `resource_labels` | `{ env = "dev" }` | Oui | Labels fusionnés dans les labels de chaque ressource (aux côtés des labels propres au module `application`, `deployment`, `tenant`, `managed-by`, `module`). |

`tenant_id`, documenté avec ce groupe dans le Guide de configuration, est un champ du Groupe 1 sur le formulaire — voir Tâche 1.

#### Étape 1 — Configurer {#step-1--configure}

```hcl
support_users = ["<your-email>"]          # receives alert notifications
resource_labels = {
  env       = "lab"                       # overrides the default env = "dev"
  cost-team = "platform"                  # any lowercase key/value pair
}
```

#### Étape 2 — Appliquer {#step-2--apply}

Cliquez sur **Update**. Attendez-vous à ce que des canaux de notification, deux règles d'alerte et un tableau de bord soient **créés**, et que les labels soient **mis à jour sur place** sur l'espace de noms, le Deployment, les objets de compte de service et les buckets. Rien n'est remplacé. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify}

```bash
# Labels reached the live Kubernetes objects (they existed before this update)
kubectl get ns "$NS" --show-labels | tr ',' '\n' | grep -E "env=|cost-team="
kubectl get "$WL" -n "$NS" -o jsonpath='{.metadata.labels}{"\n"}'          # contains cost-team: platform

# ...and a GCS bucket
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format="yaml(labels)"

# Monitoring objects created by support_users
gcloud beta monitoring channels list --project="$PROJECT" --filter="displayName~$SERVICE" \
  --format="table(displayName,type,labels.email_address)"
gcloud alpha monitoring policies list --project="$PROJECT" --filter="displayName~$SERVICE" \
  --format="table(displayName,enabled)"                                      # cpu- and memory-utilization-alert
gcloud monitoring dashboards list --project="$PROJECT" --format="value(displayName)" | grep "GKE Dashboard"
```

Attendu : les deux labels présents sur les trois éléments ; un canal `$SERVICE-notification-0` avec votre adresse ; `$SERVICE-cpu-utilization-alert` et `$SERVICE-memory-utilization-alert` ; un tableau de bord `App_GKE Application - GKE Dashboard (…)`. Google envoie un e-mail de vérification aux nouvelles adresses de notification.

#### Pour aller plus loin {#explore-further}

- Ajoutez une deuxième adresse et confirmez qu'un deuxième canal `…-notification-1` apparaît.
- Ouvrez le tableau de bord dans **Monitoring → Dashboards** et générez du trafic (`for i in $(seq 50); do curl -s "http://$LB_IP/" >/dev/null; done`) pour voir évoluer les graphiques de requêtes et de CPU.

#### Attention à {#watch-out-for}

- Les labels doivent être composés de clés/valeurs en minuscules (règles de labels GCP). Un label non valide fait échouer l'apply sur la première ressource GCP qui le rejette.
- `support_users` sert uniquement aux alertes. L'accès à l'application est contrôlé par IAP (Lab 20), et non par cette liste.

#### Retour arrière {#revert}

```hcl
support_users   = []
resource_labels = { env = "dev" }
```

Le retour arrière supprime les canaux, les alertes et le tableau de bord (à moins qu'une autre fonctionnalité de surveillance — un test de disponibilité ou `alert_policies` — ne maintienne la surveillance activée).

---

### Lab 3 — Identité de l'application (Groupe 3) {#lab-3--application-identity-group-3}

> **Objectif :** Modifier ce que les opérateurs voient concernant l'application sans perturber aucun nom de ressource, et savoir quel champ d'identité ne doit jamais changer.

**Vous allez :** définir un nom d'affichage et une description et voir où ils apparaissent · comprendre pourquoi `application_name` est figé · observer le comportement de `application_version` lors d'un build personnalisé.
**Durée :** 10 min · **Coût :** aucun · **Prérequis / configuration externe :** `support_users` du Lab 2 permet l'existence du tableau de bord, sur lequel le nom d'affichage apparaît.

#### Paramètres de ce groupe {#settings-in-this-group-1}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `application_name` | `"gkeapp"` | **Non** | Base de chaque nom dédié à l'application (`SERVICE`, espace de noms, base de données, buckets, nom d'image). Le modifier crée un déploiement entièrement nouveau à côté de l'ancien avec une base de données vide. À définir uniquement lors de la création. |
| `application_display_name` | `"App_GKE Application"` | Oui | Nom lisible par un humain utilisé dans le titre du tableau de bord de surveillance et la description de l'IP statique. |
| `application_description` | `"App_GKE Custom Application - Flask App with Database"` | Oui | Description en texte libre pour la plateforme et la documentation. |
| `application_version` | `"1.0.0"` | Oui | Tag de l'image. Avec `container_image_source = "custom"`, une nouvelle valeur déclenche un Cloud Build et un déploiement progressif. |

#### Étape 1 — Configurer {#step-1--configure-1}

```hcl
application_display_name = "Lab GKE App"                       # shows up in the dashboard title
application_description  = "App_GKE lab deployment"            # documentation only
```

#### Étape 2 — Appliquer {#step-2--apply-1}

**Update**. Seul le tableau de bord est mis à jour sur place ; aucun changement sur la charge de travail. ~3 minutes.

#### Étape 3 — Vérifier {#step-3--verify-1}

```bash
gcloud monitoring dashboards list --project="$PROJECT" --format="value(displayName)" | grep "Lab GKE App"
kubectl get "$WL" -n "$NS" -o jsonpath='{.metadata.name}{"\n"}'     # still $SERVICE — names did not move
```

#### Pour aller plus loin {#explore-further-1}

- **Incrémentation de version :** définissez `application_version = "1.0.1"`. Surveillez **Cloud Build → History** pour observer un nouveau build, puis confirmez le nouveau tag : `kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}'`. Les pods utilisent `imagePullPolicy: Always` pour les images personnalisées, de sorte qu'une image recompilée sous un tag réutilisé est tout de même récupérée.

#### Attention à {#watch-out-for-1}

- Une incrémentation de version recompile l'image — cela teste Cloud Build autant que le module. Si le build échoue, la charge de travail conserve l'image précédente.
- Le socle de référence utilise la stratégie **Recreate** (NFS est monté), de sorte qu'un déploiement de version subit une brève interruption pendant que l'ancien pod s'arrête avant que le nouveau ne démarre.

#### Retour arrière {#revert-1}

```hcl
application_display_name = "App_GKE Application"
application_description  = "App_GKE Custom Application - Flask App with Database"
application_version      = "1.0.0"     # only if you bumped it; triggers another build
```

---

### Lab 4 — Exécution & Mise à l'échelle (Groupe 4) {#lab-4--runtime--scaling-group-4}

> **Objectif :** Contrôler le nombre de pods exécutés et leur taille, choisir entre la mise à l'échelle automatique horizontale (HPA) et verticale (VPA), et apprendre quels paramètres d'exécution ne sont appliqués que lors de la création de la charge de travail.

**Vous allez :** augmenter le plancher et le plafond du HPA et observer l'apparition d'un deuxième pod · allonger le délai d'expiration de l'équilibreur de charge · tenter de redimensionner un pod en cours d'exécution et comprendre pourquoi il ne change pas · voir le plan refuser VPA avec un minimum supérieur à 1.
**Durée :** 30 min · **Coût :** chaque pod supplémentaire est facturé selon les CPU/mémoire demandés (Autopilot facture les requêtes) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-2}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `deploy_application` | `true` | **Non** | `false` provisionne l'infrastructure sous-jacente (base de données, stockage, espace de noms) sans la charge de travail. |
| `container_image_source` | `"custom"` | **Non** | `custom` compile avec Cloud Build ; `prebuilt` déploie `container_image` tel quel (le plan échoue s'il est vide). |
| `container_image` | `""` | Oui | URI de l'image pour `prebuilt`, ou image source lors d'une mise en miroir. |
| `container_build_config` | `{ enabled = true }` | Oui | Paramètres Cloud Build : `dockerfile_path`, `dockerfile_content`, `context_path`, `build_args`, `artifact_repo_name`, `base_image`. |
| `enable_image_mirroring` | `true` | **Non** | Copie une image externe dans Artifact Registry avant le déploiement (évite les limites de requêtes de Docker Hub). |
| `min_instance_count` | `1` | Oui | HPA `minReplicas`. Le plancher du HPA n'est jamais inférieur à 1 — `0` est traité comme 1 sur GKE. |
| `max_instance_count` | `3` | Oui | HPA `maxReplicas` ; correspond également au plafond de coût. Doit être ≥ min (vérifié lors du plan). |
| `enable_vertical_pod_autoscaling` | `false` | **Non** | Crée un VPA (`<SERVICE>-vpa`) et **supprime le HPA** — la charge de travail évolue alors verticalement, jamais horizontalement. Refusé au moment du plan si `min_instance_count` est supérieur à 1. |
| `container_port` | `8080` | Oui | Port sur lequel le conteneur écoute ; le Service le cible. Doit correspondre à l'application (le gunicorn de l'exemple se lie au 8080). |
| `container_protocol` | `"http1"` | Oui | `h2c` annonce `appProtocol: kubernetes.io/h2c` sur le port du Service afin que les backends Gateway communiquent en HTTP/2 en clair (gRPC). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Oui (drapeau) — mais **à la création uniquement**, voir ci-dessous | Limites plus `cpu_request` optionnels, `mem_request` (remarque : `mem_request`, pas `memory_request`), `ephemeral_storage_limit`, `ephemeral_storage_request`. Les requêtes correspondent par défaut aux limites. |
| `timeout_seconds` | `300` | Oui | Délai d'expiration du backend écrit dans `GCPBackendPolicy` (`timeoutSec`) de la Gateway. Prend effet dès que la Gateway existe (Labs 19–21). |
| `enable_cloudsql_volume` | `true` | Oui | Ajoute le sidecar Cloud SQL Auth Proxy ; l'application joint la DB sur `127.0.0.1`. Doit être `false` lorsque `database_type = "NONE"` (vérification au plan). |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Oui | Paramètre du chemin de socket. Sur GKE, le proxy écoute sur le loopback TCP et ce chemin n'est pas monté dans le conteneur de l'application, il n'a donc aucun effet visible. |
| `cloud_sql_proxy_version` | `"2-alpine"` | Oui | Tag de l'image du sidecar proxy (reflétée dans Artifact Registry). |
| `service_annotations` | `{}` | **Non** | Annotations sur le Service Kubernetes. **Appliquées uniquement lors de la création du Service.** |
| `service_labels` | `{ env = "dev" }` | **Non** | Labels sur le Service Kubernetes. **Appliqués uniquement lors de la création du Service.** |

`deployment_timeout`, listé ici dans le Guide de configuration, est un champ du Groupe 6 sur le formulaire (Lab 6).

#### Étape 1 — Configurer {#step-1--configure-2}

```hcl
min_instance_count = 2          # HPA floor: a second pod starts
max_instance_count = 5          # HPA ceiling / cost cap
timeout_seconds    = 600        # LB backend timeout (visible from Lab 19 on)
container_resources = {
  cpu_limit    = "2000m"        # attempt to resize the RUNNING pod (see Verify)
  memory_limit = "1Gi"
  cpu_request  = "500m"
  mem_request  = "512Mi"        # mem_request — a misspelt key is silently dropped
}
```

#### Étape 2 — Appliquer {#step-2--apply-2}

**Update**. Le HPA est mis à jour sur place et met à l'échelle le Deployment à 2 pods en une ou deux minutes. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-2}

```bash
kubectl get hpa "$SERVICE" -n "$NS"                                   # MINPODS 2  MAXPODS 5  REPLICAS 2
kubectl get pods -n "$NS" -l app="$APP"                               # two pods, 2/2 Running

# Did the resource change reach the running pods?
kubectl get pods -n "$NS" -l app="$APP" -o custom-columns=\
"NAME:.metadata.name,CPU_REQ:.spec.containers[0].resources.requests.cpu,MEM_REQ:.spec.containers[0].resources.requests.memory,CPU_LIM:.spec.containers[0].resources.limits.cpu,MEM_LIM:.spec.containers[0].resources.limits.memory"
```

Attendu : le HPA affiche `2/5` et deux pods fonctionnent. Les colonnes de ressources affichent toujours les tailles **d'origine** (environ `1` CPU / `512Mi`, telles que normalisées par Autopilot) : le module ignore les modifications ultérieures apportées au bloc `resources` du conteneur, car GKE Autopilot le réécrit après admission. L'apply a réussi sans signaler de dérive — il s'agit du comportement documenté à la création uniquement, constaté lors des tests.

#### Pour aller plus loin {#explore-further-2}

- **Prouvez le garde-fou du plan :** définissez `enable_vertical_pod_autoscaling = true` alors que `min_instance_count = 2`. La mise à jour échoue au plan avec *"enable_vertical_pod_autoscaling = true removes the HorizontalPodAutoscaler … min_instance_count = 2 would be SILENTLY IGNORED"*. Essayez ensuite `min_instance_count = 1` avec VPA activé : cela s'applique, `kubectl get vpa -n "$NS"` affiche `$SERVICE-vpa`, et `kubectl get hpa -n "$NS"` indique **No resources found**.
- **Pour redimensionner réellement un pod**, le gabarit de pod doit être recréé — par exemple en basculant `workload_type` (Lab 7), ce qui crée une nouvelle charge de travail prenant en compte le `container_resources` actuel. Dans un workflow Terraform autogéré, vous auriez altéré (taint) le Deployment.
- **Image préconstruite :** `container_image_source = "prebuilt"` avec un `container_image` vide fait échouer le plan — essayez-le pour voir le message. Une véritable image préconstruite doit écouter sur `container_port` et répondre au chemin de sonde, sinon le déploiement ne devient jamais Ready.

#### Attention à {#watch-out-for-2}

- `container_resources`, `service_annotations` et `service_labels` s'appliquent **à la création uniquement** sur un déploiement existant : apply réussi, aucun diff, aucun changement.
- Sur Autopilot, vous payez pour les **requêtes (requests)**. Laisser les requêtes non définies les aligne sur les limites.
- `max_instance_count` × les connexions DB par pod doivent rester sous la valeur `max_connections` de Cloud SQL.

#### Retour arrière {#revert-2}

```hcl
min_instance_count = 1
max_instance_count = 3
timeout_seconds    = 300
container_resources = { cpu_limit = "1000m", memory_limit = "512Mi" }
enable_vertical_pod_autoscaling = false     # if you tried it — this recreates the HPA
```

Le HPA repasse à un pod.

---

### Lab 5 — Variables d'environnement & Secrets (Groupe 5) {#lab-5--environment-variables--secrets-group-5}

> **Objectif :** Transmettre la configuration et les secrets au pod en toute sécurité — les valeurs simples sous forme de variables d'environnement, les secrets Secret Manager via la synchronisation GKE Secret Manager, et les valeurs simples ressemblant à des identifiants extraites automatiquement de la spécification du pod.

**Vous allez :** créer un secret Secret Manager et l'injecter sous forme de variable d'environnement · ajouter des variables d'environnement simples · observer une valeur nommée comme un jeton devenir un `secretKeyRef` · consulter le calendrier de rotation.
**Durée :** 20 min · **Coût :** négligeable (un secret) · **Prérequis / configuration externe :** aucun — vous créez le secret à l'Étape 1.

#### Paramètres de ce groupe {#settings-in-this-group-3}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `environment_variables` | `{}` | Oui | Variables d'environnement simples sur le conteneur de l'application. `$(GKE_SERVICE_URL)` à l'intérieur d'une valeur est remplacé par l'URL du service. |
| `secret_environment_variables` | `{}` | Oui | Nom de variable d'environnement → **nom du secret** Secret Manager. La valeur est synchronisée dans le Secret `<PREFIX>-secrets` de l'espace de noms et injectée avec `secretKeyRef` ; le compte de service de la charge de travail obtient l'accès à chaque secret nommé. |
| `secret_rotation_period` | `"2592000s"` | Oui | Période de notification de rotation sur les secrets gérés par le module (le suffixe `s` est requis). Publie une notification ; ne fait tourner aucun secret en soi — voir le Lab 16 pour une véritable rotation de mot de passe DB. |
| `secret_propagation_delay` | `30` | Oui | Secondes d'attente après la création/mise à jour d'un secret avant l'exécution des étapes dépendantes. |
| `protect_sensitive_environment_variables` | `true` | Oui · masqué dans les projets gérés par RAD | Déplace toute entrée `environment_variables` dont le nom se termine par `PASSWORD`, `PASS`, `SECRET`, `TOKEN`, `API_KEY`, `PRIVATE_KEY`, `ACCESS_KEY`, `CLIENT_SECRET`, `CREDENTIALS`… dans le Secret Kubernetes `<PREFIX>-explicit-secrets`, injecté sous le même nom. |

#### Étape 1 — Configurer {#step-1--configure-3}

Créez d'abord le secret (une référence à un secret manquant fait échouer le déploiement). Épinglez le réplica à votre région — les projets gérés par RAD refusent les secrets répliqués globalement :

```bash
printf 'lab-secret-value' | gcloud secrets create lab-gke-api-key --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

Puis dans **Update** :

```hcl
environment_variables = {
  LAB_GROUP     = "5"                       # plain config, visible in the pod spec
  LAB_SELF_URL  = "$(GKE_SERVICE_URL)/db"   # sentinel replaced with the service URL
  LAB_API_TOKEN = "not-really-secret"       # name ends in _TOKEN -> moved to a Secret
}
secret_environment_variables = {
  LAB_API_KEY = "lab-gke-api-key"           # env name -> Secret Manager secret name
}                                           # use single underscores: the sync rejects "__"
secret_propagation_delay = 45
```

#### Étape 2 — Appliquer {#step-2--apply-3}

**Update**. Le secret est ajouté au SecretSync, les Secrets Kubernetes sont mis à jour et le pod est redéployé. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-3}

```bash
# Values the app sees
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'printenv LAB_GROUP LAB_SELF_URL LAB_API_KEY LAB_API_TOKEN'
# -> 5 / http://<LB_IP>/db / lab-secret-value / not-really-secret

# How each one is delivered in the pod spec
kubectl get "$WL" -n "$NS" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\t"}{.value}{.valueFrom.secretKeyRef.name}{"\n"}{end}' \
  | grep -E "^LAB_"
# LAB_GROUP      5
# LAB_SELF_URL   http://<LB_IP>/db
# LAB_API_KEY    <PREFIX>-secrets            (synced from Secret Manager)
# LAB_API_TOKEN  <PREFIX>-explicit-secrets   (moved out of plain text)

kubectl get secret "$PREFIX-secrets" -n "$NS" -o jsonpath='{.data}' | tr ',' '\n' | grep -o '"LAB_API_KEY"'
gcloud secrets get-iam-policy lab-gke-api-key --project="$PROJECT" \
  --format="table(bindings.role,bindings.members)"                    # gke-sa-... has secretAccessor
gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(rotation)"
```

Un pod à l'état `2/2 Running` constitue en soi une preuve ici : une `secretKeyRef` impossible à résoudre empêche un pod de démarrer.

#### Pour aller plus loin {#explore-further-3}

- Ajoutez une nouvelle version au secret (`printf 'v2' | gcloud secrets versions add lab-gke-api-key --data-file=- --project="$PROJECT"`). La synchronisation Secret Manager → Kubernetes effectue une rotation environ toutes les **120 s**, donc en ~1–2 minutes `kubectl get secret "$PREFIX-secrets" -n "$NS" -o jsonpath='{.data.LAB_API_KEY}' | base64 -d` affiche `v2`. Le processus **en cours d'exécution** conserve l'ancienne valeur — les variables d'environnement sont lues au démarrage — jusqu'à ce que vous le redémarriez : `kubectl rollout restart "$WL" -n "$NS"`.
- Essayez un nom avec un double trait de soulignement (`LAB__KEY`) et observez le rejet par la synchronisation.

#### Attention à {#watch-out-for-3}

- Le secret référencé doit exister avant la mise à jour ; sinon, le plan ou le démarrage du pod échoue.
- `secret_rotation_period` ne fait tourner aucun secret — il planifie uniquement des notifications.
- Les valeurs renouvelées atteignent le Secret Kubernetes en ~2 minutes mais n'atteignent le **pod** qu'au redémarrage.

#### Retour arrière {#revert-3}

```hcl
environment_variables        = {}
secret_environment_variables = {}
secret_propagation_delay     = 30
```

Supprimez ensuite le secret du lab : `gcloud secrets delete lab-gke-api-key --project="$PROJECT" --quiet`.

---

### Lab 6 — GKE Backend Config (Groupe 6) {#lab-6--gke-backend-config-group-6}

> **Objectif :** Façonner la manière dont la charge de travail est exposée à l'intérieur du cluster et dont elle se déploie, et isoler l'espace de noms avec une NetworkPolicy sans couper le trafic réel.

**Vous allez :** ajouter un deuxième port de Service · changer l'affinité de session · définir le délai de grâce et le délai d'expiration du déploiement · activer la segmentation réseau et prouver que l'application répond toujours et joint toujours sa base de données et Redis.
**Durée :** 30 min · **Coût :** aucun · **Prérequis / configuration externe :** le maillage de services nécessite Cloud Service Mesh sur le cluster et n'est pas disponible dans les projets gérés par RAD ; les CIDR `prereq_*` ne s'appliquent qu'à un cluster intégré (inline) (pas au parcours sur socle de ce lab).

#### Paramètres de ce groupe {#settings-in-this-group-4}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `gke_cluster_name` | `""` | Oui | Cluster cible ; vide = découverte du cluster Services_GCP. |
| `gke_cluster_selection_mode` | `"primary"` | Oui | `primary`, `round-robin`, ou `explicit` (nécessite `gke_cluster_name` ; vérifié au plan). |
| `namespace_name` | `""` | Oui (drapeau) | Espace de noms explicite ; vide = `SERVICE`. Le modifier sur une application en cours d'exécution déplace chaque objet Kubernetes vers un nouvel espace de noms — traitez-le comme un paramètre à la création. |
| `workload_type` | `null` (Deployment) | **Non** | `Deployment` ou `StatefulSet`. Voir Lab 7. |
| `service_type` | `"LoadBalancer"` | **Non** | `LoadBalancer` (IP L4 externe), `ClusterIP` (interne), `NodePort`. Lorsqu'une Gateway est utilisée (Lab 19, CDN ou Cloud Armor), `LoadBalancer` est créé en tant que `ClusterIP`, de sorte que la Gateway est le seul point d'entrée public. |
| `service_port` | `80` | Oui | Port auquel les clients se connectent sur le Service. |
| `extra_service_ports` | `[]` | Oui | Ports de Service supplémentaires : `name` (unique, vérifié au plan), `port`, optionnel `target_port`, `protocol` (par défaut `TCP`). |
| `session_affinity` | `"ClientIP"` | Oui | `ClientIP` (persistance par IP client) ou `None`. |
| `deployment_strategy` | `null` | **Non** | `RollingUpdate` ou `Recreate` ; null déduit `Recreate` lorsque NFS est monté, sinon `RollingUpdate`. |
| `enable_network_segmentation` | `false` | **Non** | Crée la NetworkPolicy `<PREFIX>-namespace-isolation` restreignant les flux entrants et sortants. |
| `configure_service_mesh` | `false` | **Non** · masqué dans les projets gérés par RAD | Étiquette l'espace de noms `istio-injection: enabled`. Nécessite Cloud Service Mesh ; échoue dans les projets gérés par RAD. |
| `termination_grace_period_seconds` | `60` | Oui | Délai de grâce SIGTERM → SIGKILL (0–3600). |
| `deployment_timeout` | `1800` | Oui | Durée pendant laquelle l'apply attend que le déploiement se termine. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | **Non** | Sous-réseau du cluster intégré (inline). Clusters intégrés uniquement ; ne jamais modifier après création. |
| `prereq_subnet_cidr_override` | `""` | **Non** | Remplacement de sous-réseau VPC intégré. Intégré uniquement. |
| `prereq_gke_pod_cidr_override` | `""` | **Non** | Remplacement de plage de pods de cluster intégré. Intégré uniquement. |
| `prereq_gke_service_cidr_override` | `""` | **Non** | Remplacement de plage de services de cluster intégré. Intégré uniquement ; les trois remplacements doivent être définis ensemble (vérifié au plan). |
| `prereq_gke_master_cidr_override` | `""` | **Non** | Plan de contrôle du cluster intégré `/28`. Intégré uniquement. |

#### Étape 1 — Configurer {#step-1--configure-4}

```hcl
extra_service_ports = [{
  name        = "metrics"     # must be unique among the Service's ports
  port        = 9090          # TCP only: one L4 LB cannot mix TCP and UDP
  target_port = 8080          # the sample app has a single port
  protocol    = "TCP"
}]
session_affinity                 = "None"   # spread requests across pods
termination_grace_period_seconds = 45
deployment_timeout               = 1800
enable_network_segmentation      = true
```

#### Étape 2 — Appliquer {#step-2--apply-4}

**Update**. Le Service est mis à jour sur place, une NetworkPolicy est créée et la modification du gabarit de pod déclenche un déploiement progressif. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-4}

```bash
kubectl get svc "$SERVICE" -n "$NS" -o jsonpath='{range .spec.ports[*]}{.name} {.port}->{.targetPort}/{.protocol}{"\n"}{end}{.spec.sessionAffinity}{"\n"}'
# http 80->8080/TCP, metrics 9090->8080/TCP, None

kubectl get networkpolicy -n "$NS"                                  # <PREFIX>-namespace-isolation
kubectl describe networkpolicy "$PREFIX-namespace-isolation" -n "$NS" | head -60

kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}{" "}{.spec.strategy.type}{"\n"}'   # 45 Recreate

# The policy did not cut anything off: external traffic, the DB and Redis still work
curl -s "http://$LB_IP/"; echo                                      # Visitor count increments
curl -s "http://$LB_IP/db"; echo                                    # "connected"
curl -s -o /dev/null -w "%{http_code}\n" "http://$LB_IP:9090/healthz"   # 200 via the extra port
kubectl exec -n "$NS" "$WL" -c "$APP" -- python3 -c \
  "import os,socket; s=socket.create_connection((os.environ['REDIS_HOST'],int(os.environ['REDIS_PORT'])),5); print('redis reachable')"
```

La NetworkPolicy autorise explicitement les plages de l'équilibreur de charge et des tests de santé, le trafic client sur le port du conteneur (un équilibreur de charge L4 préserve l'IP client), le DNS, le HTTPS vers les API Google, ainsi que les flux sortants vers l'IP privée réelle de Cloud SQL et vers l'hôte Redis.

#### Pour aller plus loin {#explore-further-4}

- Définissez `deployment_strategy = "RollingUpdate"` et incrémentez la version : deux pods se chevauchent brièvement. Avec NFS monté, c'est exactement la situation que le mode déduit `Recreate` évite.
- `service_type = "ClusterIP"` supprime entièrement l'IP externe (et avec elle, votre accès `curl`) — utile pour les applications strictement internes ; joignez-la avec `kubectl port-forward -n "$NS" svc/"$SERVICE" 8080:80`.
- `namespace_name = "lab-shared"` (sur un nouveau déploiement) place l'application dans un espace de noms de votre choix ; `NS` et `SERVICE` diffèrent alors.

#### Attention à {#watch-out-for-4}

- N'activez la segmentation qu'après avoir cartographié le trafic réel de l'application. Le module couvre la DB, Redis, le DNS, les API Google et le LB ; tout le reste (une API tierce sur un port autre que 443, un autre espace de noms) est bloqué.
- `extra_service_ports` doit rester exclusivement TCP sur un Service LoadBalancer — mélanger de l'UDP bloque le Service indéfiniment.
- `configure_service_mesh = true` dans un projet géré par RAD échoue à l'apply avec `RESOURCE_USAGE_RESTRICTION_VIOLATED`.

#### Retour arrière {#revert-4}

```hcl
extra_service_ports              = []
session_affinity                 = "ClientIP"
termination_grace_period_seconds = 60
enable_network_segmentation      = false
```

---

### Lab 7 — StatefulSet / PVC (Groupe 7) {#lab-7--statefulset--pvc-group-7}

> **Objectif :** Attribuer à chaque réplica son propre disque de bloc persistant en basculant la charge de travail vers un StatefulSet, et prouver que les données survivent au remplacement d'un pod.

**Vous allez :** convertir le Deployment en StatefulSet avec une PVC HDD de 10 GiB · ajouter un Service headless · écrire un fichier marqueur, supprimer le pod et relire le marqueur depuis le pod de remplacement.
**Durée :** 35 min · **Coût :** un disque persistant standard de 10 GiB par réplica (conservé jusqu'à ce que vous le supprimiez) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-5}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `stateful_pvc_enabled` | `null` | **Non** | `true` ajoute un gabarit de PVC par pod et sélectionne automatiquement `StatefulSet` (le plan échoue si `workload_type = "Deployment"`). |
| `stateful_pvc_size` | `null` | Oui | Taille de la PVC, ex. `"10Gi"` — requise lorsqu'activée (vérifié au plan). |
| `stateful_pvc_mount_path` | `null` | Oui | Emplacement de montage de la PVC — requis lorsqu'activé ; doit différer de `nfs_mount_path` et de tout montage GCS (vérifié au plan). |
| `stateful_pvc_storage_class` | `null` (`standard-rwo`, Balanced PD adossé à des SSD) | **Non** | StorageClass ; `standard` (HDD) préserve le quota SSD régional serré. S'applique aux **nouvelles** PVC uniquement. |
| `stateful_headless_service` | `null` | **Non** | Crée `<SERVICE>-headless` (`clusterIP: None`) pour un DNS stable par pod. |
| `stateful_pod_management_policy` | `null` (`OrderedReady`) | Oui | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` (`RollingUpdate`) | Oui | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` (non défini) | Oui (drapeau) — **à la création uniquement** | `fsGroup` du pod : Kubernetes rend le volume accessible en écriture pour ce GID et l'ajoute aux groupes de chaque conteneur, permettant à une application non-root d'écrire. |

#### Étape 1 — Configurer {#step-1--configure-5}

```hcl
workload_type                  = "StatefulSet"   # explicit, though stateful_pvc_enabled implies it
stateful_pvc_enabled           = true
stateful_pvc_size              = "10Gi"
stateful_pvc_mount_path        = "/srv/appdata"  # NOT /mnt/nfs — one path, one volume
stateful_pvc_storage_class     = "standard"      # HDD: keeps SSD_TOTAL_GB quota free
stateful_headless_service      = true
stateful_pod_management_policy = "OrderedReady"
stateful_update_strategy       = "RollingUpdate"
stateful_fs_group              = 1000            # app runs as uid 999; any non-zero GID makes the PVC writable
```

#### Étape 2 — Appliquer {#step-2--apply-5}

Le formulaire avertit : `workload_type` et `stateful_pvc_enabled` ne sont pas sécurisés pour la mise à jour (update-safe). Le Deployment `$SERVICE` est **détruit** et un StatefulSet `$SERVICE` est créé, attendez-vous donc à une brève indisponibilité. ~10 minutes. Ensuite :

```bash
export WL="sts/$SERVICE"
```

#### Étape 3 — Vérifier {#step-3--verify-5}

```bash
kubectl get sts,pvc -n "$NS"                     # sts/$SERVICE 1/1; pvc data-$SERVICE-0 Bound 10Gi standard
kubectl get svc "$SERVICE-headless" -n "$NS" -o jsonpath='{.spec.clusterIP}{"\n"}'   # None
kubectl get pod "$SERVICE-0" -n "$NS" -o jsonpath='{.spec.securityContext.fsGroup}{"\n"}'   # 1000
kubectl exec -n "$NS" "$SERVICE-0" -c "$APP" -- df -h /srv/appdata /mnt/nfs   # a real block device + the NFS share

# Persistence: write, replace the pod, read back
kubectl exec -n "$NS" "$SERVICE-0" -c "$APP" -- sh -c 'echo lab7-marker > /srv/appdata/marker.txt'
kubectl delete pod "$SERVICE-0" -n "$NS"
kubectl wait --for=condition=Ready pod/"$SERVICE-0" -n "$NS" --timeout=300s
kubectl exec -n "$NS" "$SERVICE-0" -c "$APP" -- cat /srv/appdata/marker.txt   # lab7-marker
curl -s "http://$LB_IP/"; echo                   # still serving
```

#### Pour aller plus loin {#explore-further-5}

- Essayez `stateful_pvc_mount_path = "/mnt/nfs"` (le chemin NFS) : le plan échoue — *"A container cannot mount two volumes at one path."*
- Définissez `stateful_pvc_enabled = true` avec `workload_type = "Deployment"` : le plan échoue tout comme si les paramètres associés de taille/chemin sont manquants.
- Augmentez `min_instance_count` à 2 : un second pod `$SERVICE-1` ne démarre qu'après que `-0` est Ready (`OrderedReady`) et obtient sa **propre** PVC `data-$SERVICE-1` — le stockage par pod n'est pas du stockage partagé (utilisez NFS, Lab 13, pour cela).

#### Attention à {#watch-out-for-5}

- `stateful_fs_group` et `container_resources` s'appliquent à la création uniquement sur un StatefulSet : les modifier plus tard donne un apply réussi sans rien changer.
- Modifier `stateful_pvc_storage_class` ultérieurement n'affecte que les nouvelles PVC ; les disques existants conservent leur classe sans diff dans le plan.
- La classe par défaut est adossée à du SSD et le quota régional `SSD_TOTAL_GB` est limité sur les projets de lab ; réduire à zéro **conserve** les PVC.
- Une mise à jour de StatefulSet échoue occasionnellement avec *"Missing Resource Identity After Update"* (un bug de fournisseur). La modification a généralement abouti : relancez **Update** sans changement ; elle se termine avec succès.

#### Retour arrière {#revert-5}

```hcl
workload_type                  = null       # back to Deployment
stateful_pvc_enabled           = null
stateful_pvc_size              = null
stateful_pvc_mount_path        = null
stateful_pvc_storage_class     = null
stateful_headless_service      = null
stateful_pod_management_policy = null
stateful_update_strategy       = null
stateful_fs_group              = 0
```

Le StatefulSet est remplacé par un Deployment (`export WL="deploy/$SERVICE"`). **Les PVC ne sont pas supprimées avec le StatefulSet** — supprimez-les pour cesser de payer : `kubectl delete pvc -n "$NS" -l app="$APP"` (ou `kubectl delete pvc data-$SERVICE-0 -n "$NS"`).

---

### Lab 8 — Quota de ressources (Groupe 8) {#lab-8--resource-quota-group-8}

> **Objectif :** Plafonner la consommation totale de CPU, de mémoire et de nombre d'objets que l'espace de noms peut utiliser, dimensionné pour que les déploiements normaux continuent de passer.

**Vous allez :** créer une ResourceQuota avec une marge de sécurité · lire l'utilisation réelle par rapport à celle-ci · voir le plan rejeter une valeur de mémoire sous forme d'entier brut.
**Durée :** 15 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-6}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_resource_quota` | `false` | **Non** | Crée la ResourceQuota `app-quota` dans l'espace de noms. |
| `quota_cpu_requests` | `"4"` | Oui | Total des requêtes CPU sur tous les pods (vide = pas de limite). |
| `quota_cpu_limits` | `"4"` | Oui | Total des limites CPU ; ≥ requêtes. |
| `quota_memory_requests` | `"4Gi"` | Oui | Total des requêtes de mémoire. **Suffixe binaire requis** — un entier brut signifie des octets et est rejeté au moment du plan. |
| `quota_memory_limits` | `"8Gi"` | Oui | Total des limites de mémoire ; ≥ requêtes. Suffixe binaire requis. |
| `quota_max_pods` | `"20"` | Oui | Nombre max de pods (inclut les pods de Job et de CronJob). |
| `quota_max_services` | `"10"` | Oui | Nombre max de Services. |
| `quota_max_pvcs` | `"5"` | Oui | Nombre max de PVC. |

#### Étape 1 — Configurer {#step-1--configure-6}

```hcl
enable_resource_quota = true
quota_cpu_requests    = "4"       # >= 2x what the app + sidecar + jobs request,
quota_cpu_limits      = "8"       # so a surge pod or a Job can still be admitted
quota_memory_requests = "8Gi"     # binary suffix: "8Gi", never "8"
quota_memory_limits   = "16Gi"
quota_max_pods        = "20"
quota_max_services    = "10"
quota_max_pvcs        = "5"
```

#### Étape 2 — Appliquer {#step-2--apply-6}

**Update**. Un objet ResourceQuota est créé ; les pods ne sont pas affectés. ~3 minutes.

#### Étape 3 — Vérifier {#step-3--verify-6}

```bash
kubectl describe resourcequota app-quota -n "$NS"
# Used vs Hard for requests.cpu, requests.memory, limits.*, pods, services, persistentvolumeclaims
```

Attendu : `Used` affiche le ou les pods en cours d'exécution — application plus sidecar proxy — bien en dessous de `Hard`.

#### Pour aller plus loin {#explore-further-6}

- Définissez `quota_memory_requests = "8"` : le plan échoue sur la validation de variable avant que quoi que ce soit ne change.
- Resserrez le quota juste au-dessus de l'utilisation actuelle (ex. `quota_cpu_requests` égal à la valeur utilisée) et réalisez une montée de version ou `kubectl rollout restart "$WL" -n "$NS"`. Avec une stratégie RollingUpdate, le pod excédentaire est refusé (`kubectl get events -n "$NS" | grep -i quota` affiche `exceeded quota`) ; c'est pourquoi le lab dimensionne le quota à environ deux fois le régime permanent.

#### Attention à {#watch-out-for-6}

- Le quota comptabilise **chaque** pod de l'espace de noms, y compris les Jobs d'initialisation, le CronJob de sauvegarde et les services supplémentaires (Lab 11). Dimensionnez pour la pointe, pas pour le régime permanent.
- Un quota correspondant exactement à l'ensemble en cours d'exécution bloque les mises à jour progressives.

#### Retour arrière {#revert-6}

```hcl
enable_resource_quota = false
```

---

### Lab 9 — Fiabilité (Groupe 9) {#lab-9--reliability-group-9}

> **Objectif :** Maintenir l'application disponible lors de perturbations volontaires telles que les mises à niveau de nœuds Autopilot, et répartir les réplicas entre les domaines de défaillance.

**Vous allez :** exécuter deux réplicas avec un PDB qui autorise exactement une éviction · ajouter des contraintes de répartition de topologie et les observer sur la spécification du pod · découvrir quelles valeurs de PDB bloquent définitivement les vidages (drains).
**Durée :** 20 min · **Coût :** un deuxième pod · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-7}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_pod_disruption_budget` | `true` | Oui | Crée le PDB `<PREFIX>-pdb`. Ignoré automatiquement lorsque `max_instance_count` vaut 1. |
| `pdb_min_available` | `"1"` | Oui | Nombre ou pourcentage qui doit rester actif. Un nombre doit être strictement inférieur à `max_instance_count` (vérifié au plan). |
| `enable_topology_spread` | `false` | Oui | Ajoute des `topologySpreadConstraints` de zone et de nœud à la spécification du pod. |
| `topology_spread_strict` | `false` | Oui | `true` = `DoNotSchedule` (les pods peuvent rester Pending) ; `false` = `ScheduleAnyway`. |

#### Étape 1 — Configurer {#step-1--configure-7}

```hcl
min_instance_count           = 2      # Group 4: two replicas so one can be evicted
max_instance_count           = 5
enable_pod_disruption_budget = true
pdb_min_available            = "1"    # 1 of 2 must stay up -> 1 disruption allowed
enable_topology_spread       = true
topology_spread_strict       = false  # safe with few replicas/zones
```

#### Étape 2 — Appliquer {#step-2--apply-7}

**Update**. Le PDB est mis à jour, le gabarit de pod acquiert les contraintes de répartition (déploiement progressif) et le HPA passe à 2. ~5–10 minutes. Sur un StatefulSet (si vous avez conservé le Lab 7), vous pouvez rencontrer l'erreur du fournisseur « Missing Resource Identity » — relancez **Update**.

#### Étape 3 — Vérifier {#step-3--verify-7}

```bash
kubectl get pdb "$PREFIX-pdb" -n "$NS"                     # MIN AVAILABLE 1  ALLOWED DISRUPTIONS 1
kubectl get pods -n "$NS" -l app="$APP" -o wide            # two pods; note the NODE column
kubectl get "$WL" -n "$NS" -o jsonpath='{range .spec.template.spec.topologySpreadConstraints[*]}{.topologyKey}{"  "}{.whenUnsatisfiable}{"\n"}{end}'
# topology.kubernetes.io/zone  ScheduleAnyway
# kubernetes.io/hostname       ScheduleAnyway
```

#### Pour aller plus loin {#explore-further-7}

- Définissez `pdb_min_available = "50%"` avec `min_instance_count = 1` : `ALLOWED DISRUPTIONS` vaut `0` — 50 % d'un réplica est arrondi à l'entier supérieur (un), de sorte qu'un pod unique ne peut jamais être évincé volontairement.
- Définissez `pdb_min_available = "5"` avec `max_instance_count = 5` : le plan échoue — un PDB exigeant chaque réplica bloquerait définitivement les vidages de nœuds.
- `topology_spread_strict = true` avec deux réplicas se planifie généralement sans problème sur Autopilot ; avec plus de réplicas que de zones, surveillez les événements `FailedScheduling`.

#### Attention à {#watch-out-for-7}

- Un PDB dont le minimum est égal au nombre de réplicas bloque chaque vidage et mise à niveau de GKE. Conservez une marge.
- `pdb_min_available = "1"` sur un réplica unique autorise zéro perturbation ; c'est pourquoi le module ignore le PDB lorsque `max_instance_count` vaut 1.

#### Retour arrière {#revert-7}

```hcl
min_instance_count     = 1
max_instance_count     = 3
pdb_min_available      = "1"
enable_topology_spread = false
```

---

### Lab 10 — Observabilité (Groupe 10) {#lab-10--observability-group-10}

> **Objectif :** Ajuster les sondes qui déterminent quand un pod a démarré, est vivant et disponible, et ajouter une surveillance synthétique et basée sur des métriques.

**Vous allez :** définir les minutages des sondes et les observer sur le pod en direct · créer un test de disponibilité ciblant l'hôte `nip.io` par défaut · ajouter une règle d'alerte personnalisée.
**Durée :** 25 min · **Coût :** faible (exécutions de tests de disponibilité) · **Prérequis / configuration externe :** `support_users` du Lab 2 si vous souhaitez que les alertes notifient quelqu'un.

#### Paramètres de ce groupe {#settings-in-this-group-8}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Oui | Sonde de démarrage : `type` (`HTTP`/`TCP`), `path`, `initial_delay_seconds` (10), `timeout_seconds` (5), `period_seconds` (10), `failure_threshold` (3). |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Oui | Sondes de vivacité **et** de disponibilité (readiness) (mêmes champs ; valeurs par défaut 15/5/30/3). Lorsque la Gateway est active (Labs 19–21), pilote également le `HealthCheckPolicy` de l'équilibreur de charge. Lorsque App_GKE est déployé directement, il s'agit de la variable active. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | **Non** | Test de disponibilité Cloud Monitoring : `enabled`, `path`, `check_interval` (`"60s"`), `timeout` (`"10s"`). Créé uniquement lorsqu'il existe un hôte public stable (voir Attention à). |
| `alert_policies` | `[]` | Oui | Alertes personnalisées : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`, `per_series_aligner` (par défaut `ALIGN_MEAN` ; utilisez `ALIGN_RATE` pour les compteurs). |

#### Étape 1 — Configurer {#step-1--configure-8}

```hcl
startup_probe_config = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/healthz"
  initial_delay_seconds = 5
  timeout_seconds       = 4
  period_seconds        = 8
  failure_threshold     = 12      # up to ~100 s for a slow start
}
health_check_config = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/healthz"   # must return a literal 200
  initial_delay_seconds = 20
  timeout_seconds       = 6
  period_seconds        = 20
  failure_threshold     = 5
}
uptime_check_config = {
  enabled        = true
  path           = "/"           # a real page, not the probe path
  check_interval = "60s"         # note the field name: check_interval
  timeout        = "10s"
}
alert_policies = [{
  name               = "lab-cpu-limit"
  metric_type        = "kubernetes.io/container/cpu/limit_utilization"   # a GAUGE metric
  comparison         = "COMPARISON_GT"
  threshold_value    = 0.85
  duration_seconds   = 300
  aggregation_period = "60s"
}]
```

#### Étape 2 — Appliquer {#step-2--apply-8}

**Update**. Le gabarit de pod change (déploiement progressif), un test de disponibilité et une règle d'alerte sont créés. ~5–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-8}

```bash
kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}{"\n"}{.spec.template.spec.containers[0].readinessProbe}{"\n"}{.spec.template.spec.containers[0].startupProbe}{"\n"}'
# liveness/readiness: initialDelaySeconds 20, timeoutSeconds 6, periodSeconds 20, failureThreshold 5
# startup:            initialDelaySeconds 5,  timeoutSeconds 4, periodSeconds 8,  failureThreshold 12

gcloud monitoring uptime list-configs --project="$PROJECT" --filter="displayName~$SERVICE" \
  --format="table(displayName,monitoredResource.labels.host,httpCheck.path,period)"
# <SERVICE>-uptime-check   <LB_IP>.nip.io   /   60s
gcloud alpha monitoring policies list --project="$PROJECT" --filter="displayName~lab-cpu-limit" \
  --format="table(displayName,enabled)"
```

Après quelques minutes, **Monitoring → Uptime checks** affiche le test avec succès depuis plusieurs régions.

#### Pour aller plus loin {#explore-further-8}

- Modifiez `uptime_check_config.path` en `/healthz` et comparez — sur GKE, cela réussit (contrairement à Cloud Run, où le frontal intercepte `/healthz`), mais un chemin réservé aux sondes prouve moins de choses qu'une vraie page.
- Cassez volontairement la sonde de vivacité (`path = "/nope"`) : l'application renvoie 404, le kubelet redémarre le conteneur toutes les `failure_threshold × period_seconds`, et `kubectl get pods` montre les redémarrages qui grimpent. Rétablissez rapidement.

#### Attention à {#watch-out-for-8}

- Un test de disponibilité n'est créé que si le point de terminaison dispose d'un hôte public stable : un Service LoadBalancer avec `reserve_static_ip = true` (testé en tant que `<ip>.nip.io` via HTTP), un domaine personnalisé, ou la Gateway avec `enable_custom_domain = true`. Sur une IP éphémère ou un service ClusterIP, le test est silencieusement ignoré.
- Les clés non déclarées sur l'objet (par exemple `period` au lieu de `check_interval`) sont abandonnées sans erreur et la valeur par défaut est utilisée. Vérifiez l'orthographe.
- Un chemin de sonde qui renvoie un 3xx ou un 204 satisfait le kubelet mais fait échouer le test de santé de la Gateway (qui nécessite un 200 textuel) dès que vous atteignez le Lab 19.

#### Retour arrière {#revert-8}

```hcl
startup_probe_config = { enabled = true, path = "/healthz" }
health_check_config  = { enabled = true, path = "/healthz" }
uptime_check_config  = { enabled = false, path = "/" }
alert_policies       = []
```

---

### Lab 11 — Automatisation des charges de travail (Groupe 11) {#lab-11--workload-automation-group-11}

> **Objectif :** Exécuter des jobs de configuration ponctuels dans un ordre contrôlé, un CronJob planifié et un service frère que l'application joint via une URL injectée.

**Vous allez :** remplacer la liste de jobs d'initialisation par défaut par une chaîne ordonnée (en réitérant le `db-init` par défaut) · ajouter un CronJob et l'exécuter à la demande · ajouter un frère `nginx` et l'appeler depuis l'intérieur du conteneur de l'application.
**Durée :** 30 min · **Coût :** un petit pod supplémentaire · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-9}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `initialization_jobs` | un job `db-init` (`postgres:15-alpine`, `scripts/db-init.sh`) | Oui | Jobs Kubernetes `<SERVICE>-<name>`. Champs : `name`, `image`, `command`, `args`, `script_path`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, `needs_db` (par défaut true), `needs_secrets` (par défaut true). **Une liste fournie par vos soins remplace la valeur par défaut.** |
| `cron_jobs` | `[]` | Oui | CronJobs `<SERVICE>-<name>` : `schedule` (UTC), `image`, `command`, `args`, ressources, `concurrency_policy` (`Forbid`), limites d'historique, `suspend`, `mount_nfs`, `mount_gcs_volumes`, `script_path`. |
| `additional_services` | `[]` | Oui | Deployments + Services supplémentaires `<SERVICE>-<name>` dans l'espace de noms. L'application reçoit `<NAME>_URL = http://<SERVICE>-<name>:<port>` (ou `output_env_var_name`). Les champs incluent `image`, `port`, `env_vars`, `secret_env_vars`, ressources, mise à l'échelle, `persistent_volume`, sondes. |

#### Étape 1 — Configurer {#step-1--configure-9}

```hcl
initialization_jobs = [
  {                                   # restate the default, or it is dropped
    name             = "db-init"
    image            = "postgres:15-alpine"
    command          = ["/bin/sh", "/scripts/script.sh"]
    script_path      = "scripts/db-init.sh"
    execute_on_apply = true
  },
  {
    name             = "lab-base"
    image            = "curlimages/curl:8.11.1"
    command          = ["sh", "-c"]
    args             = ["echo base start; sleep 45; echo base done"]
    execute_on_apply = true           # Terraform WAITS for it -> dependents start after it COMPLETES
    needs_db         = false          # no Cloud SQL proxy / DB env needed
    needs_secrets    = false
  },
  {
    name            = "lab-dependent"
    image           = "curlimages/curl:8.11.1"
    command         = ["sh", "-c"]
    args            = ["echo dependent start"]
    depends_on_jobs = ["lab-base"]
    needs_db        = false
    needs_secrets   = false
  }
]
cron_jobs = [{
  name     = "lab-cron"
  schedule = "0 3 * * *"              # daily 03:00 UTC
  image    = "curlimages/curl:8.11.1"
  command  = ["sh", "-c"]
  args     = ["echo gke cron ran"]
}]
additional_services = [{
  name  = "nginx"                     # -> Service <SERVICE>-nginx, env NGINX_URL
  image = "nginx:alpine"
  port  = 80
}]
```

#### Étape 2 — Appliquer {#step-2--apply-9}

**Update**. Nouveaux Jobs, un CronJob, un Deployment + Service pour `nginx`, et un déploiement progressif de l'application (elle acquiert `NGINX_URL`). L'apply attend ~45 s pour `lab-base`. ~8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-9}

```bash
kubectl get jobs -n "$NS" -o custom-columns=NAME:.metadata.name,START:.status.startTime,DONE:.status.completionTime
# <SERVICE>-lab-dependent START is after <SERVICE>-lab-base DONE
kubectl logs -n "$NS" job/"$SERVICE"-lab-base --all-containers

kubectl get cronjob "$SERVICE-lab-cron" -n "$NS"                         # SCHEDULE 0 3 * * *
kubectl create job lab-cron-manual --from=cronjob/"$SERVICE"-lab-cron -n "$NS"
kubectl wait --for=condition=complete job/lab-cron-manual -n "$NS" --timeout=180s
kubectl logs -n "$NS" job/lab-cron-manual                                # gke cron ran

kubectl get deploy,svc -n "$NS" | grep nginx                             # <SERVICE>-nginx
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo $NGINX_URL'         # http://<SERVICE>-nginx:80
kubectl exec -n "$NS" "$WL" -c "$APP" -- python3 -c \
  "import os,urllib.request; r=urllib.request.urlopen(os.environ['NGINX_URL']); print(r.status, r.read(60))"
# 200 b'<!DOCTYPE html>...'
```

#### Pour aller plus loin {#explore-further-9}

- Supprimez `execute_on_apply = true` de `lab-base` et réappliquez (modifiez son `args` pour que le Job soit recréé). Les deux Jobs démarrent maintenant dans la même seconde : `depends_on_jobs` ordonne la **création** des jobs ; seul `execute_on_apply = true` fait attendre Terraform jusqu'à **achèvement**.
- Les chaînes sont prises en charge sur quatre niveaux de profondeur (base → dépendant → enchaîné → profond). Un cinquième niveau ou une boucle fait échouer le plan en nommant les jobs non positionnés.
- Définissez `suspend = true` sur le CronJob et confirmez que `kubectl get cronjob` affiche `SUSPEND True`.

#### Attention à {#watch-out-for-9}

- Fournir `initialization_jobs` **remplace** le `db-init` par défaut — réitérez-le si vous souhaitez le conserver.
- Les Jobs ne sont recréés que lorsque leur définition ou leur script monté change ; un apply sans modification ne touche pas aux Jobs terminés.
- Les pods frères sont comptabilisés dans le ResourceQuota (Lab 8) et sont facturés comme n'importe quel pod.
- Supprimez les Jobs de test manuels que vous créez (`kubectl delete job lab-cron-manual -n "$NS"`) ; le module ne les gère pas.

#### Retour arrière {#revert-9}

```hcl
initialization_jobs = [{
  name             = "db-init"
  image            = "postgres:15-alpine"
  command          = ["/bin/sh", "/scripts/script.sh"]
  script_path      = "scripts/db-init.sh"
  execute_on_apply = true
}]
cron_jobs           = []
additional_services = []
```

---

### Lab 12 — CI/CD (Groupe 12) {#lab-12--cicd-group-12}

> **Objectif :** Appliquer Binary Authorization sur le cluster, et comprendre comment sont configurés le pipeline Cloud Build déclenché par GitHub et le pipeline de promotion Cloud Deploy.

**Vous allez :** activer Binary Authorization en mode `ALWAYS_ALLOW` et relire la règle du cluster et du projet · confirmer que les pods frères sont couverts par la même règle de cluster · passer en revue les paramètres CI/CD et Cloud Deploy.
**Durée :** 20 min pour Binary Authorization ; +40 min pour CI/CD si vous disposez d'un dépôt · **Coût :** aucun pour BinAuthz ; minutes Cloud Build pour le CI/CD · **Prérequis / configuration externe :** **[Configuration externe requise pour le CI/CD]** un dépôt GitHub contenant un Dockerfile, ainsi qu'un Personal Access Token GitHub (`repo`, `admin:repo_hook`) ou une installation de GitHub App Cloud Build. Binary Authorization ne nécessite rien d'externe.

#### Paramètres de ce groupe {#settings-in-this-group-10}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Oui | Crée une connexion GitHub Cloud Build et un déclencheur qui compile et déploie lors d'un push. Nécessite `github_repository_url` (vérifié au plan). |
| `github_repository_url` | `""` | Oui | `https://github.com/ORG/REPO`. |
| `github_token` | `""` | Oui (sensible) | PAT utilisé pour créer la connexion lors du premier apply ; stocké dans Secret Manager (`secret-<SERVICE>-github-token`) et réutilisé. |
| `github_app_installation_id` | `""` | Oui | Installation de la GitHub App Cloud Build (privilégiée pour les organisations). |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Oui | `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `description`, `substitutions`. |
| `enable_cloud_deploy` | `false` | Oui | Remplace les déploiements directs par un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger` (vérifié au plan). |
| `cloud_deploy_stages` | `dev`, `staging`, `prod` (prod nécessite une approbation) | Oui | Étapes : `name`, `target_name`, `namespace` (par défaut `<SERVICE>-<stage>`), `cluster`, `project_id`, `region`, `require_approval`, `auto_promote`. |
| `enable_binary_authorization` | `false` | **Non** | Applique la règle Binary Authorization du projet sur le cluster et crée l'attestateur/la clé de signature KMS s'ils sont manquants. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Oui | `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`. |

`gateway_backend_stage` (quelle étape Cloud Deploy la Gateway dessert) est un champ du Groupe 19 sur le formulaire.

#### Étape 1 — Configurer {#step-1--configure-10}

```hcl
enable_binary_authorization = true
binauthz_evaluation_mode    = "ALWAYS_ALLOW"   # audit everything, block nothing
```

#### Étape 2 — Appliquer {#step-2--apply-10}

**Update** (le formulaire avertit : non update-safe). Attendez-vous à ce que l'attestateur, la note et la clé de signature KMS soient créés ou réutilisés, et que la règle soit importée. ~5–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-10}

```bash
gcloud container clusters describe "$CLUSTER" --region="$LOCATION" --project="$PROJECT" \
  --format="value(binaryAuthorization.evaluationMode)"         # PROJECT_SINGLETON_POLICY_ENFORCE
gcloud container binauthz policy export --project="$PROJECT" | grep -A2 defaultAdmissionRule
# evaluationMode: ALWAYS_ALLOW
gcloud container binauthz attestors list --project="$PROJECT" --format="value(name)"
kubectl get pods -n "$NS"                                      # app (and any sibling) still Running
```

Binary Authorization sur GKE est appliquée par le contrôleur d'admission du **cluster**, de sorte que chaque pod du cluster — y compris les frères `additional_services` — est soumis à la même règle ; il n'y a aucun paramètre par charge de travail à oublier.

#### Démonstration du CI/CD (lecture seule sauf si vous disposez d'un dépôt) {#cicd-walkthrough-read-only-unless-you-have-a-repository}

Avec un dépôt et un jeton, vous définiriez :

```hcl
enable_cicd_trigger   = true
github_repository_url = "https://github.com/<your-org>/<your-repo>"
github_token          = "<your-github-pat>"           # first apply only
cicd_trigger_config   = { branch_pattern = "^main$" }
```

Vérifiez avec `gcloud builds triggers list --project="$PROJECT" --region="$REGION"`, poussez un commit, et observez **Cloud Build → History** compiler et déployer une nouvelle image (`kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}'`). Ajouter `enable_cloud_deploy = true` crée un pipeline de distribution (`gcloud deploy delivery-pipelines list --region="$REGION" --project="$PROJECT"`) et un espace de noms par étape ; les promotions vers `prod` attendent une approbation.

#### Pour aller plus loin {#explore-further-10}

- `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` bloque toute image dépourvue d'attestation, y compris les retours arrière d'urgence ; `ALWAYS_DENY` bloque tout. N'essayez ceci que dans un projet jetable, et consultez `kubectl get events -n "$NS"` pour repérer les refus `image policy webhook`.

#### Attention à {#watch-out-for-10}

- La règle Binary Authorization est un **singleton à l'échelle du projet** : la durcir affecte chaque charge de travail dans chaque espace de noms du projet, et pas seulement cette application.
- Cloud Deploy sans le déclencheur CI/CD est refusé au moment du plan — les releases proviennent uniquement du pipeline.
- Sous Cloud Deploy, le Service de l'espace de noms de base n'est pas créé ; les charges de travail s'exécutent dans des espaces de noms dédiés par étape.

#### Retour arrière {#revert-10}

```hcl
binauthz_evaluation_mode    = "ALWAYS_ALLOW"
enable_binary_authorization = false
```

---

### Lab 13 — Stockage NFS (Groupe 13) {#lab-13--nfs-storage-group-13}

> **Objectif :** Monter le partage NFS partagé là où l'application écrit, prouver que les fichiers survivent au remplacement d'un pod, et réaliser que la VM NFS fournit également Redis.

**Vous allez :** déplacer le montage vers un nouveau chemin et nom de volume · écrire, redémarrer, lire · comparer `NFS_SERVER_IP` avec `REDIS_HOST` · définir le délai imparti au Job.
**Durée :** 20 min · **Coût :** aucun (serveur NFS partagé) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-11}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_nfs` | `true` | **Non** | Monte le partage NFS Services_GCP (sous-arborescence applicative `/share/<SERVICE>`) dans le pod et les Jobs qui le demandent. Rend également disponible l'hôte Redis par défaut. |
| `nfs_mount_path` | `"/mnt/nfs"` | Oui | Chemin de montage dans le conteneur. Ne doit pas être égal à `stateful_pvc_mount_path` (vérifié au plan). |
| `nfs_volume_name` | `"nfs-data-volume"` | Oui | Nom du volume Kubernetes pour le montage. |
| `nfs_instance_name` | `""` | Oui | Utiliser une VM NFS spécifique au lieu d'en découvrir une. |
| `nfs_instance_base_name` | `"app-nfs"` | Oui | Nom de base pour une VM NFS intégrée (inline) (déploiements autonomes uniquement). |
| `job_active_deadline_seconds` | `3600` | Oui | Budget de temps réel pour chaque Job Kubernetes, décompté à partir de la **création** du Job (le temps de provisionnement des nœuds Autopilot est donc décompté). |

#### Étape 1 — Configurer {#step-1--configure-11}

```hcl
enable_nfs                  = true
nfs_mount_path              = "/srv/shared"        # where this app should write shared files
nfs_volume_name             = "lab-nfs-vol"
job_active_deadline_seconds = 1800
```

#### Étape 2 — Appliquer {#step-2--apply-11}

**Update**. Le gabarit de pod change et le pod est recréé (stratégie Recreate). ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-11}

```bash
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{range .items[0].spec.containers[0].volumeMounts[*]}{.mountPath}{"\t"}{.name}{"\n"}{end}'
# /srv/shared   lab-nfs-vol
kubectl exec -n "$NS" "$WL" -c "$APP" -- df -h /srv/shared        # an NFS filesystem (server:/share/<SERVICE>)

# Persistence across a pod replacement
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo lab13-marker > /srv/shared/marker.txt'
kubectl rollout restart "$WL" -n "$NS" && kubectl rollout status "$WL" -n "$NS" --timeout=300s
kubectl exec -n "$NS" "$WL" -c "$APP" -- cat /srv/shared/marker.txt   # lab13-marker

# NFS also carries Redis
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo NFS=$NFS_SERVER_IP REDIS=$REDIS_HOST'   # equal
gcloud compute instances list --project="$PROJECT" --filter="name~nfs" --format="table(name,status,networkInterfaces[0].networkIP)"
```

#### Pour aller plus loin {#explore-further-11}

- Définissez `enable_nfs = false` avec `enable_redis = true` et sans `redis_host` : le plan échoue, car l'hôte Redis par défaut **est** le serveur NFS. Des valeurs égales pour `NFS_SERVER_IP` et `REDIS_HOST` signifient que NFS est essentiel même si le partage est vide.
- Avec `enable_nfs = false` (et Redis désactivé ou pointé ailleurs), la stratégie déduite devient `RollingUpdate` — vérifiez `.spec.strategy.type`.

#### Attention à {#watch-out-for-11}

- Montez le partage là où l'application **écrit réellement**. Un montage sur le mauvais chemin vous donne un partage sain mais vide tandis que les données restent sur le disque éphémère du pod — seul un cycle écriture–redémarrage–lecture le prouve.
- Les moteurs de stockage basés sur le verrouillage de fichiers (SQLite, LevelDB, bbolt, LMDB) se comportent mal sur NFS ; utilisez un disque par pod (Lab 7) pour ceux-ci.

#### Retour arrière {#revert-11}

```hcl
nfs_mount_path              = "/mnt/nfs"
nfs_volume_name             = "nfs-data-volume"
job_active_deadline_seconds = 3600
```

Le fichier marqueur reste sur le partage (`/share/<SERVICE>`) ; il est supprimé lors de la suppression du déploiement.

---

### Lab 14 — Cloud Storage (Groupe 14) {#lab-14--cloud-storage-group-14}

> **Objectif :** Provisionner un bucket applicatif, le monter dans le pod avec le pilote CSI GCS Fuse, y écrire en tant qu'utilisateur applicatif non-root, et le chiffrer avec une clé gérée par le client.

**Vous allez :** créer un bucket `assets` avec gestion des versions · le monter sur `/srv/gcs` avec des options de montage de propriété · écrire un fichier depuis le pod et le retrouver dans le bucket · activer CMEK sur les buckets.
**Durée :** 30 min · **Coût :** faible (stockage bucket, une version de clé KMS) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-12}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `create_cloud_storage` | `true` | **Non** | Interrupteur général pour les buckets dans `storage_buckets`. |
| `storage_buckets` | `[]` | **Non** | Buckets nommés `gcs-<SERVICE>-<name_suffix>` : `location`, `storage_class`, `force_destroy` (par défaut **true**), `versioning_enabled`, `lifecycle_rules`, `public_access_prevention`, `uniform_bucket_level_access`, `cors`. **Supprimer une entrée détruit ce bucket et ses objets.** |
| `gcs_volumes` | `[]` | Oui | Montages GCS Fuse : `name`, `bucket_name` (vide = l'entrée `storage_buckets` dont `name_suffix` est égal à `name`), `mount_path`, `readonly`, `mount_options` (par défaut `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). |
| `manage_storage_kms_iam` | `false` | **Non** | Crée (ou réutilise) un trousseau de clés KMS et `storage-key`, accorde l'accès à l'agent de service GCS, et définit CMEK comme clé par défaut des buckets. |
| `enable_artifact_registry_cmek` | `false` | **Non** | Crée une clé Artifact Registry ; elle n'est appliquée qu'à un registre que ce module crée lui-même, ce qu'il ne fait pas sur un socle Services_GCP. |
| `max_images_to_retain` | `7` | Oui | Protection de rétention d'image — uniquement pour un registre créé par le module ; aucun effet sur le registre Services_GCP partagé. |
| `delete_untagged_images` | `true` | Oui | Même portée que ci-dessus. |
| `image_retention_days` | `30` | Oui | Même portée que ci-dessus. |

#### Étape 1 — Configurer {#step-1--configure-12}

```hcl
create_cloud_storage = true
storage_buckets = [{
  name_suffix        = "assets"        # -> gs://gcs-<SERVICE>-assets
  versioning_enabled = true
}]
gcs_volumes = [{
  name       = "assets"                # matches name_suffix, so bucket_name is derived
  mount_path = "/srv/gcs"
  readonly   = false
  # mount_options REPLACES the defaults, so restate them; uid/gid make the mount
  # writable by the sample app's non-root user (uid 999)
  mount_options = ["implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
                   "uid=999", "gid=999", "file-mode=0664", "dir-mode=0775"]
}]
manage_storage_kms_iam = true          # CMEK on the module's buckets
```

#### Étape 2 — Appliquer {#step-2--apply-12}

**Update** (avertissement : `storage_buckets` et `manage_storage_kms_iam` ne sont pas sécurisés pour la mise à jour). Un bucket et éventuellement une clé KMS sont créés, et le pod est recréé avec le sidecar Fuse. ~8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-12}

```bash
gcloud storage buckets describe "gs://gcs-$SERVICE-assets" \
  --format="yaml(versioning,default_kms_key,iamConfiguration.publicAccessPrevention)"
# versioning enabled, a default_kms_key ending /cryptoKeys/storage-key, enforced

kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.volumes[*].csi.driver}{"\n"}'   # gcsfuse.csi.storage.gke.io
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'id; ls -ld /srv/gcs; echo hello-gcs > /srv/gcs/probe.txt && echo WRITE-OK'
gcloud storage cat "gs://gcs-$SERVICE-assets/probe.txt"                                    # hello-gcs
```

L'écriture doit atteindre le **bucket**, et pas seulement réussir dans le conteneur — la dernière commande le prouve.

#### Pour aller plus loin {#explore-further-12}

- Supprimez les options `uid`/`gid`/mode et écrivez à nouveau. Sur un Deployment, le montage appartient alors à root et le processus d'uid 999 obtient généralement `Permission denied` — le pilote Fuse GKE ne définit pas par défaut un propriétaire accessible en écriture pour les utilisateurs non-root. (Sur un StatefulSet avec `stateful_fs_group` défini, le fsGroup le rend accessible en écriture par le groupe — c'est ainsi que cela a fonctionné lors des tests.)
- Téléversez un fichier depuis votre shell (`gcloud storage cp README.md "gs://gcs-$SERVICE-assets/"`) et listez-le depuis le pod après expiration du cache stat (60 s).
- Remarquez que le bucket de sauvegarde `gcs-$SERVICE-backups` (Lab 17) est créé indépendamment de `storage_buckets`.

#### Attention à {#watch-out-for-12}

- `storage_buckets` n'est **pas** update-safe et `force_destroy` vaut par défaut `true` : supprimer une entrée supprime le bucket **avec son contenu**.
- `mount_options` remplace la liste par défaut — réitérez toujours `implicit-dirs` et les durées de vie (TTL) du cache.
- Les paramètres de rétention du registre et `enable_artifact_registry_cmek` ne changent rien sur un socle Services_GCP, dont le registre partagé possède sa propre règle.
- Un chemin de montage GCS ne doit pas être égal au chemin de montage d'une PVC (vérifié au plan).

#### Retour arrière {#revert-12}

```hcl
gcs_volumes            = []
storage_buckets        = []        # DELETES gs://gcs-<SERVICE>-assets and its objects
manage_storage_kms_iam = false
```

Les trousseaux de clés et clés KMS ne peuvent pas être supprimés dans GCP ; la clé reste (inutilisée) dans le projet.

---

### Lab 15 — Cache Redis (Groupe 15) {#lab-15--redis-cache-group-15}

> **Objectif :** Pointer l'application vers un serveur Redis et comprendre exactement quelles variables le module injecte, avec et sans mot de passe.

**Vous allez :** modifier le port Redis · définir `redis_auth` et observer la disparition de `REDIS_URL` ainsi que l'apparition de `REDIS_AUTH` sous forme de secret.
**Durée :** 15 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun (l'application d'exemple n'utilise pas Redis, ce lab inspecte donc la configuration injectée).

#### Paramètres de ce groupe {#settings-in-this-group-13}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_redis` | `true` | Oui | Injecte `REDIS_HOST`, `REDIS_PORT` et (sans mot de passe) `REDIS_URL`. Nécessite un hôte : `redis_host`, ou NFS (vérifié au plan). Définissez `false` pour les applications n'utilisant pas Redis. |
| `redis_host` | `""` | Oui | Hôte Redis ; vide = IP du serveur NFS (Redis est co-hébergé sur la VM NFS de Services_GCP). |
| `redis_port` | `"6379"` | Oui | Port ; validé sous forme de nombre au moment du plan. |
| `redis_auth` | `""` | Oui (sensible) | Mot de passe Redis. Lorsqu'il est défini, `REDIS_AUTH` est injecté depuis le Secret Kubernetes `<PREFIX>-explicit-secrets` et `REDIS_URL` n'est **plus injecté**. |

#### Étape 1 — Configurer {#step-1--configure-13}

```hcl
enable_redis = true
redis_port   = "6380"                      # visible change in the pod env
redis_auth   = "lab-redis-password"        # switches REDIS_URL -> REDIS_AUTH secret
```

#### Étape 2 — Appliquer {#step-2--apply-13}

**Update**. Le Secret des secrets explicites est mis à jour et le pod est redéployé. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-13}

```bash
kubectl get "$WL" -n "$NS" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\t"}{.value}{.valueFrom.secretKeyRef.name}{"\n"}{end}' | grep REDIS
# REDIS_HOST  10.x.x.x
# REDIS_PORT  6380
# REDIS_AUTH  <PREFIX>-explicit-secrets
# (no REDIS_URL)
```

Comparez avec le socle de référence, où `REDIS_URL=redis://<nfs-ip>:6379` était présent et `REDIS_AUTH` absent.

#### Pour aller plus loin {#explore-further-13}

- Définissez `enable_redis = false` : toutes les variables `REDIS_*` disparaissent. C'est le paramètre approprié pour les applications n'utilisant pas Redis.
- Pointez `redis_host` vers l'IP privée d'une instance Memorystore (`gcloud redis instances list --region="$REGION"`) pour un Redis managé.

#### Attention à {#watch-out-for-13}

- Une application qui lit `REDIS_URL` doit la construire elle-même dès lors que `redis_auth` est défini, car le module cesse de composer une URL plutôt que d'y intégrer le mot de passe.
- Pointer `redis_host` vers une adresse inexistante se déploie sans erreur et n'échoue qu'à l'intérieur de l'application. Lorsque la segmentation réseau (Lab 6) est activée, la NetworkPolicy autorise les flux sortants vers l'hôte Redis configuré.

#### Retour arrière {#revert-13}

```hcl
redis_port = "6379"
redis_auth = ""
```

---

### Lab 16 — Configuration de base de données (Groupe 16) {#lab-16--database-configuration-group-16}

> **Objectif :** Adapter la connexion à la base de données aux noms de variables attendus par une application, comprendre quels paramètres DB sont inertes ou dangereux, et exécuter une réelle rotation de mot de passe.

**Vous allez :** ajouter des alias de variables d'environnement pour l'hôte/l'utilisateur/le nom/le port/le mot de passe · confirmer que `application_database_name`/`user` ne renomment rien · activer la rotation automatique des mots de passe, la déclencher et confirmer que l'application se reconnecte.
**Durée :** 40 min · **Coût :** faible (un Cloud Run Job de rotation, un service répartiteur et un déclencheur Eventarc) · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-14}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | Oui (drapeau) — à traiter comme **à la création** | `POSTGRES`, `MYSQL`, une version épinglée telle que `POSTGRES_17`, ou `NONE`. `NONE` nécessite également `enable_cloudsql_volume = false` (vérifié au plan). Modifier le moteur ultérieurement pointe l'application vers une base de données différente et vide. |
| `sql_instance_name` | `""` | Oui | Utiliser une instance Cloud SQL spécifique au lieu de découvrir celle de Services_GCP. |
| `sql_instance_base_name` | `"app-sql"` | Oui | Nom de base pour une instance intégrée (inline) (mode autonome uniquement). |
| `application_database_name` | `"gkeappdb"` | Oui | **Inerte** : la base de données est toujours nommée d'après `SERVICE`. |
| `application_database_user` | `"gkeappuser"` | Oui | **Inerte** : l'utilisateur est toujours nommé d'après `SERVICE`. |
| `database_password_length` | `32` | **Non** | Longueur du mot de passe généré (16–64). **Le modifier sur un déploiement en cours casse l'authentification DB** jusqu'à ce que le job `db-create` soit réexécuté. |
| `enable_postgres_extensions` | `false` | Oui | Installe les extensions de `postgres_extensions` (une liste du Groupe 0, absente du formulaire). L'activer seul depuis le formulaire n'installe rien sur App_GKE. Doit correspondre au moteur (vérifié au plan). |
| `enable_mysql_plugins` | `false` | Oui | Idem, pour les plugins MySQL dans `mysql_plugins` (Groupe 0). |
| `enable_auto_password_rotation` | `false` | Oui | Déploie un Cloud Run Job de rotation `<SERVICE>-pw-rotator`, un service répartiteur et un déclencheur Eventarc activé par le calendrier de rotation du secret (`secret_rotation_period`). |
| `rotation_propagation_delay_sec` | `90` | Oui | Secondes que le rotateur attend après avoir ajouté la nouvelle version du secret avant de désactiver l'ancienne. |
| `db_password_env_var_name` | `""` | Oui | Nom d'environnement supplémentaire portant le mot de passe DB. |
| `db_host_env_var_name` | `""` | Oui | Nom d'environnement supplémentaire portant l'hôte DB (`127.0.0.1` sur GKE avec le proxy). |
| `db_user_env_var_name` | `""` | Oui | Nom d'environnement supplémentaire portant l'utilisateur DB. |
| `db_name_env_var_name` | `""` | Oui | Nom d'environnement supplémentaire portant le nom de la DB. |
| `db_port_env_var_name` | `""` | Oui | Nom d'environnement supplémentaire portant le port DB. |

#### Étape 1 — Configurer {#step-1--configure-14}

```hcl
application_database_name      = "labgkedb"          # set to prove it is inert
application_database_user      = "labgkeuser"
db_host_env_var_name           = "MYAPP_DB_HOST"     # aliases for an app expecting other names
db_user_env_var_name           = "MYAPP_DB_USER"
db_name_env_var_name           = "MYAPP_DB_NAME"
db_port_env_var_name           = "MYAPP_DB_PORT"
db_password_env_var_name       = "MYAPP_DB_PASSWORD"
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 120
```

#### Étape 2 — Appliquer {#step-2--apply-14}

**Update**. Le pod est redéployé avec les nouvelles variables d'environnement ; le job de rotation, le répartiteur et le déclencheur sont créés. ~8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-14}

```bash
# Aliases carry the same values as the standard names
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'for v in HOST USER NAME PORT; do echo "$v: $(printenv DB_$v) / $(printenv MYAPP_DB_$v)"; done; [ "$DB_PASSWORD" = "$MYAPP_DB_PASSWORD" ] && echo "password alias matches"'
# HOST: 127.0.0.1 / 127.0.0.1 ...

# application_database_name/user created nothing
gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="value(name)" | grep -c labgkedb   # 0

# Rotation machinery
gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~$SERVICE-pw-rotator" --format="value(metadata.name)"
gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(rotation,topics)"
```

Effectuez maintenant une réelle rotation du mot de passe, puis faites en sorte que l'application la prenne en compte :

```bash
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state)"   # note the latest version
gcloud run jobs execute "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --wait
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state)"   # new ENABLED version, old DISABLED

sleep 150   # the Secret Manager -> Kubernetes Secret sync rotates about every 120 s
kubectl rollout restart "$WL" -n "$NS" && kubectl rollout status "$WL" -n "$NS" --timeout=300s
curl -s "http://$LB_IP/db"; echo         # {"status":"connected", ...} with the NEW password
curl -s "http://$LB_IP/"; echo           # counter still increments
```

#### Pour aller plus loin {#explore-further-14}

- `database_type = "NONE"` sur un **nouveau** déploiement (avec `enable_cloudsql_volume = false`) : pas de base de données, pas de sidecar proxy, et l'exemple `db-init` se termine immédiatement avec *"No database configured"*. Laisser `enable_cloudsql_volume = true` fait échouer le plan.
- `enable_postgres_extensions = true` avec `database_type = "MYSQL"` fait échouer le plan.

#### Attention à {#watch-out-for-14}

- **Ne modifiez pas `database_password_length` sur un déploiement en cours.** Cela écrit une nouvelle version de secret tandis que la base de données conserve l'ancien mot de passe, et l'ancienne version est détruite — chaque connexion échoue jusqu'à ce que `db-create` soit réexécuté. Utilisez la rotation à la place.
- Après une rotation, les pods conservent le mot de passe avec lequel ils ont démarré. Les nouvelles connexions DB depuis un pod non redémarré échouent dès que l'ancien mot de passe cesse de fonctionner ; redémarrez la charge de travail après l'intervalle de synchronisation (l'étape ci-dessus s'en charge).
- Sur GKE, toutes les variables d'hôte DB, y compris `DB_IP` et l'alias d'hôte, sont résolues en `127.0.0.1` (le proxy). Sur Cloud Run, le même alias est résolu sur l'IP privée de l'instance — ne supposez pas qu'elles correspondent d'une plateforme à l'autre.

#### Retour arrière {#revert-14}

```hcl
application_database_name     = "gkeappdb"
application_database_user     = "gkeappuser"
db_host_env_var_name          = ""
db_user_env_var_name          = ""
db_name_env_var_name          = ""
db_port_env_var_name          = ""
db_password_env_var_name      = ""
enable_auto_password_rotation = false
rotation_propagation_delay_sec = 90
```

Désactiver la rotation supprime le job, le répartiteur et le déclencheur ; le mot de passe actuel (renouvelé) reste valide.

---

### Lab 17 — Sauvegarde & Maintenance (Groupe 17) {#lab-17--backup--maintenance-group-17}

> **Objectif :** Planifier l'export de la base de données, effectuer une sauvegarde à la demande, et restaurer un fichier de sauvegarde dans la base de données.

**Vous allez :** modifier la planification du CronJob de sauvegarde et sa durée de rétention · exécuter un export maintenant et retrouver le fichier dans le bucket de sauvegarde · importer l'exemple groupé `backup.sql` et confirmer ses actions · désactiver à nouveau l'importation.
**Durée :** 25 min · **Coût :** faible (stockage du bucket de sauvegarde) · **Prérequis / configuration externe :** aucun — le module prépositionne un exemple non destructif `backup.sql` dans `gs://gcs-<SERVICE>-backups/` pour vous. Pour restaurer votre **propre** sauvegarde, téléversez-la d'abord dans ce bucket.

#### Paramètres de ce groupe {#settings-in-this-group-15}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Oui | Expression Cron (UTC) du CronJob d'export `<SERVICE>-db-export`. |
| `backup_retention_days` | `7` | Oui | Règle de cycle de vie sur `gcs-<SERVICE>-backups` supprimant les fichiers plus anciens. |
| `enable_backup_import` | `false` | **Non** | Exécute le Job d'import `<SERVICE>-db-import`, restaurant `backup_file` **en écrasant la base de données active**. Nécessite une base de données et un `backup_file` (vérifications au plan). |
| `backup_source` | `"gcs"` | Oui | `gcs` (le bucket de sauvegarde) ou `gdrive`. |
| `backup_file` | `"backup.sql"` | Oui | Un simple **nom de fichier** dans le bucket de sauvegarde — le module construit l'URI `gs://` lui-même. |
| `backup_format` | `"sql"` | Oui | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto` (`auto` interdit avec `gdrive`). |

#### Étape 1 — Configurer {#step-1--configure-15}

```hcl
backup_schedule       = "30 4 * * *"   # daily 04:30 UTC
backup_retention_days = 21
enable_backup_import  = true           # one-off restore of the sample file
backup_source         = "gcs"
backup_file           = "backup.sql"   # bare filename, already staged by the module
backup_format         = "sql"
```

#### Étape 2 — Appliquer {#step-2--apply-15}

**Update** (avertissement sur `enable_backup_import`). La planification du CronJob et le cycle de vie du bucket sont mis à jour et le Job d'import s'exécute. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-15}

```bash
kubectl get cronjob "$SERVICE-db-export" -n "$NS" -o jsonpath='{.spec.schedule}{"\n"}'          # 30 4 * * *
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format="yaml(lifecycle_config)"   # age: 21

# Restore result — assert on what the SQL did, not just the Job status
kubectl get job "$SERVICE-db-import" -n "$NS"
kubectl logs -n "$NS" job/"$SERVICE"-db-import --all-containers | grep -E "CREATE TABLE|INSERT|validation table"
# CREATE TABLE / INSERT 0 1 / NOTICE: Platform validation table is ready.

# Take a backup now
kubectl create job lab-export-now --from=cronjob/"$SERVICE"-db-export -n "$NS"
kubectl wait --for=condition=complete job/lab-export-now -n "$NS" --timeout=600s
gcloud storage ls -l "gs://gcs-$SERVICE-backups/"            # backup.sql plus a new timestamped export
```

#### Étape 4 — Désactiver l'importation {#step-4--switch-the-import-off}

Laisser `enable_backup_import = true` réexécute la restauration chaque fois que le Job d'import est recréé, écrasant les données plus récentes avec le fichier ancien. Rétablissez-le maintenant :

```hcl
enable_backup_import = false
```

#### Pour aller plus loin {#explore-further-15}

- Téléchargez l'export que vous venez de générer (`gcloud storage cp gs://gcs-$SERVICE-backups/<file> .`) et examinez son contenu — c'est le dump que vous restaureriez avec `backup_file = "<file>"`.
- Essayez `enable_backup_import = true` avec `backup_file = ""` : le plan échoue.

#### Attention à {#watch-out-for-15}

- Une importation **restaure en écrasant la base de données active**. L'exemple fourni crée seulement une table de validation, mais un dump réel remplace les données. Effectuez un export au préalable.
- `backup_file` est un nom de fichier, pas un URI `gs://`.
- Supprimez votre Job manuel par la suite : `kubectl delete job lab-export-now -n "$NS"`.

#### Retour arrière {#revert-15}

```hcl
backup_schedule       = "0 2 * * *"
backup_retention_days = 7
enable_backup_import  = false
```

---

### Lab 18 — Scripts SQL personnalisés (Groupe 18) {#lab-18--custom-sql-scripts-group-18}

> **Objectif :** Exécuter vos propres scripts SQL, dans un ordre garanti, sur la base de données de l'application pendant le déploiement.

**Vous allez :** prépositionner deux scripts dont l'ordre d'exécution importe · les exécuter en tant qu'utilisateur applicatif · lire le journal du Job prouvant l'ordre.
**Durée :** 20 min · **Coût :** négligeable · **Prérequis / configuration externe :** un bucket GCS que vous créez (Étape 1). Le module accorde au compte de service de la charge de travail l'accès en lecture à ce bucket.

#### Paramètres de ce groupe {#settings-in-this-group-16}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | **Non** | Exécute le Job `<SERVICE>-custom-sql-scripts`, exécutant chaque fichier `.sql` sous le préfixe dans l'ordre lexicographique. Nécessite une base de données, un bucket et un chemin (vérifications au plan). |
| `custom_sql_scripts_bucket` | `""` | Oui | Bucket contenant les scripts ; le module accorde `roles/storage.objectViewer` sur celui-ci au compte de service de la charge de travail. |
| `custom_sql_scripts_path` | `""` | Oui | Préfixe dans le bucket ; une valeur vide est refusée car elle n'exécuterait rien sans avertissement. |
| `custom_sql_scripts_use_root` | `false` | Oui | Exécuter en tant qu'utilisateur DB root (pour `CREATE EXTENSION`, les rôles…) au lieu de l'utilisateur applicatif. |

#### Étape 1 — Configurer {#step-1--configure-16}

Prépositionnez deux scripts où `02` échoue s'il s'exécute avant `01` :

```bash
export SQL_BUCKET="<your-bucket>"            # globally unique, e.g. $PROJECT-lab-sql
gcloud storage buckets create "gs://$SQL_BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
printf 'CREATE TABLE IF NOT EXISTS lab_order_check (id int);\n' > 01-create.sql
printf 'INSERT INTO lab_order_check VALUES (1);\n' > 02-insert.sql
gcloud storage cp 01-create.sql 02-insert.sql "gs://$SQL_BUCKET/sql/"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "<your-bucket>"   # the bucket you just created
custom_sql_scripts_path     = "sql"             # every .sql under sql/ runs, sorted by name
custom_sql_scripts_use_root = false             # run as the app's own DB user
```

#### Étape 2 — Appliquer {#step-2--apply-16}

**Update** (avertissement sur `enable_custom_sql_scripts`). Une attribution IAM sur le bucket et le Job de scripts sont créés. ~5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-16}

```bash
gcloud storage buckets get-iam-policy "gs://$SQL_BUCKET" --format="table(bindings.role,bindings.members)" | grep objectViewer
kubectl logs -n "$NS" job/"$SERVICE"-custom-sql-scripts --all-containers
# Found 2 SQL script(s) / 01-create.sql -> CREATE TABLE / 02-insert.sql -> INSERT 0 1
# Executing scripts as application user / Cloud SQL Proxy shutdown signal sent
kubectl get job "$SERVICE-custom-sql-scripts" -n "$NS"                 # COMPLETIONS 1/1
```

#### Pour aller plus loin {#explore-further-16}

- Ajoutez `03-select.sql` (`SELECT count(*) FROM lab_order_check;`) et modifiez un script quelconque pour que le Job soit recréé ; le décompte augmente à chaque exécution car `02` n'est pas idempotent — concevez vos vrais scripts de façon à pouvoir être réexécutés en toute sécurité.
- `custom_sql_scripts_use_root = true` et un script `CREATE EXTENSION IF NOT EXISTS pg_trgm;` montrent quand le rôle root est nécessaire.

#### Attention à {#watch-out-for-16}

- Les scripts s'exécutent dans l'ordre des **noms de fichiers** ; préfixez-les `01-`, `02-`…
- Les scripts doivent exister avant la mise à jour ; un préfixe manquant fait que le Job ne trouve rien.

#### Retour arrière {#revert-16}

```hcl
enable_custom_sql_scripts = false
custom_sql_scripts_bucket = ""
custom_sql_scripts_path   = ""
```

Supprimez ensuite le bucket prépositionné (la Tâche 6 le liste également) : `gcloud storage rm -r "gs://$SQL_BUCKET"`.

---

### Lab 19 — Accès & Réseau (Groupe 19) {#lab-19--access--networking-group-19}

> **Objectif :** Desservir l'application en HTTPS via l'équilibreur de charge global Gateway API — avec un certificat `nip.io` sans configuration ou votre propre domaine — et contrôler son IP statique.

**Vous allez :** activer la Gateway avec `enable_custom_domain = true` et sans domaine · observer le certificat géré passer à l'état ACTIVE et naviguer sur `https://<a-b-c-d>.nip.io` · voir le test de santé de la Gateway refléter votre sonde de vivacité · apprendre ce que provoque le renommage de l'IP statique.
**Durée :** 40 min (l'émission du certificat constitue la majeure partie) · **Coût :** un Application Load Balancer externe global et une IP statique globale · **Prérequis / configuration externe :** aucun pour `nip.io` ; un domaine et la possibilité de créer un enregistrement DNS `A` si vous utilisez le vôtre.

#### Paramètres de ce groupe {#settings-in-this-group-17}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_custom_domain` | `false` | **Non** | Active la Gateway (`gke-l7-global-external-managed`) avec des écouteurs HTTP et HTTPS et un certificat Certificate Manager. Sans `application_domains`, l'hôte est la forme avec tirets `<a-b-c-d>.nip.io` de l'IP de la Gateway. |
| `application_domains` | `[]` | **Non** | Vos noms d'hôtes ; chacun nécessite un enregistrement DNS `A` vers l'IP de la Gateway avant que le certificat ne puisse être émis. |
| `reserve_static_ip` | `true` | Oui | Réserve une IP statique : `<SERVICE>-lb-ip` (régionale) pour un LoadBalancer simple, `<SERVICE>-gateway-ip` (globale) pour la Gateway. |
| `static_ip_name` | `""` | **Non** | Remplace le nom de la ressource IP. Renommer libère l'ancienne adresse et en réserve une **nouvelle** — l'IP et l'hôte `nip.io` changent. |
| `network_tags` | `["nfsserver"]` | Oui | **Inerte** : fusionné dans une valeur que rien ne lit ; Autopilot ne permet pas à une charge de travail de définir des tags de nœuds. NFS n'en dépend pas. |
| `network_name` | `""` | Oui | VPC à utiliser ; requis uniquement lorsque plusieurs réseaux Services_GCP existent. |
| `gateway_backend_stage` | `"dev"` | Oui | Étape Cloud Deploy vers laquelle la Gateway achemine le trafic ; ignoré sans Cloud Deploy. |

#### Étape 1 — Configurer {#step-1--configure-17}

```hcl
enable_custom_domain = true      # Gateway + managed certificate
application_domains  = []        # empty -> zero-config <a-b-c-d>.nip.io host
reserve_static_ip    = true
```

Pour utiliser votre propre domaine à la place, définissez `application_domains = ["app.example.com"]` et, après l'apply, créez un enregistrement `A` pointant vers l'IP de la Gateway.

#### Étape 2 — Appliquer {#step-2--apply-17}

**Update** (avertissement : `enable_custom_domain` n'est pas update-safe). Attendez-vous à une IP globale `$SERVICE-gateway-ip`, une Gateway `$PREFIX-gateway`, une HTTPRoute `$PREFIX-route`, un `HealthCheckPolicy`, un `GCPBackendPolicy`, et des objets Certificate Manager `$SERVICE-cert-nipio` / `$SERVICE-cert-map`. La ressource régionale `$SERVICE-lb-ip` est **libérée** (la Gateway détient désormais l'adresse stable). ~10 minutes, puis jusqu'à une heure pour le certificat.

#### Étape 3 — Vérifier {#step-3--verify-17}

```bash
kubectl get gateway,httproute,healthcheckpolicy,gcpbackendpolicy -n "$NS"
export GW_IP=$(kubectl get gateway "$PREFIX-gateway" -n "$NS" -o jsonpath='{.status.addresses[0].value}')
export HOST="${GW_IP//./-}.nip.io"
echo "https://$HOST"

gcloud certificate-manager certificates list --project="$PROJECT" --filter="name~$SERVICE" \
  --format="table(name,managed.domains,managed.state)"        # PROVISIONING -> ACTIVE

# The Gateway health check mirrors health_check_config
kubectl get healthcheckpolicy "$PREFIX-health-check-policy" -n "$NS" -o jsonpath='{.spec.default.config}{"\n"}'   # requestPath /healthz

# Once the certificate is ACTIVE (and edge propagation has finished):
curl -s "https://$HOST/"; echo                 # Hello from Sample App! ...
curl -s "https://$HOST/whoami"; echo           # x_forwarded_for / x_forwarded_proto now set by the Google front end
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo $GKE_SERVICE_URL $DOMAIN'   # https://<a-b-c-d>.nip.io <a-b-c-d>.nip.io
```

Une Gateway fraîchement créée peut renvoyer `404`/`502` ou refuser le TLS pendant 5 à 15 minutes après avoir indiqué `PROGRAMMED`, et le certificat prend généralement 10 à 60 minutes. Ne cherchez pas à diagnostiquer le module pendant cette fenêtre.

#### Pour aller plus loin {#explore-further-17}

- **Confirmez qu'il n'y a pas de seconde porte d'entrée.** `kubectl get svc "$SERVICE" -n "$NS"` affiche désormais `ClusterIP` avec `EXTERNAL-IP <none>` : tant que la Gateway est active, un paramètre `LoadBalancer` est créé en tant que `ClusterIP`, de sorte que rien n'atteint les pods en contournant IAP ou Cloud Armor. L'ancienne IP L4 est libérée lorsque vous activez la Gateway, et une nouvelle est attribuée si vous la désactivez à nouveau. `NodePort` n'est pas converti et ses ports de nœud ne sont pas derrière la Gateway — évitez-le avec IAP ou Cloud Armor.
- Avec la Gateway active, ajoutez `uptime_check_config = { enabled = true, path = "/" }` (Lab 10) : le test sonde désormais `https://<a-b-c-d>.nip.io`.
- **Renommage d'IP statique (non update-safe) :** `static_ip_name = "lab-gke-ip"` réadresse la Gateway — nouvelle IP, nouvel hôte `nip.io`, nouveau certificat. Vérifiez avec `gcloud compute addresses list --filter="name=lab-gke-ip"`.
- Définissez `network_tags = ["lab-tag", "nfsserver"]` et confirmez que rien ne change (`kubectl get nodes -o wide` ne montre aucun nouveau tag, NFS toujours monté).

#### Attention à {#watch-out-for-17}

- Activer ou désactiver la Gateway modifie l'adresse publique : activée, l'IP régionale du LB est libérée ; désactivée, une nouvelle IP régionale est réservée. Mettez à jour les enregistrements DNS et vos favoris en conséquence.
- Utilisez la forme avec **tirets** `nip.io` (`1-2-3-4.nip.io`) ; la forme avec points résout également mais ne dispose pas de certificat.
- Un certificat géré par Google pour votre propre domaine reste dans l'état `PROVISIONING` jusqu'à ce que le DNS pointe vers l'IP de la Gateway.

#### Retour arrière {#revert-17}

```hcl
enable_custom_domain = false
application_domains  = []
static_ip_name       = ""
network_tags         = ["nfsserver"]
```

La Gateway, le certificat et l'IP globale sont supprimés et une nouvelle ressource régionale `$SERVICE-lb-ip` est réservée — relisez `LB_IP` (Tâche 2, étape 1). Supprimez tout enregistrement DNS que vous auriez créé.

---

### Lab 20 — Identity-Aware Proxy (Groupe 20) {#lab-20--identity-aware-proxy-group-20}

> **Objectif :** Exiger une authentification Google, limitée à des utilisateurs ou groupes nommés, avant que quiconque n'accède à l'application.

**Vous allez :** créer un client OAuth · activer IAP sur le backend de la Gateway · observer une requête anonyme redirigée vers la connexion Google et constater le succès d'une session de navigateur autorisée.
**Durée :** 30 min · **Coût :** faible · **Prérequis / configuration externe :** **[Configuration externe requise]** un écran de consentement OAuth et un client OAuth 2.0 (Console uniquement — la création programmatique est obsolète) ; la Gateway active (`enable_custom_domain = true` du Lab 19, ou `enable_cloud_armor = true` du Lab 21) ; `enable_cdn = false`. Vous pouvez lire ce lab sans la configuration externe — les garde-fous au moment du plan de l'Étape 2 se déclenchent sans elle.

#### Paramètres de ce groupe {#settings-in-this-group-18}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_iap` | `false` | Oui | Ajoute `iap` au `GCPBackendPolicy` et accorde `roles/iap.httpsResourceAccessor` au niveau du **projet** aux identités listées (plus l'identité effectuant le déploiement). |
| `iap_authorized_users` | `[]` | Oui | `user:…` ou `serviceAccount:…` (un e-mail brut se voit ajouter `user:`). |
| `iap_authorized_groups` | `[]` | Oui | `group:…`. Au moins un utilisateur ou groupe est requis (vérifié au plan). |
| `iap_oauth_client_id` | `""` | Oui (sensible) | Identifiant client OAuth. Requis (vérifié au plan). |
| `iap_oauth_client_secret` | `""` | Oui (sensible) | Stocké sous forme de Secret Kubernetes `<SERVICE>-iap-oauth`. Requis (vérifié au plan). |
| `iap_support_email` | `""` | Oui | Contact de support pour l'écran de consentement. Requis (vérifié au plan). |

#### Étape 1 — Configuration externe (Console) {#step-1--external-setup-console}

1. **APIs & Services → OAuth consent screen** : configurez-le (type *Internal* si votre projet est dans une organisation, sinon *External*), avec votre e-mail de support.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Créez-le, puis modifiez-le et ajoutez l'URI de redirection autorisé `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect` (en substituant le nouvel identifiant client).
3. Copiez l'identifiant client et le secret client.

#### Étape 2 — Configurer {#step-2--configure}

```hcl
enable_custom_domain    = true                       # Gateway with HTTPS (from Lab 19)
enable_cdn              = false                      # IAP and CDN are mutually exclusive
enable_iap              = true
iap_authorized_users    = ["user:<your-email>"]
iap_authorized_groups   = []
iap_oauth_client_id     = "<client-id>.apps.googleusercontent.com"
iap_oauth_client_secret = "<client-secret>"
iap_support_email       = "<your-email>"
```

Essayez d'abord **sans** l'identifiant/secret client ou l'e-mail de support : le plan échoue avec *"When enable_iap is true, both iap_oauth_client_id and iap_oauth_client_secret must be provided. Without credentials, IAP is silently disabled and the application is exposed without authentication."* — et les vérifications associées pour l'e-mail de support et une identité autorisée. Complétez-les ensuite et cliquez sur **Update**. ~5–10 minutes.

#### Étape 3 — Vérifier {#step-3--verify-18}

```bash
kubectl get gcpbackendpolicy "$PREFIX-backend-policy" -n "$NS" -o jsonpath='{.spec.default.iap}{"\n"}'   # enabled: true, clientID ...
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.role=roles/iap.httpsResourceAccessor" --format="value(bindings.members)"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://$HOST/"
# 302 https://accounts.google.com/...      (anonymous request -> Google sign-in)
```

Ouvrez `https://$HOST/` dans un navigateur connecté en tant qu'utilisateur autorisé : après connexion, vous voyez le compteur de visites. Un utilisateur ne figurant pas sur la liste voit une page d'accès refusé IAP.

#### Pour aller plus loin {#explore-further-18}

- `curl -s "https://$HOST/whoami"` depuis une session de navigateur autorisée affiche `X-Goog-Iap-Jwt-Assertion` parmi les **noms** d'en-têtes — l'assertion d'identité signée qu'une application peut vérifier.
- Essayez `enable_cdn = true` avec IAP activé : le plan échoue — *"Cloud CDN and IAP cannot be enabled together."*

#### Attention à {#watch-out-for-18}

- IAP ne protège que le chemin de la **Gateway**. Avec la Gateway activée, un Service `LoadBalancer` est créé en tant que `ClusterIP`, il n'y a donc pas de deuxième adresse (voir Lab 19 *Pour aller plus loin*) ; `service_type = "NodePort"` n'est pas converti et n'est pas derrière IAP — ne les combinez pas.
- Le rôle d'accès IAP est accordé au niveau du **projet**, il ouvre donc également les autres applications protégées par IAP dans le même projet aux mêmes personnes.
- Une liste d'autorisation vide est refusée au moment du plan plutôt que de verrouiller l'accès à tout le monde.

#### Retour arrière {#revert-18}

```hcl
enable_iap              = false
iap_authorized_users    = []
iap_oauth_client_id     = ""
iap_oauth_client_secret = ""
iap_support_email       = ""
```

`curl` vers `https://$HOST/` renvoie à nouveau 200. Supprimez le client OAuth dans la Console si vous n'en avez plus besoin.

---

### Lab 21 — Cloud Armor & CDN (Groupe 21) {#lab-21--cloud-armor--cdn-group-21}

> **Objectif :** Placer un WAF Cloud Armor devant l'application qui bloque les attaques courantes et limite le débit des clients, et voir précisément ce que `enable_cdn` fait sur GKE.

**Vous allez :** activer Cloud Armor (ce qui active la Gateway avec un certificat `nip.io` même sans le Lab 19) · localiser la règle associée au service backend de la Gateway · voir les requêtes de test SQLi/XSS passer de 200 à 403 · activer le CDN hors bande.
**Durée :** 35 min (propagation des règles ~5–10 min) · **Coût :** une règle Cloud Armor (frais mensuels + par règle) et l'équilibreur de charge global · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-19}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_cloud_armor` | `false` | **Non** | Crée la règle `<SERVICE>-waf-policy` (SQLi, XSS, LFI, RCE aux priorités 1000–1003 ; bannissement basé sur le débit de 500 req/min par IP à la priorité 2000 ; autorisation par défaut) et l'associe via le `GCPBackendPolicy`. Active la Gateway. Nécessite `service_type = "LoadBalancer"` ou `enable_custom_domain` (vérifié au plan). |
| `admin_ip_ranges` | `[]` | Oui | CIDR autorisés à la priorité 100, avant les règles du WAF. Également utilisé comme niveau d'accès administrateur VPC-SC (Lab 22). |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Oui | **Non appliqué.** Avec Armor activé, le module crée et associe toujours sa propre règle `<SERVICE>-waf-policy` ; avec Armor désactivé, aucune règle n'est associée. |
| `enable_cdn` | `false` | Oui | Active uniquement le chemin de la Gateway. Le `GCPBackendPolicy` ne possède pas de champ CDN, le service backend conserve donc `enableCDN: false` jusqu'à ce que vous activiez le CDN vous-même. Mutuellement exclusif avec IAP. |

#### Étape 1 — Configurer {#step-1--configure-18}

```hcl
enable_cloud_armor = true
admin_ip_ranges    = ["203.0.113.0/24"]     # documentation range; use your office CIDR in real life
enable_cdn         = true                   # only if IAP (Lab 20) is OFF
```

#### Étape 2 — Appliquer {#step-2--apply-18}

**Update** (avertissement : `enable_cloud_armor` n'est pas update-safe). Si la Gateway n'était pas déjà active (Lab 19 révoqué), elle est créée maintenant avec un certificat `nip.io`, et l'IP régionale du LB est libérée. ~10 minutes, plus le temps d'émission du certificat.

#### Étape 3 — Vérifier {#step-3--verify-19}

```bash
gcloud compute security-policies describe "$SERVICE-waf-policy" --project="$PROJECT" \
  --format="table(rules.priority,rules.action,rules.description)"
# 100 allow (admin), 1000-1003 deny(403), 2000 rate_based_ban, 2147483647 allow

BS=$(gcloud compute backend-services list --project="$PROJECT" --global \
  --filter="securityPolicy~$SERVICE-waf-policy" --format="value(name)")
echo "Backend service: $BS"
gcloud compute backend-services describe "$BS" --global --project="$PROJECT" --format="yaml(securityPolicy,enableCDN)"
# securityPolicy: .../<SERVICE>-waf-policy   enableCDN: false

export GW_IP=$(kubectl get gateway "$PREFIX-gateway" -n "$NS" -o jsonpath='{.status.addresses[0].value}')
export HOST="${GW_IP//./-}.nip.io"
curl -s -o /dev/null -w "normal: %{http_code}\n" "https://$HOST/"
curl -s -o /dev/null -w "xss:    %{http_code}\n" "https://$HOST/?q=%3Cscript%3Ealert(1)%3C/script%3E"
curl -s -o /dev/null -w "sqli:   %{http_code}\n" "https://$HOST/?id=1%27%20OR%20%271%27=%271"
# normal 200; xss 403; sqli 403  (allow ~5-10 minutes after the apply for the rules to take effect)
```

Activez le CDN vous-même (le module ne peut pas le faire), puis confirmez :

```bash
gcloud compute backend-services update "$BS" --global --project="$PROJECT" --enable-cdn
gcloud compute backend-services describe "$BS" --global --project="$PROJECT" --format="value(enableCDN)"   # True
```

#### Pour aller plus loin {#explore-further-19}

- Envoyez 600 requêtes en moins d'une minute (`for i in $(seq 600); do curl -s -o /dev/null -w "%{http_code}\n" "https://$HOST/healthz"; done | sort | uniq -c`) — dès que la règle basée sur le débit se déclenche, les réponses basculent sur `429`.
- Ajoutez votre propre IP publique (`curl -s https://ifconfig.me`) dans `admin_ip_ranges = ["<your-ip>/32"]` ; le test XSS renvoie alors 200, car la priorité 100 vous autorise avant les règles du WAF.

#### Attention à {#watch-out-for-19}

- La propagation des règles prend **5 à 10 minutes** ; un 200 immédiat sur un test d'attaque n'est pas un échec.
- `cloud_armor_policy_name` ne sélectionne pas de règle — seule la propre règle du module est systématiquement associée.
- Armor ne protège que la Gateway. Une IP L4 externe restante sur le Service (Lab 19 *Pour aller plus loin*) n'est pas protégée.
- Un paramètre CDN ajouté hors bande est géré par le contrôleur Gateway de GKE, qui peut le réinitialiser lors de la réconciliation du backend — revérifiez `enableCDN` après les mises à jour ultérieures.

#### Retour arrière {#revert-19}

```hcl
enable_cloud_armor = false
admin_ip_ranges    = []
enable_cdn         = false
```

La règle est détachée et supprimée ; si aucune autre fonctionnalité des Groupes 19–21 ne maintient la Gateway, celle-ci est supprimée et une IP régionale de LB est à nouveau réservée (relisez `LB_IP`).

---

### Lab 22 — VPC Service Controls & Journalisation d'audit (Groupe 22) {#lab-22--vpc-service-controls--audit-logging-group-22}

> **Objectif :** Activer les Cloud Audit Logs détaillés pour le projet, et comprendre comment le module construit — ou refuse honnêtement de construire — un périmètre VPC Service Controls.

**Vous allez :** activer les journaux d'audit d'accès aux données et les relire · demander un périmètre VPC-SC en mode simulation (dry-run) et lire le compte-rendu du module indiquant s'il a été créé ou non.
**Durée :** 15 min · **Coût :** augmentation du volume Cloud Logging · **Prérequis / configuration externe :** **[Configuration externe requise pour VPC-SC]** le projet doit appartenir à une **organisation**, le déployeur doit disposer des droits d'administrateur Access Context Manager au niveau de l'organisation, `admin_ip_ranges` ne doit pas être vide, et un projet imbriqué dans un dossier nécessite `organization_id`. Dans un projet géré par RAD, les champs VPC-SC sont masqués. La journalisation d'audit ne nécessite rien d'externe.

#### Paramètres de ce groupe {#settings-in-this-group-20}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Oui · masqué dans les projets gérés par RAD | Crée un périmètre standard avec des niveaux d'accès pour le VPC, les IP d'administration, IAP et le CI/CD. Ignore avec un avertissement (et indique `vpc_sc_enabled = false`) lorsqu'aucune organisation ne peut être trouvée, que `admin_ip_ranges` est vide, ou que le déployeur ne dispose pas des autorisations requises. |
| `vpc_cidr_ranges` | `[]` | Oui · masqué dans les projets gérés par RAD | CIDR du VPC pour le niveau d'accès réseau ; vide = découvert (valeur de secours `10.0.0.0/8`). |
| `vpc_sc_dry_run` | `true` | Oui · masqué dans les projets gérés par RAD | Journaliser les violations sans bloquer. Conservez `true` jusqu'à ce que les journaux soient exempts d'erreurs. |
| `organization_id` | `""` | Oui · masqué dans les projets gérés par RAD | Requis pour les projets imbriqués dans un dossier ; découvert automatiquement sinon. |
| `enable_audit_logging` | `false` | **Non** | Configurations d'audit du projet pour `allServices` (`ADMIN_READ`, `DATA_READ`, `DATA_WRITE`) plus les surcharges Secret Manager et Cloud KMS. |

#### Étape 1 — Configurer {#step-1--configure-19}

```hcl
enable_audit_logging = true
# Only in a bring-your-own project inside an organisation:
# enable_vpc_sc    = true
# vpc_sc_dry_run   = true
# admin_ip_ranges  = ["<your-ip>/32"]     # Group 21 field; required for VPC-SC
# organization_id  = "<your-org-id>"      # if the project sits under a folder
```

#### Étape 2 — Appliquer {#step-2--apply-19}

**Update** (avertissement sur `enable_audit_logging`). ~3 minutes.

#### Étape 3 — Vérifier {#step-3--verify-20}

```bash
gcloud projects get-iam-policy "$PROJECT" --format="yaml(auditConfigs)"
# allServices, secretmanager.googleapis.com, cloudkms.googleapis.com with DATA_READ / DATA_WRITE / ADMIN_READ

curl -s "http://$LB_IP/" >/dev/null     # generate a secret read on the next pod start, or wait a few minutes
gcloud logging read 'logName:"cloudaudit.googleapis.com%2Fdata_access"' --project="$PROJECT" --limit=5 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

Si vous avez également demandé VPC-SC, le journal d'apply contient un avertissement lorsque le périmètre est ignoré, et les sorties de la plateforme indiquent `vpc_sc_enabled = false` sans nom de périmètre — le module indique ce qui s'est réellement passé plutôt que ce que vous avez demandé. Lorsqu'il est créé : `gcloud access-context-manager perimeters list --policy=<policy-id>` et les violations du mode simulation sous `protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"`.

#### Pour aller plus loin {#explore-further-20}

- Dans **IAM & Admin → Audit Logs**, observez les cases à cocher par service que le module a définies.
- Avec un périmètre en mode simulation (dry-run), examinez une journée de journaux de violation avant de définir `vpc_sc_dry_run = false`.

#### Attention à {#watch-out-for-20}

- Les configurations d'audit s'appliquent **à l'ensemble du projet** : elles affectent la journalisation (et les coûts) pour chaque service du projet, et une autre application qui les gère également peut les écraser ou les supprimer.
- Appliquer VPC-SC sans examiner les journaux du mode simulation (dry-run) peut casser simultanément les téléchargements d'images, le proxy Cloud SQL et les lectures Secret Manager.

#### Retour arrière {#revert-20}

```hcl
enable_audit_logging = false
enable_vpc_sc        = false
```

---

## Tâche 3 — Exploiter et maintenir en conditions opérationnelles (Day-2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail** — contrôleur, pods, autoscaler, budget de perturbation et volumes :

   ```bash
   kubectl get deploy,sts,pods,hpa,pdb,pvc -n "$NS"
   kubectl describe "$WL" -n "$NS"
   kubectl top pods -n "$NS" --containers            # live CPU/memory per container
   ```

2. **Ajuster l'échelle** en modifiant `min_instance_count` / `max_instance_count` et en cliquant sur **Update** sur la page des détails du déploiement — le module gère la spécification de la charge de travail et le HPA, de sorte que le redimensionnement correspond à un changement de configuration et non à un `kubectl scale` manuel (une modification manuelle est écrasée par le HPA ou par le prochain apply). Le HPA ne descend jamais en dessous de 1 réplica, `min_instance_count = 0` ne met donc pas l'application en veille ; pour libérer de la capacité de cluster sur un projet de lab, supprimez le déploiement lorsque vous avez terminé (Tâche 6).

3. **Mettre à jour la version de l'application** en modifiant `application_version` via **Update** sur la page des détails du déploiement ; une nouvelle image est compilée et les pods sont remplacés (Recreate tant que NFS est monté, attendez-vous donc à une brève interruption).

4. **Redémarrer les pods** pour intégrer les secrets renouvelés ou une image republiée :

   ```bash
   kubectl rollout restart "$WL" -n "$NS" && kubectl rollout status "$WL" -n "$NS" --timeout=300s
   ```

5. **Gérer les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE"
   kubectl get jobs,cronjobs -n "$NS"                       # init jobs, db-export, your cron jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"
   ```

6. **Relancer un job de configuration de base de données** (par exemple après un changement manuel de mot de passe) en le recréant à partir de sa définition :

   ```bash
   kubectl get job "$SERVICE-db-create" -n "$NS" -o json \
     | python3 -c "import json,sys; j=json.load(sys.stdin); m=j['metadata']; [m.pop(k,None) for k in ('uid','resourceVersion','creationTimestamp','managedFields','ownerReferences')]; m['name']+='-rerun'; s=j['spec']; s.pop('selector',None); s['template']['metadata'].get('labels',{}).pop('controller-uid',None); s['template']['metadata'].get('labels',{}).pop('batch.kubernetes.io/controller-uid',None); j.pop('status',None); print(json.dumps(j))" \
     | kubectl apply -f -
   kubectl logs -n "$NS" job/"$SERVICE"-db-create-rerun --all-containers | tail -5
   kubectl delete job "$SERVICE-db-create-rerun" -n "$NS"
   ```

7. **Inspecter la base de données** — l'instance partagée utilise une IP privée, vérifiez-la donc depuis la vue propre à l'application plutôt qu'en vous connectant depuis votre poste de travail :

   ```bash
   curl -s "http://$LB_IP/db"; echo
   gcloud sql instances describe "$INSTANCE" --project="$PROJECT" --format="yaml(state,databaseVersion,settings.tier)"
   ```

---

## Tâche 4 — Observer : Logging & Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" "$WL" -c "$APP" --tail=50            # gunicorn access/error log
   kubectl logs -n "$NS" "$WL" -c cloud-sql-proxy --tail=20     # proxy connections
   kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail -20
   ```

   Filtre Logs Explorer (remplacez l'espace de noms) :

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="<your-namespace>"
   ```

   Ajoutez `resource.labels.container_name="gkeapp"` pour l'application uniquement, ou `severity>=ERROR` pour les échecs.

2. **Surveillance** — avec `support_users` configuré (Lab 2), ouvrez **Monitoring → Dashboards → App_GKE Application - GKE Dashboard**, et examinez **Alerting → Policies** (utilisation du processeur et de la mémoire, ainsi que votre alerte du Lab 10) et **Uptime checks** (Lab 10). La page **Kubernetes Engine → Workloads** affiche le processeur, la mémoire et le nombre de redémarrages par pod.

3. **Vue du répartiteur de charge** — une fois la Gateway active (Labs 19 à 21), **Network services → Load balancing** affiche le débit des requêtes, la latence et l'état de santé du backend, et les décisions de Cloud Armor apparaissent dans les journaux de requêtes du répartiteur de charge (`resource.type="http_load_balancer"`, champ `jsonPayload.enforcedSecurityPolicy`).

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques pérennes, complétées par les modes de défaillance observés lors des tests de ce module groupe par groupe sur un projet réel.

- **L'apply a réussi mais il n'y a aucune charge de travail (pas d'espace de noms, pas de pods).** Le module découvre le cluster et lit son état par emprunt d'identité de `resource_creator_identity` ; si cet emprunt d'identité est refusé, la lecture de l'état échoue. Les anciennes versions considéraient cela comme une absence de cluster et ignoraient chaque ressource Kubernetes tout en signalant un succès. Désormais, le module **fait échouer le plan** avec *"Cluster '…' was discovered … but its status could not be read"* et la commande `gcloud … --impersonate-service-account` exacte pour reproduire l'erreur. Corrigez l'autorisation d'emprunt d'identité ou (en dehors de la plateforme) utilisez l'identité de l'appelant.
- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux :

  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events: scheduling, probe, mount, image errors
  kubectl logs -n "$NS" <pod> -c "$APP" --previous
  ```

  `exitCode 137` avec `reason: Error` correspond à un **arrêt par la sonde** (probe kill), et non à un manque de mémoire (qui indique `OOMKilled`). Vérifiez que le chemin de sonde renvoie un code 200 littéral au niveau du pod (Tâche 2, étape 3).
- **`/` indique "DB unavailable" ou `/db` renvoie une erreur 500 :** confirmez que le sidecar `cloud-sql-proxy` fonctionne (`kubectl get pod … -o jsonpath='{.status.containerStatuses[*].name}'`), que les jobs `db-create`/`db-init` ont réussi et que `$PREFIX-secrets` existe. Lorsque la segmentation réseau est activée (Lab 6), vérifiez la règle Cloud SQL de la NetworkPolicy. Après une rotation de mot de passe, redémarrez les pods (Lab 16).
- **Le job d'initialisation a échoué ou n'a jamais tourné :** `kubectl get jobs -n "$NS"` et `kubectl logs -n "$NS" job/<name> --all-containers`. Un job qui atteint `job_active_deadline_seconds` signale `DeadlineExceeded` — sur un cluster Autopilot à froid, l'approvisionnement des nœuds est décompté du budget. Une chaîne de dépendances de plus de quatre niveaux fait échouer le plan au lieu de ne pas s'exécuter silencieusement.
- **Pod en attente (Pending) :** les événements `kubectl describe pod` en indiquent la cause — `exceeded quota` (Lab 8 ; augmentez le quota ou utilisez des suffixes de mémoire binaires), `Insufficient cpu/memory` pendant qu'Autopilot ajoute un nœud (patientez), ou `FailedScaleUp` (quota de processeur du projet — réduisez les autres applications). Un PVC `Pending` sur SSD signifie souvent que le quota régional `SSD_TOTAL_GB` est épuisé ; utilisez `stateful_pvc_storage_class = "standard"`.
- **Aucune adresse IP externe / `<pending>` :** `kubectl describe svc "$SERVICE" -n "$NS"` ; un quota d'adresses (`IN_USE_ADDRESSES`, `STATIC_ADDRESSES`) est épuisé — libérez les adresses inutilisées (`gcloud compute addresses list --filter="status=RESERVED"`).
- **La Gateway renvoie une erreur 503 / 404 / aucun TLS :** patientez 5 à 15 minutes après `PROGRAMMED` et jusqu'à une heure pour le certificat. Si le problème persiste, testez le chemin de santé au niveau du pod — le test de santé de la Gateway nécessite un code `200` littéral, alors que kubelet accepte les redirections. `gcloud compute backend-services get-health` affichant `EMPTY` n'est pas informatif ; fiez-vous à la réponse HTTP via le répartiteur de charge.
- **Un paramètre a été « appliqué » mais rien n'a changé :** consultez les sections *Watch out for* du lab — `container_resources`, `stateful_fs_group`, `service_annotations`/`service_labels` (à la création uniquement), `network_tags`, `application_database_name`/`user`, `cloud_armor_policy_name`, les paramètres de rétention du registre (inopérants sur un socle), et les clés d'objet mal orthographiées (ignorées silencieusement).
- **La mise à jour du StatefulSet échoue avec "Missing Resource Identity After Update" :** un bug du fournisseur (provider). Relancez **Update** sans modification ; lors des tests, la seconde exécution a abouti à chaque fois.
- **Échec de la compilation ou de la mise en miroir de l'image :** examinez **Cloud Build → History** ; la charge de travail conserve son image précédente.
- **Erreurs 403 / autorisations depuis l'application :** le pod s'exécute avec le compte de service Kubernetes associé par Workload Identity à `gke-sa-<PREFIX>` ; chaque secret lu par l'application doit attribuer à ce compte de service le rôle `secretAccessor` (le module s'en charge pour les secrets dont il a connaissance — vérifiez avec `gcloud secrets get-iam-policy`).

Reportez-vous à la section *Configuration Pitfalls* du guide de configuration pour connaître les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône de **Corbeille** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne parvient plus à le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette option retire le déploiement des registres de RAD **sans** détruire les ressources cloud (elle amène RAD à oublier le déploiement). Cela supprime l'ensemble des éléments créés par le module — la charge de travail
et l'espace de noms Kubernetes, la base de données et l'utilisateur, les secrets Secret Manager, les buckets GCS,
les jobs Kubernetes, la Gateway et les IP statiques, la stratégie Cloud Armor et les objets de surveillance. Les ressources détenues par **Services_GCP**
(le VPC, le cluster GKE, l'instance partagée Cloud SQL, le serveur NFS, le registre) sont gérées séparément et ne sont
pas supprimées ici.

**Éléments laissés par les labs de fonctionnalités — à supprimer par vous-même :**

| Laissé par | Élément | Comment le supprimer |
|---|---|---|
| Lab 5 | Secret `lab-gke-api-key` (créé en dehors du module) | `gcloud secrets delete lab-gke-api-key --project="$PROJECT"` |
| Lab 7 / Lab 9 | PersistentVolumeClaims (et leurs disques) si vous avez restauré l'état antérieur du StatefulSet avant la suppression | `kubectl get pvc -A \| grep "$SERVICE"` ; supprimez-les, puis vérifiez avec `gcloud compute disks list --filter="name~pvc"` |
| Lab 11 / Lab 17 | Jobs manuels (`lab-cron-manual`, `lab-export-now`) | Supprimés avec l'espace de noms ; supprimez-les plus tôt avec `kubectl delete job … -n "$NS"` |
| Lab 14 | Porte-clés KMS et `storage-key` (GCP ne supprime jamais les clés) | Rien à faire ; les clés désactivées/inutilisées ne coûtent presque rien. Détruisez les versions de clé dans **Security → Key Management** si nécessaire |
| Lab 18 | Votre bucket SQL de transit | `gcloud storage rm -r "gs://$SQL_BUCKET"` |
| Lab 19 | Enregistrements DNS `A` pour votre propre domaine | Supprimez-les chez votre fournisseur DNS |
| Lab 20 | Client OAuth et écran de consentement | **APIs & Services → Credentials** |
| Lab 21 | CDN activé hors bande | Supprimé avec le service de backend lors de la suppression de la Gateway |
| Lab 12 | Attestateur Binary Authorization, note et clé de signature ; stratégie de projet | Partagés avec d'autres applications — conservez-les à moins que le projet ne vous appartienne exclusivement |

Après la suppression, confirmez :

```bash
kubectl get ns "$NS"                                                     # NotFound
gcloud compute addresses list --project="$PROJECT" --filter="name~$SERVICE"   # empty
gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"   # empty
```

Une IP statique ou une adresse VPC peut nécessiter 20 à 30 minutes pour être libérée après la suppression de son répartiteur de charge ; si une suppression échoue sur une adresse encore utilisée, patientez et réessayez.

---

## Annexe — Variables d'interconnexion de la plateforme du groupe 0 {#appendix--group-0-platform-wiring-variables}

Ces variables ne sont jamais affichées sur le formulaire. La plateforme ou un module wrapper (tel que `Ghost_GKE`) les définit ; laissez-les à leurs valeurs par défaut lors d'un déploiement direct de `App_GKE`.

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `module_description` | module blurb | Description du catalogue affichée dans la plateforme. |
| `module_documentation` | Configuration Guide URL | Lien d'aide dans la plateforme. |
| `module_dependency` | `["Services_GCP"]` | Modules devant être déployés au préalable. |
| `module_services` | GCP service list | Liste lisible des services GCP pour la boîte de dialogue de confirmation. |
| `requires_services` | `create_postgres`, `create_network_filesystem`, `create_google_kubernetes_engine` … | Fonctionnalités de Services_GCP que la plateforme doit activer pour ce module. |
| `credit_cost` | `0` | Coût en crédits de plateforme. |
| `require_credit_purchases` | `false` | Frais payables uniquement à partir de crédits achetés. |
| `enable_purge` | `true` | Autorise la suppression complète des ressources du module. |
| `public_access` | `true` | Référencé dans le catalogue public. |
| `require_services_gcp_module` | `true` | Fait échouer le plan si aucun réseau Services_GCP n'existe. |
| `shared_users` | `[]` | Utilisateurs autorisés à voir et déployer le module indépendamment de `public_access`. |
| `technical_support_users` | `[]` | Contacts de support pour le module. |
| `enable_multi_cluster_service` | `false` | Réservé à Multi-Cluster Services ; ne crée rien dans cette version. |
| `postgres_extensions` | `[]` | Liste d'extensions utilisée avec `enable_postgres_extensions` (Lab 16). |
| `mysql_plugins` | `[]` | Liste de plugins utilisée avec `enable_mysql_plugins` (Lab 16). |
| `resource_creator_identity` | RAD service account | Identité que Terraform emprunte pour créer les ressources et sonder le cluster. |
| `impersonation_service_account` | `""` | Identité pour les appels GCP des scripts utilitaires (déploiements inter-projets). |
| `job_execution_wait_timeout` | `900` | Secondes pendant lesquelles l'apply attend le job `db-create`. |
| `explicit_secret_values` | `{}` | Valeurs secrètes fournies directement par un module wrapper. |
| `scripts_dir` | `""` | Remplacement du répertoire de scripts pour un wrapper ; vide = `scripts/` de ce module. |

## Résumé {#summary}

| Tâche / Lab | Type | Résultat |
|---|---|---|
| Tâche 1 — Déployer la configuration de référence | Automatisé | Le module déploie l'exemple d'application Flask dans le cluster GKE Autopilot partagé avec une base de données, NFS, des jobs d'initialisation et une IP externe |
| Tâche 2 — Accéder et vérifier | Manuel | Les quatre points de terminaison répondent ; BD, secrets, variables d'environnement, montages, jobs et image confirmés sur les objets réels |
| Lab 2 — Identité de déploiement | Fonctionnalité | Destinataires d'alertes, tableau de bord et alertes par défaut ; libellés sur les ressources existantes |
| Lab 3 — Identité de l'application | Fonctionnalité | Nom d'affichage/description modifiés sans rien renommer ; l'incrément de version reconstruit l'image |
| Lab 4 — Runtime et mise à l'échelle | Fonctionnalité | Min/max du HPA respectés ; ressources de conteneur démontrées comme modifiables à la création uniquement ; garde-fou VPA illustré |
| Lab 5 — Variables d'environnement et secrets | Fonctionnalité | Variables d'environnement simples, variables Secret Manager via SecretSync et protection automatique des valeurs nommées comme des identifiants |
| Lab 6 — GKE Backend Config | Fonctionnalité | Port de Service supplémentaire, affinité, délai de grâce et NetworkPolicy maintenant le bon fonctionnement du LB, de la BD et de Redis |
| Lab 7 — StatefulSet / PVC | Fonctionnalité | StatefulSet avec un PVC HDD ; persistance prouvée par un cycle écriture-redémarrage-lecture |
| Lab 8 — Quota de ressources | Fonctionnalité | Quota d'espace de noms avec marge de montée en charge (surge) ; rejet des valeurs de mémoire sous forme d'entier brut |
| Lab 9 — Fiabilité | Fonctionnalité | PDB autorisant une perturbation ; répartition topologique par zone/nœud |
| Lab 10 — Observabilité | Fonctionnalité | Temporisations des sondes sur le pod en production ; test de disponibilité sur l'hôte `nip.io` ; alerte personnalisée |
| Lab 11 — Automatisation des charges de travail | Fonctionnalité | Jobs d'initialisation ordonnés, exécution à la demande d'un CronJob et composant pair joint par URL injectée |
| Lab 12 — CI/CD | Fonctionnalité (CI/CD externe) | Binary Authorization appliquée à l'échelle du cluster ; présentation guidée de CI/CD et Cloud Deploy |
| Lab 13 — Stockage NFS | Fonctionnalité | Point de montage NFS déplacé et persistance prouvée ; démonstration de NFS hébergeant Redis |
| Lab 14 — Cloud Storage | Fonctionnalité | Bucket + montage GCS Fuse écrit par l'utilisateur non-root ; CMEK sur les buckets |
| Lab 15 — Cache Redis | Fonctionnalité | Changement de port et basculement de `REDIS_URL` vers `REDIS_AUTH` lors de la définition d'un mot de passe |
| Lab 16 — Configuration de la base de données | Fonctionnalité | Alias de variables d'environnement de BD ; nom/utilisateur inopérants démontrés ; rotation réelle du mot de passe avec reconnexion |
| Lab 17 — Sauvegarde et maintenance | Fonctionnalité | Calendrier d'exportation, sauvegarde à la demande, test de restauration validé sur sa sortie SQL |
| Lab 18 — Scripts SQL personnalisés | Fonctionnalité | Scripts ordonnés depuis votre bucket exécutés en tant qu'utilisateur de l'application |
| Lab 19 — Accès et réseau | Fonctionnalité | Gateway avec HTTPS `nip.io` sans configuration requise ; comportement de l'IP statique |
| Lab 20 — Identity-Aware Proxy | Fonctionnalité (externe) | Requêtes anonymes redirigées vers la connexion Google ; les utilisateurs autorisés passent |
| Lab 21 — Cloud Armor et CDN | Fonctionnalité | WAF attaché et bloquant SQLi/XSS ; CDN activé hors bande |
| Lab 22 — VPC-SC et journaux d'audit | Fonctionnalité (VPC-SC externe) | Journaux d'audit des accès aux données du projet activés ; restitution fidèle du résultat sur le périmètre VPC-SC |
| Tâche 3 — Exploiter | Manuel | Inspecter, dimensionner, mettre à jour, redémarrer, gérer les secrets/jobs/stockages, réexécuter la configuration de la BD |
| Tâche 4 — Observer | Manuel | Journaux des conteneurs et du LB ; tableau de bord, alertes et tests de disponibilité |
| Tâche 5 — Dépanner | Manuel | Diagnostiquer les déploiements silencieux sans effet, les problèmes de pods, de BD, de jobs, de planification, de quota, de Gateway et les paramètres « appliqués mais sans effet » |
| Tâche 6 — Démanteler | Automatisé | Delete supprime toutes les ressources du module ; nettoyez ce que les labs ont créé en dehors du module |
