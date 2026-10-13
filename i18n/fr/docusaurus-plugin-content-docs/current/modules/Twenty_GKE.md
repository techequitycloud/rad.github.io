---
title: "Twenty CRM sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Twenty CRM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Twenty_GKE.md @ e69407af sha256:c3666942a47f -->

# Twenty CRM sur GKE Autopilot {#twenty-crm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Twenty_GKE.png" alt="Twenty CRM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Twenty est un CRM open source avec plus de 25 000 étoiles sur GitHub, conçu comme
une alternative moderne et conviviale pour les développeurs à Salesforce et HubSpot.
Ce module déploie Twenty sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Twenty et sur la manière
de les explorer et de les opérer depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et le cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Coût de Twenty sur RAD et comparaison {#what-twenty-costs-on-rad-and-how-that-compares}

**L'exécution de Twenty sur GKE Autopilot dans votre propre projet Google Cloud
coûte environ 106,53 $ US/mois en frais Google Cloud** (environ 179,53 $ US si
ce n'est pas votre seul cluster Autopilot), en plus d'un coût de module RAD
unique de 175 crédits (17,50 $ US) — plus élevé que le coût du module Cloud Run
car cette variante exécute également son propre volume NFS partagé sur GKE. GKE
Autopilot convient à Twenty qui doit rester opérationnel, s'adapter à plusieurs
pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le
coût le plus bas, consultez plutôt le [guide Cloud Run](Twenty_CloudRun.md).
Dans un projet géré par RAD, le coût du module tombe à 157,5 crédits (10 % de
moins) — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Coût du module (unique) | 175 crédits | 157,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 106,53 $ US/mois, facturé par Google au prix catalogue | ~92 crédits/jour (environ 2760/mois, 276 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **106,53 $ US** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont
partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule,
sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comparaison {#how-it-compares}

- Les frais de cloud hébergés par Twenty sont facturés par utilisateur : Pro est
  à 9 $/utilisateur/mois et Organisation à 19 $/utilisateur/mois (facturé
  annuellement) — vérifié sur la page de tarification de Twenty, le 8 octobre
  2026. Le coût d'exécution de RAD dans votre propre projet est un forfait
  d'environ 107 $/mois, quel que soit le nombre d'utilisateurs.
- Salesforce et HubSpot, les acteurs historiques que Twenty vise à remplacer,
  proposent leurs niveaux CRM payants bien au-delà de 25-50 $/utilisateur/mois.
- Une comparaison avec un VPS auto-géré, dimensionné aux valeurs par défaut de
  Twenty (1 vCPU / 1 Gio) : un Hetzner CPX22 ou un Droplet DigitalOcean 2
  vCPU/4Go coûte environ 24 $/mois — plus votre propre temps pour les
  sauvegardes et les correctifs que la pile gérée de RAD couvre, et un plan de
  contrôle Kubernetes que cette comparaison n'a pas à exécuter du tout.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le
projet — une suppression logique récupérable de 30 jours propre à Google.
Contrairement à la suppression d'un seul module, cela ne démantèle **pas**
Cloud SQL, aucune VM, ni la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau le coût du module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
affirme que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé Twenty et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un
projet géré par RAD, il n'y a pas de pause gratuite — la suppression supprime
définitivement les ressources, et ramener Twenty signifie redéployer à partir
de zéro. Cela coûte environ 178-181 crédits dans votre propre projet, ou
environ 160,5-163,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Twenty devait rester
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution — environ 5 jours ou plus dans votre
propre projet (environ 3,55 $ US par jour), ou environ 2 jours ou plus dans un
projet géré par RAD (92 crédits par jour).

Gardez d'abord les données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits non utilisés sont restitués au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, de sorte que personne
ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et
les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ; [tarification de Twenty](https://twenty.com/pricing).

## 1. Vue d'ensemble {#1-overview}

Twenty fonctionne comme une charge de travail Node.js. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 1 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Twenty ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Optionnel ; un bucket de stockage dédié lorsque `enable_gcs_storage = true` |
| Tâches en arrière-plan | Redis (optionnel) | bull-mq lorsqu'il est activé ; pg-boss (basé sur PostgreSQL) par défaut sans infrastructure supplémentaire |
| Secrets | Secret Manager | Secret d'application auto-généré (`APP_SECRET` / `ENCRYPTION_KEY`) et mot de passe de base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ;
  la sélection de MySQL ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Twenty v0.4+ code en dur Redis pour le
  stockage de session et de cache — sans une connexion Redis valide, Twenty ne
  démarre pas. Lorsque `redis_host` est laissé vide, l'IP de la VM NFS de la
  plateforme est utilisée (nécessite `enable_nfs = true` ou un `redis_host` explicite).
- **pg-boss est la file d'attente de tâches lorsque Redis est désactivé.** Il
  ne nécessite aucune infrastructure supplémentaire et utilise directement la
  base de données PostgreSQL.
- **Les pièces jointes sont stockées par défaut dans un stockage local
  éphémère.** Activez `enable_gcs_storage` pour un stockage d'objets persistant
  utilisant GCS.
- **Trois tâches d'initialisation s'exécutent avant le démarrage du
  serveur.** `db-init` crée la base de données et l'utilisateur ;
  `twenty-migrate` exécute les migrations de schéma TypeORM ; `twenty-verify` est
  une tâche de garde qui fait échouer l'apply si le schéma `core` n'a pas
  de tables, signalant bruyamment une migration concurrente/échouée au lieu de
  déployer un pod sain contre une base de données vide. Les migrations de base
  de données sont désactivées dans le conteneur principal (`DISABLE_DB_MIGRATIONS=true`)
  pour maintenir des démarrages à froid rapides après le premier démarrage.
- **`SERVER_URL` et `FRONT_BASE_URL` doivent être définis manuellement.** Sans
  eux, les liens d'API, CORS et les invitations par e-mail sont rompus.
- Le **APP_SECRET / ENCRYPTION_KEY** est généré automatiquement et stocké dans
  Secret Manager ; vous ne le définissez jamais en texte clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Twenty {#a-gke-autopilot--the-twenty-workload}

Les pods Twenty sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Twenty pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Twenty stocke toutes les données d'application (contacts, pipelines, objets
personnalisés) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods
y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix,
de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement,
trois Jobs d'initialisation s'exécutent en séquence : `db-init` crée la base de
données et l'utilisateur, `twenty-migrate` exécute les migrations de schéma en
utilisant le point d'entrée propre à Twenty, et `twenty-verify` protège contre un
schéma vide en faisant échouer l'apply si les migrations n'ont pas réellement
créé de tables.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage (stockage de fichiers optionnel) {#c-cloud-storage-optional-file-storage}

Lorsque `enable_gcs_storage = true`, un bucket **Cloud Storage** dédié est provisionné et
Twenty est configuré pour utiliser l'API compatible S3 de GCS (`STORAGE_TYPE=s3`).
Sans cela, les pièces jointes sont stockées dans le système de fichiers local
éphémère du pod et sont perdues lors d'un redémarrage ou d'une mise à jour
glissante.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Note : lorsque `enable_gcs_storage = true`, vous devez fournir des clés HMAC GCS via
`secret_environment_variables` (`STORAGE_S3_ACCESS_KEY_ID` et `STORAGE_S3_SECRET_ACCESS_KEY`).
Générez-les dans la Console sous Cloud Storage → Settings → Interoperability.

### D. Redis (tâches en arrière-plan) {#d-redis-background-jobs}

Redis prend en charge le stockage de session et de cache de Twenty dans la
v0.4+ et, lorsqu'il est activé, bascule le traitement en arrière-plan vers
**bull-mq**. Sans Redis, Twenty utilise **pg-boss** (une file d'attente de
tâches basée sur PostgreSQL) sans infrastructure supplémentaire. Lorsque
`redis_host` est vide et `enable_nfs = true`, l'IP de la VM NFS est utilisée comme hôte
Redis.

Lorsque `enable_redis = true`, un déploiement de worker dédié doit être configuré via
`additional_services` pour consommer la file d'attente bull-mq.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret de l'application Twenty (`APP_SECRET` / `ENCRYPTION_KEY`) et le mot de
passe de la base de données sont stockés en tant que secrets Secret Manager et
injectés dans les pods au moment de l'exécution via Workload Identity ; le
texte en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vont vers Cloud Logging ; les métriques GKE et
Cloud SQL vont vers Cloud Monitoring. Des vérifications de disponibilité et des
politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Twenty {#3-twenty-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Trois Jobs
  d'initialisation s'exécutent séquentiellement avant le démarrage de
  l'application :
  1. `db-init` — se connecte à Cloud SQL via le socket Unix du Auth Proxy,
     crée la base de données et l'utilisateur PostgreSQL, accorde les
     privilèges et installe l'extension `uuid-ossp`. Il est idempotent et
     peut être réexécuté en toute sécurité.
  2. `twenty-migrate` — exécute le point d'entrée propre à Twenty (`twenty-entrypoint.sh`)
     avec `DISABLE_DB_MIGRATIONS=false`, exécutant les migrations de schéma TypeORM et
     enregistrant les tâches cron en arrière-plan. `max_retries = 3` car
     l'instance Cloud SQL d'un nouveau locataire peut encore être en cours
     d'établissement lorsque ce job s'exécute en parallèle.
  3. `twenty-verify` — dépend de l'achèvement de `twenty-migrate` et **fait
     échouer l'apply** si le schéma `core` n'a pas de tables. Cela
     existe car un échec de job d'initialisation ne fait PAS échouer l'apply du
     module seul — sans cette garde, un `twenty-migrate` concurrencé ou échoué
     pourrait laisser silencieusement l'application fonctionner contre une base
     de données VIDE (chaque requête backend meurt alors avec `relation "core.keyValuePair" does not
     exist"`,
     et l'interface utilisateur affiche "Impossible d'atteindre le back-end").
     C'est aussi l'un des deux modules (avec `CalDiy_GKE`) qui a mis en
     évidence un correctif d'ordre `depends_on_jobs` à 3 niveaux dans
     `App_GKE` — un job dépendant d'un autre job dépendant (pas seulement
     un job de niveau de base comme `db-init`) pouvait auparavant
     s'exécuter en parallèle et se terminer avant son prérequis.
  Inspectez-les après le déploiement :
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/twenty-migrate
  kubectl logs -n "$NAMESPACE" job/twenty-verify
  ```
- **Migrations désactivées au démarrage normal.** Le conteneur principal
  s'exécute avec `DISABLE_DB_MIGRATIONS=true` de sorte que les migrations ne s'exécutent que
  via le job `twenty-migrate`. Cela réduit le temps de démarrage à froid de
  plusieurs minutes à quelques secondes lors des démarrages ultérieurs.
- **Tâches en arrière-plan.** Lorsque Redis est désactivé (mode pg-boss), les
  tâches en arrière-plan — envoi d'e-mails, livraison de webhooks,
  synchronisation de données — sont traitées par le service principal de
  Twenty. Lorsque Redis est activé (mode bull-mq), un déploiement de worker
  séparé doit être déployé via `additional_services` pointant vers la même image avec
  la commande du worker.
  Vérifiez le traitement des tâches :
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<worker-service-name>
  ```
- **Chemin de santé.** La sonde de démarrage interroge `/healthz` avec un
  délai initial de 120 secondes et jusqu'à 40 échecs (10 minutes au total) pour
  s'adapter aux migrations du premier démarrage. La sonde de vivacité interroge
  `/healthz` avec un délai initial de 30 secondes.
- **`SERVER_URL` est requis.** Sans cela, Twenty génère des liens d'API
  cassés, des erreurs CORS se produisent sur tous les appels d'API et les
  invitations par e-mail échouent. Définissez-le via `environment_variables` :
  ```bash
  environment_variables = {
    SERVER_URL     = "https://crm.example.com"
    FRONT_BASE_URL = "https://crm.example.com"
  }
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Twenty sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `twenty` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Twenty CRM` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Twenty. **Épinglez à une version spécifique pour la production** (par exemple, `0.50.0`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` (Cloud Build) ou `prebuilt` (URI d'image existante). |
| `container_image` | `""` | Remplacer l'URI de l'image. Laisser vide pour que Cloud Build gère. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Limites CPU/mémoire des pods et requêtes optionnelles. Augmenter à `2Gi` pour la production. |
| `min_instance_count` | `1` | Nombre minimum de réplicas. Garder ≥ 1 pour éviter le démarrage à froid sur les charges de travail webhook/job. |
| `max_instance_count` | `3` | Nombre maximum de réplicas (plafond de l'autoscaler). |
| `container_port` | `3000` | Twenty écoute sur le port 3000. Ne pas modifier sauf si vous utilisez une image personnalisée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Twenty dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en texte clair. **Définissez `SERVER_URL` et `FRONT_BASE_URL` ici.** |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utilisez pour `STORAGE_S3_ACCESS_KEY_ID` et `STORAGE_S3_SECRET_ACCESS_KEY` lorsque le stockage GCS est activé. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le Service est exposé. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | `None` (round-robin) ou `ClientIP` (sticky). Twenty utilise JWT (sans état) — les sessions persistantes ne sont pas requises. |
| `gke_cluster_name` | `""` | Cluster cible. Auto-découvert si vide. |
| `prereq_gke_subnet_cidr` | `10.201.0.0/24` | CIDR pour le sous-réseau GKE intégré. Doit être unique par déploiement partageant le même VPC. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Auto-généré si vide. |
| `network_tags` | `[]` | Tags de nœud/pod pour le ciblage des règles de pare-feu. |
| `additional_services` | `[]` | Déploiements Kubernetes supplémentaires. Requis pour un worker bull-mq dédié lorsque `enable_redis = true`. |

### Groupe 7 — Interruption de pod et topologie {#group-7--pod-disruption--topology}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité pendant les mises à niveau de nœuds. Activer lorsque `max_instance_count > 1`. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur les zones. Recommandé pour la production. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 11 — Cloud Storage et Artifact Registry {#group-11--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisionner un bucket GCS pour le stockage de fichiers persistant à l'aide de l'API compatible S3. |
| `create_cloud_storage` | `true` | Provisionner des entrées `storage_buckets` supplémentaires. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de stockage auto-provisionné. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume NFS (Filestore). Non requis pour Twenty ; activer uniquement si l'IP NFS est utilisée comme hôte Redis. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `db-init`, `twenty-migrate` et `twenty-verify`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents supplémentaires. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, 120s de délai, 40 échecs | Sonde `/healthz` ; permet jusqu'à ~10 minutes pour les migrations de premier démarrage. |
| `health_check_config` | HTTP `/healthz`, 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/healthz` | Vérification de disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 15 — Backend de base de données {#group-15--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Options : `POSTGRES_15`, `POSTGRES_14`, `POSTGRES_13`. |
| `application_database_name` | `twenty` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `twenty` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Installer des extensions PostgreSQL supplémentaires pendant `db-init`. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par exemple, `['pgvector', 'pg_trgm']`). |

### Groupe 16 — Charge de travail avec état (PVC) {#group-16--stateful-workload-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Crée un PVC et sélectionne automatiquement StatefulSet. Définir `workload_type = "Deployment"` en même temps échoue au moment de la planification. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. Doit correspondre à `SERVER_URL`. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Twenty. Utile pour l'accès CRM interne. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Activer Redis. Requis pour Twenty v0.4+ ; la désactivation force pg-boss. |
| `redis_host` | `""` | Point de terminaison Redis. Si vide, l'IP de la VM NFS est utilisée (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id` explicite). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Twenty. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnels). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `SERVER_URL` / `FRONT_BASE_URL` (dans `environment_variables`) | URL publique du déploiement | Critique | Les liens d'API sont rompus, les erreurs CORS bloquent toutes les requêtes, les invitations par e-mail échouent. Définir avant la première utilisation. |
| `database_type` | `POSTGRES_15` | Critique | Twenty nécessite PostgreSQL ; MySQL ou `NONE` rompt les migrations de schéma et le démarrage. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_cloudsql_volume` | `true` | Critique | Twenty se connecte via le socket Unix du Auth Proxy ; la désactivation supprime le socket et rompt toutes les connexions à la base de données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation ; la réactivation sur un déploiement en direct écrase les données. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `APP_SECRET` / `ENCRYPTION_KEY` (auto-généré) | ne pas faire pivoter manuellement | Critique | La rotation du secret invalide toutes les sessions JWT actives, déconnectant immédiatement tous les utilisateurs. |
| `enable_redis` | `true` (requis dans v0.4+) | Élevé | Sans Redis, Twenty v0.4+ ne démarre pas ; le stockage de session et de cache est codé en dur pour Redis. |
| `redis_host` | hôte explicite ou `enable_nfs = true` | Élevé | Lorsque `enable_redis = true` et `redis_host` est vide sans VM NFS, l'URL Redis est vide et Twenty ne parvient pas à se connecter. |
| `additional_services` (worker) | configuré lors de l'utilisation de Redis | Élevé | Lorsque `enable_redis = true`, bull-mq est actif mais aucun worker ne traite la file d'attente ; les jobs en arrière-plan (e-mail, webhooks) ne s'exécutent jamais. |
| `enable_gcs_storage` | `true` pour la production | Élevé | Sans stockage GCS, les pièces jointes sont stockées dans le stockage local éphémère du pod et perdues au redémarrage. |
| `STORAGE_S3_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | via `secret_environment_variables` | Élevé | Lorsque le stockage GCS est activé, les clés HMAC ne sont pas auto-générées ; toutes les opérations de fichiers échouent sans elles. |
| `container_resources.memory_limit` | `2Gi` pour la production | Élevé | En dessous de 1 Gio, le processus Node.js est tué par manque de mémoire sous charge. |
| `application_version` | version épinglée (par exemple, `0.50.0`) | Élevé | `latest` se résout en une image différente à chaque exécution de Cloud Build, rendant les retours arrière imprévisibles. |
| `prereq_gke_subnet_cidr` | unique par déploiement | Élevé | Les CIDR qui se chevauchent avec un sous-réseau existant échouent au provisionnement du pool de nœuds GKE. |
| `min_instance_count` | `1` | Moyen | `0` permet une mise à l'échelle à zéro ; les démarrages à froid de Twenty prennent 30 à 60 secondes et peuvent manquer les webhooks entrants. |
| `enable_iap` / `enable_cloud_armor` | activer pour les déploiements non publics | Moyen | L'interface CRM est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `organization_id` | défini explicitement pour VPC-SC | Moyen | Le périmètre VPC-SC n'est pas activé sans cela — `enable_vpc_sc = true` n'a aucun effet. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Twenty
partagée avec la variante Cloud Run est décrite dans
**[Twenty_Common](Twenty_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Twenty sur GKE Autopilot](../labs/Twenty_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Twenty Common — Configuration d'application partagée](Twenty_Common.md) — la configuration partagée par les deux cibles de déploiement.
