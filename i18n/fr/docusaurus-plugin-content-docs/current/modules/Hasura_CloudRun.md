---
title: "Hasura sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Hasura sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Hasura_CloudRun.md @ e69407af sha256:5565524ea889 -->

# Hasura sur Google Cloud Run {#hasura-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hasura_CloudRun.png" alt="Hasura sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hasura est un moteur open source, sous licence Apache 2.0, qui fournit une API
GraphQL (et REST) instantanée et en temps réel sur une base de données PostgreSQL,
avec une autorisation granulaire basée sur les rôles, des déclencheurs d'événements
et une console d'administration intégrée. Ce module déploie le moteur GraphQL
Hasura (`hasura/graphql-engine`) sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Hasura et sur la manière
de les explorer et de les opérer depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à chaque application Cloud Run — identité de
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Hasura sur RAD, et comment cela se compare {#what-hasura-costs-on-rad-and-how-that-compares}

**L'exécution de Hasura sur Cloud Run dans votre propre projet Google Cloud coûte environ 67,80 $/mois en frais Google Cloud**, en plus de frais de module RAD uniques de 75 crédits facturés une fois au moment du déploiement. Le produit cloud commercial de Hasura s'est éloigné de l'hébergement du moteur GraphQL open source classique que ce module déploie — sa page de tarification actuelle (vérifiée le 8 octobre 2026) ne répertorie que le nouveau produit supergraphique "DDN", sans plan séparé pour le moteur Community Edition, il n'est donc pas juste de citer une comparaison ici. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut pas égaler — ou voir le [guide GKE](Hasura_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 67,80 $/mois, facturé par Google au prix catalogue | ~26 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **67,80 $** |

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée à la place : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — suffisant pour exécuter le moteur Hasura et sa base de données Postgres ensemble sur une seule machine.
- Le moteur 1 vCPU/0,5 GiB lui-même est léger ; la majeure partie du coût d'exécution ci-dessus est l'instance Postgres dédiée dont l'introspection GraphQL a besoin pour rester rapide, ce qu'une machine auto-gérée aurait également besoin.
- Comme ailleurs, les chiffres VPS ci-dessus sont moins chers en termes de trésorerie mais n'incluent pas les sauvegardes gérées, les correctifs ou la rotation des secrets — Cloud SQL, Secret Manager et la surveillance de RAD couvrent cela pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart
des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Hasura et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime définitivement les ressources, et ramener Hasura signifie redéployer à partir de
zéro. Cela coûte environ 78-81 crédits (les frais de module de 75 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Hasura restait inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Hasura, cela représente environ 4 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise un, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
donc copiez la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Hasura s'exécute comme un conteneur Haskell unique sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Haskell, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le catalogue de métadonnées de Hasura et la source de données par défaut résident tous deux dans Postgres |
| Stockage d'objets | Aucun | Hasura est sans état ; aucun bucket n'est provisionné |
| Secrets | Secret Manager | `HASURA_GRAPHQL_ADMIN_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; Hasura conserve son propre catalogue de métadonnées
  dans Postgres, donc aucun autre moteur n'est pris en charge.
- **Le secret d'administration protège tout ce qui est sensible.** `HASURA_GRAPHQL_ADMIN_SECRET` est
  généré automatiquement et stocké dans Secret Manager. Il protège l'interface
  utilisateur `/console` et les API `/v1/graphql` et `/v1/metadata`. `/healthz` reste public pour
  les sondes de santé.
- **Deux URL de connexion sont assemblées dans le conteneur.** Le point d'entrée de
  l'image personnalisée construit `HASURA_GRAPHQL_DATABASE_URL` (source de données par défaut) et
  `HASURA_GRAPHQL_METADATA_DATABASE_URL` (magasin de métadonnées de Hasura) à partir des variables
  `DB_*` injectées au moment de l'exécution — Cloud Run n'interpole pas
  `$(VAR)` dans les valeurs d'environnement, donc cela ne peut pas être fait au
  moment de la planification.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Parce que tout l'état est externe dans Postgres, une instance
  démarrée à froid sert correctement ; les démarrages à froid ajoutent quelques
  secondes de latence à la première requête après l'inactivité. Définissez
  `min_instance_count = 1` pour les API sensibles à la latence.
- **Ingress public par défaut.** `ingress_settings = "all"` afin que les clients et la
  console puissent atteindre le service. L'activation d'IAP protège l'ensemble du
  service — y compris l'API — derrière l'identité Google.
- **La console est activée par défaut.** `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"` sert la
  console d'administration à `/console`. Désactivez-la en production si vous gérez
  les métadonnées uniquement via CI (`hasura` CLI / migrations).
- **Pas de stockage, pas de Redis, pas de NFS.** `storage_buckets = []`, `enable_redis = false`,
  `enable_nfs = false` — tout réside dans PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Hasura {#a-cloud-run--the-hasura-service}

Hasura s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge des requêtes entre le nombre minimum et maximum d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre
les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Hasura stocke son catalogue de métadonnées (tables suivies, relations, permissions,
déclencheurs d'événements) **et** vos données d'application dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le **Cloud SQL
Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur de
l'application ; Hasura installe son schéma de métadonnées au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la
rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`HASURA_GRAPHQL_ADMIN_SECRET` (accorde un accès complet aux API GraphQL/métadonnées et à la
console). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # The admin secret — use it as the x-hasura-admin-secret header:
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être superposé ; les paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec un contrôle de disponibilité
optionnel (ciblant `/healthz`) et des politiques d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Hasura {#3-hasura-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur de l'application et accorde les privilèges. Le job peut être
  réexécuté en toute sécurité.
- **Catalogue de métadonnées au démarrage.** Hasura installe et migre son propre
  schéma de catalogue de métadonnées dans Postgres au démarrage, de sorte que la
  mise à niveau de la version de l'image applique les modifications du catalogue
  sans étape de migration distincte. Vos métadonnées de table suivies persistent
  dans la base de données entre les révisions.
- **Deux URL de connexion, assemblées dans le conteneur.** Le point d'entrée
  construit à la fois `HASURA_GRAPHQL_DATABASE_URL` et `HASURA_GRAPHQL_METADATA_DATABASE_URL` à partir des variables
  `DB_*` injectées, en encodant l'URL du mot de passe et en se basant sur
  `DB_HOST` (répertoire de socket → forme de socket libpq ; boucle locale →
  simple ; IP privée → `sslmode=require`).
- **Le secret d'administration est la limite de sécurité.** Envoyez-le comme
  en-tête `x-hasura-admin-secret`. Récupérez-le :
  ```bash
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  # Then, e.g.:
  curl -s "$SERVICE_URL/v1/graphql" \
    -H "x-hasura-admin-secret: <secret>" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/healthz`
  — le point de terminaison public non authentifié qui renvoie 200 une fois que le
  moteur est démarré et connecté à Postgres. Ne redirigez pas les sondes vers
  `/v1/graphql` ou `/console` (tous deux 401 sans le secret d'administration).
- **Accès à la console.** Ouvrez `$SERVICE_URL/console` dans un navigateur et collez le
  secret d'administration lorsque vous y êtes invité pour suivre les tables, définir
  les autorisations et exécuter des requêtes GraphQL.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Hasura sont
listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hasura` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Hasura` | Nom lisible par l'homme affiché dans la Console. |
| `application_description` | `Hasura GraphQL Engine on Cloud Run` | Description du service. |
| `application_version` | `v2.36.0` | Tag de l'image Hasura ; `latest` est remappé vers un tag v2.x épinglé au moment du build. |
| `application_database_name` | `hasura` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `hasura` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit une image wrapper qui assemble les DSN ; `prebuilt` nécessite une configuration d'URL manuelle. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU convient à la plupart des charges de travail. |
| `memory_limit` | `512Mi` | Mémoire par instance ; augmenter pour une concurrence de requêtes élevée. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro (sûr — tout l'état est dans Postgres). |
| `max_instance_count` | `3` | Limite supérieure d'autoscaling ; Hasura s'adapte horizontalement. |
| `container_port` | `8080` | Hasura se lie à `HASURA_GRAPHQL_SERVER_PORT = 8080`. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Hasura n'effectue aucun travail en arrière-plan entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `300` | Durée maximale de la requête (augmenter pour les abonnements/streaming longs). |
| `enable_cloudsql_volume` | `true` | Socket du Cloud SQL Auth Proxy pour la connexion Postgres. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Hasura dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux clients externes et à la console d'atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'ensemble du service (API incluse). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `HASURA_GRAPHQL_*` supplémentaires (par exemple `HASURA_GRAPHQL_DEV_MODE`, `HASURA_GRAPHQL_CORS_DOMAIN`). Ne pas définir les deux valeurs `*_DATABASE_URL` ou le secret d'administration ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Hasura ne nécessite aucun stockage de fichiers. |
| `enable_nfs` | `false` | Non requis pour Hasura. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Hasura nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé / `[]` | Extensions Postgres optionnelles. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler récurrent + Cloud Run Jobs. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés avec Hasura. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` | Sonde de démarrage au niveau de l'application. |
| `liveness_probe` | HTTP `/healthz` | Sonde de vivacité au niveau de l'application. |
| `startup_probe_config` | HTTP `/healthz` | Sonde de démarrage Cloud Run (niveau fondation). |
| `health_check_config` | HTTP `/healthz` | Sonde de vivacité Cloud Run (niveau fondation). |
| `uptime_check_config` | `{ enabled=false, path="/healthz" }` | Contrôle de disponibilité Cloud Monitoring. Désactivé par défaut ; activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Hasura ne nécessite pas Redis. |
| `redis_host` | `""` | Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id` pour les projets imbriqués dans des dossiers). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `storage_buckets` | Buckets Cloud Storage créés (vides pour Hasura). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, contrôles de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `HASURA_GRAPHQL_ADMIN_SECRET` (auto-généré) | Conserver dans Secret Manager ; faire pivoter délibérément | Critique | C'est la seule protection sur les API GraphQL/métadonnées et la console — l'exposer accorde un accès complet en lecture/écriture à chaque table suivie. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline le catalogue de métadonnées et toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide fait échouer le job d'importation. |
| `startup_probe` / chemin `liveness_probe` | `/healthz` | Élevé | Pointer une sonde vers `/v1/graphql` ou `/console` renvoie 401 — la révision ne devient jamais prête même si le moteur a démarré. |
| `HASURA_GRAPHQL_ENABLE_CONSOLE` | `false` en production | Élevé | Laisser la console activée en production élargit la surface d'attaque ; gérer les métadonnées via la CLI `hasura`/migrations à la place. |
| `ingress_settings` + `enable_iap` | `all` ; IAP uniquement si l'API peut être protégée par l'identité | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients API programmatiques qui s'authentifient avec l'en-tête admin/JWT, et non l'identité Google. |
| `container_image_source` | `custom` | Élevé | `prebuilt` ignore le point d'entrée qui assemble les deux valeurs `*_DATABASE_URL` — le moteur démarre sans base de données et chaque requête échoue. |
| `memory_limit` | `512Mi`+ | Moyen | Des métadonnées très volumineuses ou une concurrence de requêtes élevée peuvent provoquer un OOM en dessous de 512 Mio ; l'environnement gen2 plafonne la mémoire à 512 Mio quoi qu'il arrive. |
| `min_instance_count` | `0` (ou `1` pour la latence) | Moyen | La mise à l'échelle à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après l'inactivité ; définir `1` pour les API sensibles à la latence. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'API et la console sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à Hasura partagée avec la variante GKE est décrite dans
**[Hasura_Common](Hasura_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hasura sur Cloud Run](../labs/Hasura_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Hasura sur GKE Autopilot](Hasura_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Hasura Common — Configuration d'application partagée](Hasura_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Supabase sur GKE Autopilot](Supabase_GKE.md), [Directus sur Cloud Run](Directus_CloudRun.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) dans la solution **Services de backend d'application**.
