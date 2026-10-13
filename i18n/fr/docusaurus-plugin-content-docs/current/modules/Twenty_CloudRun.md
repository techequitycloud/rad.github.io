---
title: "Twenty CRM sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Twenty CRM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Twenty_CloudRun.md @ e69407af sha256:99dc9ba86a57 -->

# Twenty CRM sur Google Cloud Run {#twenty-crm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Twenty_CloudRun.png" alt="Twenty CRM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Twenty est un CRM open source avec plus de 25 000 étoiles sur GitHub, conçu comme
une alternative moderne et conviviale pour les développeurs à Salesforce et HubSpot.
Ce module déploie Twenty sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Twenty et sur la façon de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, contrôles de service VPC, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Twenty sur RAD, et comment cela se compare {#what-twenty-costs-on-rad-and-how-that-compares}

**L'exécution de Twenty sur Cloud Run dans votre propre projet Google Cloud coûte environ
83,61 US$/mois en frais Google Cloud**, en plus d'un coût de module RAD unique de 110 crédits
(11 US$) facturé une seule fois au moment du déploiement. Twenty est un CRM open source
moderne positionné comme une alternative à Salesforce et HubSpot, la comparaison honnête
se fait donc avec les prix SaaS par utilisateur plutôt qu'avec un simple serveur. Dans un
projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) et le coût
d'exécution est mesuré à l'heure en crédits — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous — ou voir le [guide GKE](Twenty_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 83,61 US$/mois, facturé par Google au prix catalogue | ~32 crédits/jour (environ 960/mois, 96 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **83,61 US$** |

### Comment cela se compare {#how-it-compares}

- Le cloud hébergé de Twenty facture **par utilisateur, par mois** : Pro est à 9 $/utilisateur/mois et Organization à 19 $/utilisateur/mois, tous deux facturés annuellement, avec Enterprise à partir de 50 000 $/an pour une isolation à locataire unique — vérifié sur la page de tarification de Twenty, le 8 octobre 2026. Une équipe de vente de cinq personnes sur le plan Pro coûte 45 $/mois et continue de croître avec les effectifs ; le coût d'exécution du projet propre à RAD est un forfait d'environ 84 US$/mois, que l'équipe compte 5 ou 50 utilisateurs.
- Salesforce et HubSpot, les acteurs en place que Twenty est conçu pour remplacer, commencent leurs niveaux CRM payants bien au-dessus de 25-50 $/utilisateur/mois, ce qui est l'écart que Twenty (et RAD qui l'exécute) vise à combler.
- Une comparaison avec un VPS autogéré, dimensionné aux valeurs par défaut de Twenty (1 vCPU / 2 Gio) : un Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go coûte environ 24 $/mois — moins cher en termes monétaires, plus votre propre temps pour les sauvegardes et les correctifs de Postgres, ce que couvrent Cloud SQL géré et Secret Manager de RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
supprimer purement et simplement le projet — une suppression logique récupérable de 30 jours
par Google. Contrairement à la suppression d'un seul module, cela ne détruit **pas** Cloud SQL,
aucune VM, ni la ressource de calcul une par une : l'ensemble du projet s'arrête simplement,
et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google
de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les
frais de module. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une
chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement
la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le
supprime définitivement — et la restauration est admise comme la création d'un nouveau projet,
donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits
pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures
suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est
donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même
est récupérable pendant 30 jours. Si vous avez personnalisé Twenty et que vous souhaitez conserver
ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD,
il n'y a pas de pause gratuite — la suppression supprime définitivement les ressources, et
ramener Twenty signifie redéployer à partir de zéro. Cela coûte environ 113-116 crédits dans
votre propre projet, ou environ 102-105 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Twenty reste inutilisé assez longtemps
pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ
4 jours ou plus dans votre propre projet (environ 2,79 US$ par jour), ou environ 3 jours ou
plus dans un projet géré par RAD (32 crédits par jour).

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du
déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de
supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque
participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à
24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur
finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la
fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application
pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement
avec le client. Si le portefeuille est faible, la facturation est suspendue et les données
sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
[radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et
les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ; [tarification de Twenty](https://twenty.com/pricing).

## 1. Vue d'ensemble {#1-overview}

Twenty s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 Gio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Twenty ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Optionnel ; un bucket dédié lorsque `enable_gcs_storage = true` |
| Jobs en arrière-plan | Redis (optionnel) | bull-mq lorsqu'il est activé ; pg-boss (basé sur PostgreSQL) par défaut sans infrastructure supplémentaire |
| Secrets | Secret Manager | Secret d'application auto-généré (`APP_SECRET` / `ENCRYPTION_KEY`) et mot de passe de base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app`, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** La sélection de MySQL ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Twenty v0.4+ code en dur Redis pour le stockage de session et de cache — sans une connexion Redis valide, Twenty ne démarre pas. Lorsque `redis_host` est laissé vide, l'IP de la VM NFS de la plateforme est utilisée (nécessite `enable_nfs = true` ou un `redis_host` explicite).
- **pg-boss est la file d'attente de jobs lorsque Redis est désactivé.** Il ne nécessite aucune infrastructure supplémentaire et utilise directement la base de données PostgreSQL.
- **Les pièces jointes de fichiers sont par défaut stockées localement de manière éphémère.** Activez `enable_gcs_storage` pour un stockage d'objets persistant utilisant GCS.
- **Trois jobs d'initialisation s'exécutent avant le démarrage du serveur.** `db-init` crée la base de données et l'utilisateur ; `twenty-migrate` exécute les migrations de schéma TypeORM ; `twenty-verify` est un job de garde qui fait échouer l'apply si le schéma `core` n'a pas de tables, détectant bruyamment une migration concurrencée/échouée au lieu de livrer un service sain avec une base de données vide. Les migrations de base de données sont désactivées dans le conteneur principal (`DISABLE_DB_MIGRATIONS=true`) pour maintenir des démarrages à froid rapides après le premier démarrage.
- **`SERVER_URL` et `FRONT_BASE_URL` doivent être définis manuellement.** Sans eux, les liens API, CORS et les invitations par e-mail sont rompus.
- Le **APP_SECRET / ENCRYPTION_KEY** est généré automatiquement et stocké dans Secret Manager ; vous ne le définissez jamais en texte clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Twenty {#a-cloud-run--the-twenty-service}

Twenty s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre les
nombres d'instances minimum et maximum. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Twenty stocke toutes les données d'application (contacts, pipelines, objets personnalisés) dans une instance
Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy**
sur un socket Unix (pas d'IP publique). Lors du premier déploiement, trois jobs d'initialisation s'exécutent
en séquence : `db-init` crée la base de données et l'utilisateur, `twenty-migrate` exécute les
migrations de schéma en utilisant le point d'entrée propre à Twenty, et `twenty-verify` protège contre
un schéma vide en faisant échouer l'apply si les migrations n'ont pas réellement créé de tables.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (stockage de fichiers optionnel) {#c-cloud-storage-optional-file-storage}

Lorsque `enable_gcs_storage = true`, un bucket **Cloud Storage** dédié est provisionné et Twenty est configuré
pour utiliser l'API compatible GCS S3 (`STORAGE_TYPE=s3`). Sans cela, les pièces jointes sont stockées
dans le système de fichiers éphémère du conteneur et sont perdues lors des déploiements de nouvelles révisions.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Remarque : lorsque `enable_gcs_storage = true`, vous devez fournir des clés HMAC GCS via `secret_environment_variables` (`STORAGE_S3_ACCESS_KEY_ID` et
`STORAGE_S3_SECRET_ACCESS_KEY`). Générez-les dans la console sous Cloud Storage → Paramètres → Interopérabilité.

### D. Redis (jobs en arrière-plan) {#d-redis-background-jobs}

Redis prend en charge le stockage de session et de cache de Twenty dans la v0.4+ et, lorsqu'il est activé,
bascule le traitement en arrière-plan vers **bull-mq**. Sans Redis, Twenty utilise **pg-boss**
(une file d'attente de jobs basée sur PostgreSQL) sans infrastructure supplémentaire. Lorsque `redis_host`
est vide et `enable_nfs = true`, l'IP de la VM NFS est utilisée comme hôte Redis.

Lorsque `enable_redis = true`, un service Cloud Run de travailleur dédié doit être déployé via `additional_services`
pour consommer la file d'attente bull-mq.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret de l'application Twenty (`APP_SECRET` / `ENCRYPTION_KEY`) et le mot de passe de la base de données sont
stockés dans Secret Manager et injectés dans le service au moment de l'exécution ; le texte en clair
n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres
d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneur sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL
sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques
d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Twenty {#3-twenty-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Trois jobs d'initialisation s'exécutent séquentiellement avant le démarrage du service :
  1. `db-init` — se connecte à Cloud SQL via le socket Unix du proxy d'authentification, crée la base de données et l'utilisateur PostgreSQL, accorde les privilèges et installe l'extension `uuid-ossp`. Il est idempotent et peut être réexécuté en toute sécurité.
  2. `twenty-migrate` — exécute le point d'entrée propre à Twenty (`twenty-entrypoint.sh`) avec `DISABLE_DB_MIGRATIONS=false`, exécutant les migrations de schéma TypeORM et enregistrant les jobs cron en arrière-plan. `max_retries = 3` car l'instance Cloud SQL d'un nouveau locataire peut encore être en cours de stabilisation lorsque ce job est exécuté en parallèle.
  3. `twenty-verify` — un job de garde (`depends_on_jobs = ["twenty-migrate"]`) qui vérifie que le schéma `core` a réellement des tables et **fait échouer l'apply** si ce n'est pas le cas. Cela existe parce qu'un échec de job d'initialisation ne fait PAS échouer l'apply du module à lui seul — sans cette garde, une migration `twenty-migrate` concurrencée ou échouée pourrait livrer silencieusement un service d'apparence saine pointant vers une base de données VIDE (chaque requête backend échoue alors avec `relation "core.keyValuePair" does not exist"`, et l'interface utilisateur affiche "Impossible d'atteindre le backend").
  Inspectez-les après le déploiement :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Migrations désactivées au démarrage normal.** Le conteneur principal s'exécute avec `DISABLE_DB_MIGRATIONS=true` afin que les migrations ne s'exécutent que via le job `twenty-migrate`. Cela réduit le temps de démarrage à froid de plusieurs minutes à quelques secondes lors des démarrages ultérieurs.
- **Jobs en arrière-plan.** Lorsque Redis est désactivé (mode pg-boss), les jobs en arrière-plan — envoi d'e-mails, livraison de webhooks, synchronisation de données — sont traités par le service principal. Lorsque Redis est activé (mode bull-mq), un service de travailleur séparé doit être déployé via `additional_services` pointant vers la même image avec la commande du travailleur.
  Inspectez les jobs :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Chemin de santé.** La sonde de démarrage interroge `/healthz` avec un délai initial de 120 secondes et jusqu'à 40 échecs (~10 minutes) pour s'adapter aux migrations du premier démarrage. La sonde de vivacité interroge `/healthz` avec un délai initial de 30 secondes.
- **`SERVER_URL` est requis.** Sans cela, Twenty génère des liens API rompus, des erreurs CORS se produisent sur tous les appels API et les invitations par e-mail échouent. Définissez-le via `environment_variables` :
  ```bash
  environment_variables = {
    SERVER_URL     = "https://crm.example.com"
    FRONT_BASE_URL = "https://crm.example.com"
  }
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Twenty sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `twenty` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Twenty CRM` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Twenty. **Épinglez à une version spécifique pour la production** (par exemple, `0.50.0`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. 2 vCPU recommandés pour la production. |
| `memory_limit` | `2Gi` | Mémoire par instance. Augmentez à `4Gi` pour les grands ensembles de données. |
| `min_instance_count` | `0` | Instances minimales. Gardez ≥ 1 pour éviter le démarrage à froid sur les charges de travail webhook/job. |
| `max_instance_count` | `3` | Instances maximales. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut : ce service exécute uniquement le serveur de Twenty (`node dist/main`) — aucun processus de travailleur n'est déployé et l'enregistrement cron est désactivé, il n'y a donc pas de travail en arrière-plan en cours de traitement à limiter. Définissez `true` uniquement si un travailleur Twenty ou un autre job en arrière-plan est déployé dans ce conteneur. |
| `container_port` | `3000` | Twenty écoute sur le port 3000. Ne pas modifier sauf si vous utilisez une image personnalisée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. |
| `execution_environment` | `gen2` | Gen2 requis pour la mise en réseau VPC. |
| `container_image_source` | `custom` | `custom` (Cloud Build) ou `prebuilt` (URI d'image existant). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Twenty dans Artifact Registry. |
| `traffic_split` | `[]` | Allocation de trafic Canary/bleu-vert entre les révisions. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Utile pour l'accès CRM interne. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en texte clair. **Définissez `SERVER_URL` et `FRONT_BASE_URL` ici.** |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utilisez pour `STORAGE_S3_ACCESS_KEY_ID` et `STORAGE_S3_SECRET_ACCESS_KEY` lorsque le stockage GCS est activé. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. Doit correspondre à `SERVER_URL`. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisionner un bucket GCS pour le stockage de fichiers persistant à l'aide de l'API compatible S3. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `enable_nfs` | `false` | Volume NFS (Filestore). Non requis pour Twenty ; activer uniquement lors de l'utilisation de l'IP NFS comme hôte Redis. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Options : `POSTGRES_15`, `POSTGRES_14`, `POSTGRES_13`. |
| `db_name` | `twenty` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `twenty` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires facultatifs sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init`, `twenty-migrate` et `twenty-verify`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents supplémentaires déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires. Requis pour un travailleur bull-mq dédié lorsque `enable_redis = true`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/healthz`, délai de 120s, 40 échecs | Sonde `/healthz` ; permet jusqu'à ~10 minutes pour les migrations du premier démarrage. |
| `liveness_probe` / `health_check_config` | HTTP `/healthz`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/healthz` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Activer Redis. Requis pour Twenty v0.4+ ; la désactivation force pg-boss. |
| `redis_host` | `""` | Point de terminaison Redis. Lorsqu'il est vide, l'IP de la VM NFS est utilisée (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id` explicite). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `SERVER_URL` / `FRONT_BASE_URL` (dans `environment_variables`) | URL publique du déploiement | Critique | Les liens API sont rompus, les erreurs CORS bloquent toutes les requêtes, les invitations par e-mail échouent. Définir avant la première utilisation. |
| `database_type` | `POSTGRES_15` | Critique | Twenty nécessite PostgreSQL ; MySQL ou `NONE` interrompt les migrations de schéma et le démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_cloudsql_volume` | `true` | Critique | Twenty se connecte via le socket Unix du proxy d'authentification ; la désactivation supprime le socket et interrompt toutes les connexions à la base de données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation ; la réactivation sur un déploiement en direct écrase les données. |
| `APP_SECRET` / `ENCRYPTION_KEY` (auto-généré) | ne pas faire pivoter manuellement | Critique | La rotation du secret invalide toutes les sessions JWT actives, déconnectant immédiatement chaque utilisateur. |
| `enable_redis` | `true` (requis dans v0.4+) | Élevé | Sans Redis, Twenty v0.4+ ne démarre pas ; le stockage de session et de cache est codé en dur pour Redis. |
| `redis_host` | hôte explicite ou `enable_nfs = true` | Élevé | Lorsque `enable_redis = true` et `redis_host` est vide sans VM NFS, l'URL Redis est vide et Twenty ne parvient pas à se connecter. |
| `additional_services` (travailleur) | configuré lors de l'utilisation de Redis | Élevé | Lorsque `enable_redis = true`, bull-mq est actif mais aucun travailleur ne traite la file d'attente ; les jobs en arrière-plan (e-mail, webhooks) ne s'exécutent jamais. |
| `enable_gcs_storage` | `true` pour la production | Élevé | Sans stockage GCS, les pièces jointes sont stockées dans le stockage éphémère du conteneur et perdues lors du déploiement d'une nouvelle révision. |
| `STORAGE_S3_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | via `secret_environment_variables` | Élevé | Lorsque le stockage GCS est activé, les clés HMAC ne sont pas auto-générées ; toutes les opérations de fichiers échouent sans elles. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 1 Gio, le processus Node.js est tué par manque de mémoire sous charge. |
| `application_version` | version épinglée (par exemple, `0.50.0`) | Élevé | `latest` résout une image différente à chaque exécution de Cloud Build, rendant les retours arrière imprévisibles. |
| `container_port` | `3000` | Élevé | Le serveur de Twenty écoute sur le port 3000 ; toute autre valeur entraîne l'échec permanent des vérifications de santé. |
| `startup_probe` | HTTP `/healthz`, délai généreux | Élevé | Une fenêtre trop courte entraîne l'arrêt du service pendant les migrations du premier démarrage (qui prennent 8 à 10 minutes sur un schéma vierge). |
| `min_instance_count` | `1` | Moyen | `0` ajoute une latence de démarrage à froid et risque de manquer les webhooks entrants pendant que l'instance se met à l'échelle. |
| `cpu_always_allocated` | `false` sauf si un travailleur est déployé | Moyen | Définir `true` sans travailleur/cron en cours d'exécution dans ce conteneur paie pour le CPU inactif sans rien à limiter ; nécessaire uniquement si un travail en arrière-plan est ajouté à ce service. |
| `enable_iap` / `enable_cloud_armor` | activer pour les déploiements non publics | Moyen | L'interface CRM est autrement accessible publiquement. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Moyen | Lorsque Memorystore Redis est utilisé, son IP privée peut nécessiter `ALL_TRAFFIC` pour le routage. |
| `organization_id` | défini explicitement pour VPC-SC | Moyen | Le périmètre VPC-SC n'est pas activé sans cela — `enable_vpc_sc = true` n'a aucun effet. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, autorisation binaire,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Twenty partagée avec la variante GKE est décrite dans
**[Twenty_Common](Twenty_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Twenty sur Cloud Run](../labs/Twenty_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Twenty CRM sur GKE Autopilot](Twenty_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Twenty Common — Configuration d'application partagée](Twenty_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **CRM & Opérations de vente**.
