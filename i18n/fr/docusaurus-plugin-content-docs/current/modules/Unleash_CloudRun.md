---
title: "Unleash sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Unleash sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Unleash_CloudRun.md @ e69407af sha256:5dbaa87417e3 -->

# Unleash sur Google Cloud Run {#unleash-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Unleash_CloudRun.png" alt="Unleash sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Unleash est une plateforme open source, sous licence Apache-2.0, de gestion de
fonctionnalités (feature flags) et de bascules (toggles) pour la livraison
progressive, les tests A/B et les déploiements progressifs. Ce module déploie
Unleash sur **Cloud Run v2** en s'appuyant sur la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Unleash et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Unleash sur RAD, et comment cela se compare {#what-unleash-costs-on-rad-and-how-that-compares}

**L'exécution d'Unleash sur Cloud Run dans votre propre projet Google Cloud
coûte environ 67,80 $ US/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 75 crédits (7,50 $ US) facturé une fois au moment du
déploiement. Unleash est une plateforme open source de gestion de
fonctionnalités et de livraison progressive, et sa base de données Postgres
représente la majeure partie de ce coût d'exécution. Dans un projet géré par
RAD, les frais de module tombent à 67,5 crédits (10 % de moins) — voir
[Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous — ou consultez le [guide GKE](Unleash_GKE.md) si vous préférez
l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 67,80 $ US/mois, facturé par Google au prix catalogue | ~26 crédits/jour (environ 780/mois, 78 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan
mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **67,80 $ US** |

### Comment cela se compare {#how-it-compares}

- Le cloud hébergé d'Unleash est tarifé par **siège** : le paiement à l'usage
  est de 75 $/siège/mois avec un minimum de 5 sièges, donc une petite équipe
  est facturée à partir de 375 $/mois, et l'Enterprise est sur devis — vérifié
  sur la page de tarification d'Unleash, le 8 octobre 2026. Le coût du projet
  propre de RAD (environ 68 $ US/mois, forfaitaire, sans minimum de sièges)
  est une fraction de l'engagement le plus petit d'Unleash Cloud.
- Une comparaison avec un VPS autogéré, dimensionné selon le léger par défaut
  d'Unleash de 1 vCPU / 0,5 GiB : un Hetzner CPX11 ou un DigitalOcean 1 vCPU/2
  Go Droplet coûte environ 6-12 $/mois — moins cher en termes de trésorerie,
  plus votre propre temps pour les sauvegardes et les correctifs Postgres, que
  Cloud SQL et Secret Manager gérés par RAD couvrent pour vous.
- Les plateformes de gestion de fonctionnalités sont généralement adoptées par
  une équipe d'ingénieurs de plus de cinq personnes, ce qui est précisément là
  où la tarification par siège d'Unleash Cloud frappe le plus fort et où un
  coût d'exécution forfaitaire auto-hébergé cesse de s'adapter à l'effectif.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer le projet purement et
simplement — une suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un seul module, cela ne détruit **pas** Cloud
SQL, une VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
affirme que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé Unleash et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un
projet géré par RAD, il n'y a pas de pause gratuite — la suppression supprime
définitivement les ressources, et ramener Unleash signifie le redéployer à
partir de zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou
environ 70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Unleash reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son
propre coût d'exécution — environ 4 jours ou plus dans votre propre projet
(environ 2,26 $ US par jour), ou environ 3 jours ou plus dans un projet géré par
RAD (26 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket
à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

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
[documentation de suppression/restauration de projet de Google](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ;
[tarification d'Unleash](https://www.getunleash.io/pricing).

## 1. Vue d'ensemble {#1-overview}

Unleash s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Unleash ne prend pas en charge MySQL ou d'autres moteurs |
| Secrets | Secret Manager | Jeton d'API administrateur de démarrage auto-généré (`INIT_ADMIN_API_TOKENS`) ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Unleash est sans état.** Toutes les données de drapeaux, bascules,
  stratégies, segments et audit résident dans PostgreSQL — aucun stockage
  d'objets, NFS ou volume persistant n'est provisionné, et toute instance peut
  servir n'importe quelle requête.
- **Pas de backend Redis ou de file d'attente.** Unleash n'a pas besoin de
  cache ou de file d'attente ; il s'adapte horizontalement en pointant plus
  d'instances vers la même base de données.
- **`INIT_ADMIN_API_TOKENS` est généré automatiquement** et stocké dans Secret Manager.
  Unleash injecte ce jeton d'API administrateur à accès complet (`*:*`)
  dans sa base de données au premier démarrage afin que l'automatisation puisse
  appeler l'API d'administration immédiatement.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Les démarrages à froid ajoutent quelques secondes à la
  première requête après l'inactivité. Définissez `min_instance_count = 1` si les clients
  SDK interrogent à un intervalle serré et que la latence de démarrage à froid
  est inacceptable.
- **`DATABASE_URL` est assemblé au démarrage du conteneur** à partir des
  variables `DB_*` injectées par la plateforme par le point d'entrée de
  l'image personnalisée, qui se ramifie sur le type de connexion (socket,
  proxy de bouclage ou IP privée) et maintient la vérification du certificat
  TLS activée pour les connexions IP privées directes (sécurisé par défaut).
- **Le point de terminaison de santé est `/health`** — un point de
  terminaison public, non authentifié, qui renvoie 200. L'API d'administration
  sous `/api/admin/*` nécessite un jeton.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Unleash {#a-cloud-run--the-unleash-service}

Unleash s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Unleash stocke toutes les données d'application (projets, drapeaux de
fonctionnalités, stratégies, segments, jetons d'API, utilisateurs et journal
des modifications/audits) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Le service se connecte en privé via le **proxy d'authentification
Cloud SQL** ; aucune IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de
l'application, et Unleash applique ses propres migrations de schéma au
démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Un jeton d'API administrateur de démarrage est généré automatiquement et
stocké dans Secret Manager, injecté sous le nom `INIT_ADMIN_API_TOKENS`. Le mot de passe
de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Use the token against the Admin API:
  curl -s -H "Authorization: <token>" "$SERVICE_URL/api/admin/projects"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet aux
clients SDK et aux systèmes CI d'accéder à l'API Unleash. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC
gèrent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests
de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Unleash {#3-unleash-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le proxy d'authentification Cloud SQL et crée de manière
  idempotente la base de données et l'utilisateur de l'application et accorde
  les privilèges. Le job peut être réexécuté en toute sécurité ; il ne crée
  **pas** de tables.
- **Migrations de schéma au démarrage.** Unleash applique ses propres
  migrations de schéma automatiquement à chaque démarrage, de sorte que la mise
  à niveau de la version de l'application applique les modifications de schéma
  sans étape de migration distincte. Prévoyez une marge de démarrage généreuse
  lors du premier démarrage sur une base de données vide.
- **`DATABASE_URL` est composé à l'exécution.** Le point d'entrée de l'image
  personnalisée assemble la chaîne de connexion à partir des variables
  `DB_*` injectées. Vérifiez les variables injectées de la révision en
  cours d'exécution lors du débogage d'un problème de connexion :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Jeton d'API administrateur de démarrage.** `INIT_ADMIN_API_TOKENS` injecte un jeton
  d'API administrateur à accès complet (`*:*`) au premier démarrage
  afin que CI, l'interface CLI d'Unleash et les backends SDK puissent appeler
  l'API d'administration sans connexion à l'interface utilisateur. Récupérez-le
  depuis Secret Manager (§2C).
- **Identifiants d'interface utilisateur par défaut.** L'interface
  utilisateur d'administration fournit un compte de première exécution
  bien connu — `admin` / `unleash4all`. Changez le mot de passe
  immédiatement après la première connexion.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health` — un point de terminaison public, non authentifié, qui renvoie
  200 uniquement lorsque le serveur est initialisé et connecté à PostgreSQL.
  L'API d'administration sous `/api/admin/*` nécessite un jeton, elle ne doit
  donc jamais être utilisée comme chemin de sonde.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Unleash sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `unleash` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Unleash` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Unleash Analytics on Cloud Run` | Description du service. |
| `application_version` | `5.7.0` | Tag d'image `unleashorg/unleash-server` ; `latest` est remappé à un tag épinglé au moment du build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Cloud Build enveloppe `unleashorg/unleash-server` avec le point d'entrée DATABASE_URL. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU est suffisant pour la plupart des déploiements. |
| `memory_limit` | `512Mi` | Mémoire par instance ; augmentez à `1Gi` pour une utilisation intensive de l'administration/du reporting. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour un polling SDK serré. |
| `max_instance_count` | `3` | Unleash s'adapte horizontalement — tout l'état est dans PostgreSQL. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes ; Unleash n'effectue aucun travail en arrière-plan nécessitant un CPU toujours actif. |
| `container_port` | `4242` | Unleash écoute sur le port 4242. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux clients SDK et CI d'atteindre l'API Unleash. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque le trafic SDK authentifié par jeton.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DATABASE_URL` est assemblé à l'exécution — ne le définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Unleash ne nécessite pas de stockage de fichiers. |
| `enable_nfs` | `false` | NFS est désactivé ; Unleash est sans état. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Unleash nécessite PostgreSQL. |
| `application_database_name` | `unleash` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `unleash` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé / `[]` | Extensions PostgreSQL facultatives. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler planifié + Cloud Run Jobs. |
| `additional_services` | `[]` | Services Cloud Run auxiliaires/sidecar. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30s de délai, 30 tentatives | Sonde de démarrage. Prévoyez une marge pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/health`, 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage Cloud Run structurée. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité Cloud Run structurée. |
| `uptime_check_config` | désactivé, `/health` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Unleash ne nécessite pas Redis ; laissez désactivé. |
| `redis_host` | `""` | Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (découvre automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
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
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vides pour Unleash). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD et dépôt connecté. |
| `deployment_id` / `project_id` | Identifiants de nommage et de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> réplica en lecture sans son primaire, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `backup_retention_days` hors plage. Une
> configuration invalide fait échouer la **planification** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Tout autre moteur interrompt le démarrage d'Unleash — il ne prend en charge que PostgreSQL. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de drapeaux. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` (auto) | Garder `true` sur IP privée | Critique | La désactivation de la vérification du certificat sur une connexion TCP IP privée affaiblit la sécurité du transport. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_file` valide fait échouer le job d'importation. |
| `startup_probe` / chemin `liveness_probe` | `/health` | Élevé | Pointer une sonde vers `/api/admin/*` renvoie 401/403 et la révision ne devient jamais prête. |
| `enable_iap` | uniquement s'il n'y a pas de trafic SDK | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les appels SDK/CI authentifiés par jeton vers l'API Unleash. |
| `ingress_settings` | `all` | Élevé | `internal` bloque les clients SDK externes et CI d'atteindre l'API Unleash. |
| `INIT_ADMIN_API_TOKENS` (auto) | Récupérer de Secret Manager | Moyen | Le jeton injecté accorde des droits d'API administrateur à accès complet — traitez-le comme un secret et faites-le pivoter s'il est exposé. |
| Connexion UI par défaut `admin` / `unleash4all` | Changer lors de la première connexion | Élevé | Laisser le mot de passe par défaut expose le contrôle administrateur complet de chaque drapeau. |
| `min_instance_count` | `0` (par défaut) ou `1` | Moyen | La mise à l'échelle à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Unleash partagée avec la variante GKE est décrite
dans **[Unleash_Common](Unleash_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Unleash sur Cloud Run](../labs/Unleash_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Unleash sur GKE Autopilot](Unleash_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Unleash Common — Configuration d'application partagée](Unleash_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [Tolgee sur Google Cloud Run](Tolgee_CloudRun.md) dans la solution **Gestion des versions et qualité**.
