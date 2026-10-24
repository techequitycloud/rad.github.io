---
title: "Grafana sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Grafana sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Grafana_CloudRun.md @ e69407af sha256:650e0d6e7816 -->

# Grafana sur Google Cloud Run {#grafana-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grafana_CloudRun.png" alt="Grafana sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana est la première plateforme open source d'observabilité et d'analyse au
monde, utilisée par plus de 10 millions d'utilisateurs dans des organisations
telles que la NASA, le CERN et Goldman Sachs. Elle fournit des tableaux de bord
unifiés, des alertes et des visualisations pour les métriques, les logs et les
traces provenant de plus de 100 sources de données. Ce module déploie Grafana
sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud que Grafana utilise et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Grafana sur RAD, et comment cela se compare {#what-grafana-costs-on-rad-and-how-that-compares}

**L'exécution de Grafana sur Cloud Run dans votre propre projet Google Cloud
coûte environ 70,19 $/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 75 crédits facturé une seule fois au moment du déploiement.
Grafana est inhabituel dans cette liste car il dispose de son propre SaaS
hébergé officiel, géré par Grafana Labs elle-même, ce qui permet une
comparaison directe plutôt qu'une comparaison générique. Dans un projet géré
par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût
d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement
par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut
pas égaler — ou voir le [guide GKE](Grafana_GKE.md) si vous préférez l'exécuter
sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 70,19 $/mois, facturé par Google au prix catalogue | ~26 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **70,19 $** |

### Comment cela se compare {#how-it-compares}

- **Le niveau gratuit de Grafana Cloud est de 0 $/mois** (limité en
  utilisation, rétention de 14 jours), et son niveau payant le plus bas, **Pro,
  commence à 19 $/mois en tant que frais de plateforme** plus des frais basés
  sur l'utilisation (par exemple, les métriques facturées à partir de 6,50 $
  pour 1 000 séries au-delà de l'allocation incluse) — vérifié sur la page de
  tarification de Grafana, le 8 octobre 2026.
- Le coût d'exécution du projet propre à RAD ici est celui des tableaux de bord
  plus une base de données Postgres dédiée pour l'état propre de Grafana, que
  les niveaux hébergés de Grafana Cloud intègrent dans leur tarification
  d'utilisation au lieu de facturer comme une instance Cloud SQL distincte.
- Une alternative VPS autogérée, dimensionnée à ce module : Hetzner CPX22 (2
  vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go est
  le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est
  d'environ 49 $/mois — moins cher que le niveau Pro de Grafana Cloud ou la
  pile gérée de RAD en prix affiché, mais sans sauvegardes gérées ni correctifs
  inclus.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression d'un module, cela ne **détruit pas** Cloud SQL, aucune VM, ni
la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé Grafana et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources pour de bon, et le retour de Grafana signifie un redéploiement à
partir de zéro. Cela coûte environ 78-81 crédits (les frais de module de 75
crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Grafana reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son
propre coût d'exécution — pour Grafana, c'est environ 4 jours ou plus. La
plupart de ce coût d'exécution est généralement la base de données (et, lorsque
ce module en utilise un, la VM de serveur de fichiers partagé ou le cluster
GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les
utilise, donc la suppression de cette application pendant que quelque chose
d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de laboratoire, pour la formation : un formateur anime une session pour
une classe. Chaque participant dispose de l'application dans son propre projet
Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
définie par le formateur. Soit le formateur finance toutes les places, soit
chaque participant paie la sienne. Tout est supprimé à la fin de la session et
les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, afin que personne ne
reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les
déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ;
[https://grafana.com/pricing/](https://grafana.com/pricing/) pour les chiffres
de Grafana Cloud cités ci-dessus, vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Grafana s'exécute en tant que conteneur Go sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Grafana nécessite une base de données relationnelle ; SQLite est dangereux pour les déploiements multi-instances |
| Stockage d'objets | Cloud Storage | Un bucket `grafana-data` provisionné automatiquement |
| Stockage partagé optionnel | Filestore (NFS) | Désactivé par défaut ; activer pour partager des tableaux de bord ou des plugins entre les instances |
| Cache optionnel | Redis | Désactivé par défaut ; peut être activé pour le stockage de session |
| Secrets | Secret Manager | Mot de passe de la base de données géré par la fondation ; identifiants d'administrateur injectés via une variable d'environnement |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est requis.** Grafana persiste les tableaux de bord, les
  utilisateurs, les alertes et l'état des plugins dans une base de données
  relationnelle. SQLite utilise un verrouillage de fichiers qui se brise sous
  des écritures multi-instances concurrentes ; le module force PostgreSQL.
- **`GF_DATABASE_TYPE=postgres` est injecté automatiquement.** Sans cela, Grafana
  revient à SQLite même lorsque toutes les autres variables `GF_DATABASE_*` sont
  présentes.
- **Aucun job d'initialisation de base de données n'est nécessaire.** Grafana
  migre automatiquement son schéma au premier démarrage lorsqu'il se connecte à
  l'instance PostgreSQL provisionnée.
- **Le mot de passe administrateur n'est PAS généré automatiquement.** Grafana
  est livré avec les valeurs par défaut `admin`/`admin`. Vous devez
  injecter un mot de passe fort via `secret_environment_variables` avant le premier
  déploiement.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Activez-le
  uniquement lorsque plusieurs instances doivent partager des plugins ou des
  modèles de tableau de bord personnalisés sur un système de fichiers partagé ;
  nécessite `execution_environment = "gen2"`.
- **Redis est désactivé par défaut** (`enable_redis = false`). Non requis
  pour la fonction principale de Grafana.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Grafana {#a-cloud-run--the-grafana-service}

Grafana s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Grafana stocke toutes les données de l'application (tableaux de bord,
utilisateurs, organisations, règles d'alerte, état des plugins) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte
privatement via le **Cloud SQL Auth Proxy** sur un socket Unix. Grafana migre
automatiquement son schéma au démarrage — aucun job d'initialisation séparé
n'est requis.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket `grafana-data` **Cloud Storage** dédié est provisionné
automatiquement par Grafana_Common. Des buckets GCS supplémentaires peuvent être
déclarés via `storage_buckets`, et des volumes GCS Fuse peuvent être
montés dans le service via `gcs_volumes` (nécessite un environnement
d'exécution Gen2).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<grafana-data-bucket>/    # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse, CMEK et les politiques
de cycle de vie.

### D. Filestore (NFS) — optionnel {#d-filestore-nfs--optional}

Lorsque `enable_nfs = true`, un partage NFS **Filestore** est provisionné et
monté dans le service. Ceci est utile lorsque plusieurs instances doivent
partager des plugins Grafana ou des modèles de tableau de bord personnalisés.
NFS est désactivé par défaut car l'état persistant de Grafana réside dans
PostgreSQL. Nécessite un environnement d'exécution Gen2.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté
dans le service au moment de l'exécution. Le mot de passe administrateur de
Grafana n'est pas généré automatiquement — injectez-le via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Create the admin password secret:
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être superposé. `ingress_settings` et `vpc_egress_setting`
contrôlent les sources de trafic qui atteignent le service et la manière dont le
trafic sortant est acheminé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring. Grafana expose
`/api/health` comme point de terminaison de santé, ciblé par les
sondes de démarrage et de vivacité, et par un contrôle de disponibilité
optionnel.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Grafana {#3-grafana-application-behaviour}

- **Migration de schéma au démarrage.** Grafana se connecte à PostgreSQL et
  applique toutes les migrations de schéma en attente au premier démarrage.
  Aucun job Cloud Run séparé n'est requis. La sonde de démarrage permet une
  tolérance totale d'environ 150 secondes (`initial_delay_seconds=30`, `failure_threshold=12`,
  `period_seconds=10`).
- **Identifiant administrateur.** Grafana est livré avec des identifiants par
  défaut `admin`/`admin`. Vous devez injecter un mot de passe
  fort avant le premier déploiement :
  ```bash
  gcloud secrets create grafana-admin-password \
    --replication-policy="automatic" --project "$PROJECT"
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  # Then set: secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }
  ```
- **`GF_DATABASE_TYPE` est injecté automatiquement.** Le module force
  `GF_DATABASE_TYPE=postgres` dans l'environnement. Ne pas le remplacer dans
  `environment_variables`.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité
  ciblent `/api/health`, qui renvoie HTTP 200 lorsque Grafana et sa
  connexion à la base de données sont sains. Un contrôle de disponibilité
  contre ce chemin est activé par défaut.
- **Aucun job planifié requis.** Grafana n'a pas de CronJobs obligatoires. Des
  jobs optionnels déclenchés par Cloud Scheduler (par exemple, exportation de
  snapshots, nettoyage) peuvent être ajoutés via `cron_jobs`.
- **Accès aux données GCS Fuse.** Le bucket `grafana-data` est
  provisionné automatiquement ; il peut être monté comme volume GCS Fuse pour
  un accès direct au système de fichiers via `gcs_volumes`. Inspecter
  les jobs planifiés :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Grafana sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grafana` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Grafana Dashboards` | Nom convivial affiché dans la console. |
| `description` | `Grafana - Open-source observability and analytics platform` | Description du service. |
| `application_version` | `11.4.0` | Tag de version de l'image Grafana. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; Grafana charge les tableaux de bord en mémoire. |
| `min_instance_count` | `0` | Instances minimales. Mise à l'échelle à zéro par défaut — le cœur de Grafana est requête/réponse, donc il ne coûte rien lorsqu'il est inactif au prix d'un démarrage à froid. Définir à `1` (avec `cpu_always_allocated = true`) si vous activez l'alerte unifiée en cours de processus, qui doit évaluer les règles sans requête entrante. |
| `max_instance_count` | `5` | Instances maximales. |
| `container_port` | `3000` | Grafana écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Grafana dans Artifact Registry avant le déploiement. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut. Définir `true` uniquement si l'évaluation des règles d'alerte en cours de processus est activée, afin qu'elle puisse s'exécuter selon un calendrier sans requête entrante. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Fortement recommandé pour les déploiements internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GF_*` supplémentaires non secrets. `GF_DATABASE_TYPE=postgres` est injecté automatiquement — ne pas le remplacer. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. Utiliser pour injecter `GF_SECURITY_ADMIN_PASSWORD`. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets supplémentaires (le bucket `grafana-data` est toujours créé). |
| `enable_nfs` | `false` | Volume Filestore partagé — activer lorsque les instances doivent partager des plugins ou des modèles. Nécessite Gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite Gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier ; PostgreSQL est requis. |
| `db_name` | `grafana` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `grafana` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont exposés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide — Grafana migre automatiquement son schéma au démarrage. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents optionnels déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/api/health`, HTTP, 30s de délai, 12 échecs | Sonde de démarrage HTTP vers le point de terminaison de santé de Grafana. |
| `liveness_probe` | `/api/health`, HTTP, 60s de délai, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/health` | Contrôle de disponibilité Cloud Monitoring. Activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage de session. Désactivé par défaut — non requis pour la fonction principale. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS lorsque NFS est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `grafana-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, contrôles de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `GF_SECURITY_ADMIN_PASSWORD` (via `secret_environment_variables`) | secret fort | Critique | Grafana est livré avec les valeurs par défaut `admin`/`admin`. Le déploiement sans définir un mot de passe fort expose l'interface d'administration. |
| `GF_AUTH_ANONYMOUS_ENABLED` (via `environment_variables`) | `false` (par défaut) | Critique | Le fait de le définir sur `"true"` expose tous les tableaux de bord aux utilisateurs non authentifiés. |
| `database_type` | `POSTGRES_15` | Critique | PostgreSQL est requis ; le remplacement par SQLite entraîne une perte de données à chaque nouvelle révision — le fichier SQLite réside sur un disque éphémère. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `GF_SERVER_ROOT_URL` (via `environment_variables`) | URL publique | Élevé | Sans cela, les redirections OAuth, les liens de notification par e-mail et les iframes pointent vers la mauvaise origine et se cassent. |
| `enable_iap` | `true` pour interne | Élevé | Sans IAP, la page de connexion Grafana est accessible publiquement sur Internet. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mo, Grafana OOM au démarrage avec de grands ensembles de tableaux de bord. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro ajoute une latence de démarrage à froid et risque des évaluations d'alertes manquées pendant la fenêtre de démarrage. |
| `max_instance_count` | `1`–`3` | Moyen | Plusieurs instances partagent PostgreSQL mais pas l'état d'alerte en mémoire — les alertes peuvent déclencher des doublons. |
| `enable_redis` | `false` (par défaut) | Faible | L'activation sans un `redis_host` valide déclenche une erreur de validation au moment de la planification. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `ingress_settings` | `internal-and-cloud-load-balancing` pour privé | Élevé | Le `all` par défaut autorise le trafic de n'importe quelle source ; restreindre pour les déploiements internes uniquement. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Grafana partagée avec la variante GKE est décrite
dans **[Grafana_Common](Grafana_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Grafana sur Cloud Run](../labs/Grafana_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Grafana sur GKE Autopilot](Grafana_GKE.md) — la même application sur
  Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grafana Common — Configuration d'application partagée](Grafana_Common.md) —
  la configuration partagée par les deux cibles de déploiement.
- Déployé avec [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md),
  [Loki sur Google Cloud Run](Loki_CloudRun.md),
  [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md),
  [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution
  **Observabilité et astreinte**.
