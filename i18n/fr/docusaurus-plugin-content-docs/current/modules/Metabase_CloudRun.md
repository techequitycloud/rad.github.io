---
title: "Metabase sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Metabase sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Metabase_CloudRun.md @ 1665a43e sha256:2b3b840c2c21 -->

# Metabase sur Google Cloud Run {#metabase-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Metabase_CloudRun.png" alt="Metabase sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Metabase est une plateforme open source de business intelligence et d'analyse qui
permet aux utilisateurs non techniques d'interroger, de visualiser et de partager des
données sans écrire de SQL. Ce module déploie Metabase sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Metabase et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Metabase sur RAD, et comment cela se compare {#what-metabase-costs-on-rad-and-how-that-compares}

**L'exécution de Metabase dans votre propre projet GCP coûte environ 88,56 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~88,56 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~26 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | 31,53 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **88,56 $** |

### Comment cela se compare {#how-it-compares}

- Le cloud géré officiel de Metabase (Metabase Cloud) commence à **90 $/mois** (Starter, facturé mensuellement ; 100 $/mois prix catalogue) (source : https://www.metabase.com/pricing), géré par le projet lui-même sans infrastructure à opérer — la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un outil BI/analytique d'équipe interrogé occasionnellement plutôt que continuellement, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement
le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou la
ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien
n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande
à Google de restaurer le projet et de rattacher son compte de facturation, puis vous
demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est
revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les
mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et
une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une
poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours —
après cela, Google le supprime définitivement — et la restauration est admise comme
la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours
dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des
utilisations d'étude/démo conviennent). Google affirme que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours.
Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Metabase
purement et simplement et de le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de
temps de build.

La suppression ne permet d'économiser de l'argent que si Metabase reste
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution quotidien — par rapport au total du
projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie
du coût d'exécution ici est généralement la base de données ; elle ne s'arrête
que si rien d'autre dans le projet ne l'utilise, donc la suppression de cette
application alors que quelque chose d'autre partage le projet n'économise que
la partie calcul de cette application.

**Gardez les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
  et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin, le partenaire remet le projet et les déploiements
  deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://www.metabase.com/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Metabase s'exécute en tant que conteneur Java/JVM (Jetty) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service JVM, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Metabase stocke tout l'état de l'application (questions, tableaux de bord, utilisateurs) dans PostgreSQL |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré ; Metabase gère ses propres clés internes |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app`, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge.** Tout l'état de l'application
  réside dans cette base de données.
- **Aucun Redis n'est requis.** Metabase n'utilise pas Redis ; `enable_redis` par
  défaut `false`.
- **`min_instance_count` par défaut `0` (mise à l'échelle à zéro).** Les démarrages
  à froid de la JVM prennent 60 à 120 secondes. Définissez sur `1` pour la
  production afin d'éliminer cette latence.
- **`cpu_always_allocated` par défaut `false` (facturation basée sur les requêtes).** Metabase
  sert des requêtes interactives à la demande, donc le CPU n'est facturé que
  lors du traitement d'un appel. Si vous comptez sur des **abonnements/pulsations
  planifiés ou des analyses périodiques de synchronisation de base de données**,
  ce travail s'exécute sans requête entrante et est ralenti par la facturation
  basée sur les requêtes — définissez `cpu_always_allocated = true` pour que les jobs planifiés
  se terminent réellement.
- **Les sondes de santé ciblent `/api/health`** (HTTP), qui renvoie 200 seulement
  une fois que la JVM est entièrement démarrée. La sonde de démarrage utilise un
  délai initial de 120 secondes avec 15 tentatives, ce qui donne une tolérance
  totale d'environ 270 secondes.
- **`MB_JETTY_PORT = "3000"` et `JAVA_TIMEZONE = "UTC"` sont injectés automatiquement** — ne les
  remplacez pas.
- **Aucun bucket de stockage GCS n'est créé par défaut.** Metabase stocke tout
  dans PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Metabase {#a-cloud-run--the-metabase-service}

Metabase s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement
à la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs. Avec `min_instance_count = 0`, le service s'adapte à
zéro lorsqu'il est inactif ; les démarrages à froid de la JVM prennent 60 à 120
secondes, alors définissez `min_instance_count = 1` pour la production.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Metabase stocke l'intégralité de l'état de son application — questions, tableaux
de bord, collections, utilisateurs, permissions et paramètres — dans une instance
gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte en privé via le
**Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté
dans le service au moment de l'exécution. Metabase gère ses propres clés de
chiffrement internes séparément.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être superposé ; les paramètres d'ingress et le contrôle d'égresse VPC contrôlent
la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs de conteneurs (y compris la sortie JVM) sont envoyés à Cloud Logging ;
les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des
tests de disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Metabase {#3-metabase-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation s'exécute avant le démarrage du service. Il utilise `postgres:15-alpine`
  pour se connecter à Cloud SQL et créer de manière idempotente la base de données
  et l'utilisateur de l'application. Il peut être réexécuté en toute sécurité.
- **Pas de migration automatique au démarrage.** Metabase applique les migrations
  dans le cadre de son propre processus de démarrage — le job `db-init` doit
  réussir en premier afin que la base de données et l'utilisateur existent déjà
  lorsque Metabase démarre.
- **Attention à la mise à niveau.** Les migrations Metabase sont unidirectionnelles.
  La rétrogradation après l'exécution d'une migration corrompt le schéma. Testez
  toujours les mises à niveau en staging avant de les appliquer en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`
  (HTTP 200 lorsque la JVM est entièrement initialisée). La sonde de démarrage
  permet un délai initial de 120 secondes plus 15 × 10s de tentatives (~270
  secondes au total). Ne réduisez pas ces valeurs.
- **Configuration administrateur.** Au premier démarrage, Metabase présente un
  assistant de configuration dans le navigateur. Les identifiants administrateur
  sont gérés à l'intérieur de Metabase lui-même — aucun secret administrateur
  n'est créé par ce module.
- **Sources de données.** Après le déploiement, configurez les sources de données
  dans Metabase Admin → Databases. Les sources natives GCP courantes incluent
  BigQuery, Cloud SQL PostgreSQL/MySQL et Google Sheets.
- **`MB_JETTY_PORT` et `JAVA_TIMEZONE` sont fixes.** Injectés automatiquement par
  `Metabase_Common`. Les remplacer rompt le routage ou produit des horodatages de
  rapports incohérents.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Metabase sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `metabase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Metabase Analytics` | Nom convivial affiché dans la console. |
| `description` | `Metabase — open-source business intelligence and analytics platform` | Description du service. |
| `application_version` | `v0.51.3` | Tag de version de l'image Metabase. **Ne jamais rétrograder** — les migrations sont irréversibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; minimum 1 vCPU, 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; la JVM nécessite au moins 2 GiB ; 4 GiB recommandés pour la production. |
| `min_instance_count` | `0` | Instances minimales. Définir sur `1` pour la production afin d'éliminer les démarrages à froid de la JVM de 60 à 120 secondes. |
| `max_instance_count` | `3` | Instances maximales (plafond de coût). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut — Metabase sert à la demande. Définir `true` si vous comptez sur des abonnements/pulsations planifiés ou des analyses périodiques de synchronisation de base de données, qui s'exécutent sans requête entrante et seraient autrement ralenties. |
| `container_port` | `3000` | Port Jetty de Metabase — doit correspondre à `MB_JETTY_PORT`. |
| `execution_environment` | `gen2` | Gen2 recommandé pour des performances de démarrage améliorées. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions de socket Unix. Requis. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour les requêtes analytiques de longue durée. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Utiliser `internal-and-cloud-load-balancing` pour la production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Recommandé pour les déploiements internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MB_JETTY_PORT` et `JAVA_TIMEZONE` sont injectés automatiquement — ne pas les remplacer. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager (par exemple, mot de passe SMTP). |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et NFS {#group-9--custom-sql-scripts--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Stockage NFS — non requis pour Metabase. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS lorsque `storage_buckets` n'est pas vide. |
| `storage_buckets` | `[]` | Vide par défaut — Metabase ne nécessite pas de stockage d'objets. |
| `enable_nfs` | `false` | Le stockage NFS n'est pas requis pour Metabase. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Metabase nécessite PostgreSQL. |
| `db_name` | `metabase` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `metabase` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (création de base de données PostgreSQL + utilisateur). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/api/health`, délai initial 120s, seuil d'échec 15 | Sonde de démarrage HTTP ; tolérance totale ~270s pour JVM. Ne pas réduire. |
| `liveness_probe` | `/api/health`, délai initial 120s, seuil d'échec 3 | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/health` | Test de disponibilité Cloud Monitoring. Activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Metabase n'utilise pas Redis ; laisser désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | _(défini)_ | Pertinent uniquement si un plugin ou une configuration personnalisée nécessite Redis. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de l'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Metabase nécessite PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation interrompt toutes les connexions à la base de données (sidecar Auth Proxy requis). |
| `memory_limit` | `4Gi` | Critique | En dessous de 2 GiB, la JVM plante avec OutOfMemoryError au démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de l'application. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `application_version` | incrémenter avec précaution | Critique | Les migrations Metabase sont unidirectionnelles ; la rétrogradation corrompt le schéma. |
| `startup_probe.failure_threshold` | `15` (≥ 15) | Élevé | La réduction entraîne des arrêts prématurés du conteneur avant que la JVM ne termine son démarrage. |
| `min_instance_count` | `1` pour la production | Élevé | `0` provoque des démarrages à froid de 60 à 120 secondes ; échecs de la sonde de démarrage à la première requête. |
| `cpu_limit` | `2000m` | Élevé | En dessous de 500m, la compilation JIT de la JVM bloque le démarrage, déclenchant des échecs de sonde. |
| `cpu_always_allocated` | `true` si utilisation d'abonnements/pulsations planifiés/analyses de synchronisation de base de données | Moyen | Par défaut `false` (facturation basée sur les requêtes) ; les abonnements/pulsations planifiés/analyses de synchronisation de base de données s'exécutent sans requête entrante et sont limités à un CPU quasi nul, de sorte qu'ils peuvent ne pas se terminer à moins d'être basculés sur `true`. |
| `enable_iap` / `ingress_settings` | IAP activé ; `internal-and-cloud-load-balancing` | Élevé | La page de connexion Metabase est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `timeout_seconds` | `300` | Moyen | La réduction en dessous de 120s interrompt les requêtes analytiques en cours. |
| `enable_auto_password_rotation` | `false` | Moyen | L'activation sans `rotation_propagation_delay_sec` suffisant provoque de brèves erreurs 500 pendant la rotation. |
| `enable_redis` | `false` | Faible | Metabase n'utilise pas Redis ; l'activation n'a aucun effet. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à Metabase partagée avec la variante GKE est décrite dans
**[Metabase_Common](Metabase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Metabase sur Cloud Run](../labs/Metabase_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Metabase sur GKE Autopilot](Metabase_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Metabase Common — Configuration d'application partagée](Metabase_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Odoo sur Cloud Run](Odoo_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Plateforme ERP intégrée**.
