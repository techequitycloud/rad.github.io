---
title: "Vaultwarden sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Vaultwarden sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Vaultwarden_CloudRun.md @ e69407af sha256:4a9fdb655b04 -->

# Vaultwarden sur Google Cloud Run {#vaultwarden-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vaultwarden_CloudRun.png" alt="Vaultwarden sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vaultwarden est un gestionnaire de mots de passe léger, auto-hébergé et compatible
Bitwarden, écrit en Rust. Ce module déploie Vaultwarden sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Vaultwarden et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Vaultwarden sur RAD, et comment cela se compare {#what-vaultwarden-costs-on-rad-and-how-that-compares}

**L'exécution de Vaultwarden sur Cloud Run dans votre propre projet Google Cloud coûte environ 80,31 US$/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits (7,50 US$) facturé une seule fois au moment du déploiement. Vaultwarden est un serveur de gestionnaire de mots de passe léger, basé sur Rust et compatible Bitwarden, de sorte que toutes les applications clientes Bitwarden officielles fonctionnent avec lui sans modification. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous — ou voir le [guide GKE](Vaultwarden_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 80,31 US$/mois, facturé par Google au prix catalogue | ~36 crédits/jour (environ 1080/mois, 108 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un abonnement mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (chaud) | 9,86 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **80,31 US$** |

### Comment cela se compare {#how-it-compares}

- Le propre service hébergé de **Bitwarden**, avec lequel Vaultwarden est conçu pour être compatible, facture par utilisateur : Teams est à 4 $/utilisateur/mois et Enterprise à 6 $/utilisateur/mois (les deux facturés annuellement, plans professionnels), avec un plan personnel Premium à 1,65 $/mois — vérifié sur la page de tarification de Bitwarden, le 8 octobre 2026. Une équipe de 10 personnes sur Bitwarden Teams coûte 40 $/mois pour toujours, augmentant avec les effectifs ; le coût d'exécution du propre projet de RAD est un forfait d'environ 80 US$/mois, quel que soit le nombre de personnes ayant des coffres-forts, et les données ne quittent jamais votre propre projet.
- Une comparaison VPS autogérée, dimensionnée pour le léger 1 vCPU / 0,5 GiB par défaut de Vaultwarden : un Hetzner CPX11 ou DigitalOcean 1 vCPU/2 Go Droplet coûte environ 6-12 $/mois — moins cher en termes monétaires, plus votre propre temps pour les sauvegardes et les correctifs Postgres, ce qui est plus important ici que sur la plupart des applications car il s'agit d'un coffre-fort de mots de passe.
- Le propre coût d'exécution de Vaultwarden dépasse le prix par siège de Bitwarden Teams à environ 20 utilisateurs ; en dessous, le propre hébergement de Bitwarden est l'option la moins chère en termes monétaires, et l'argument de RAD est le contrôle total des données plutôt que le prix.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et cela ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
supprimer purement et simplement le projet — la propre suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un seul module, cela ne démantèle **pas** Cloud SQL,
aucune VM, ni la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de
récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien
n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà là —
c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais
de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une
chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation),
vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement —
et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart
des utilisations d'étude/démo conviennent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet,
et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc
très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même
est récupérable pendant 30 jours. Si vous avez personnalisé Vaultwarden et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression retire les ressources définitivement, et ramener Vaultwarden signifie le redéployer
à partir de zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou environ
70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Vaultwarden devait rester inutilisé assez longtemps pour que
le coût de redéploiement soit compensé par son propre coût d'exécution — environ 3 jours ou plus dans votre propre projet
(environ 2,68 US$ par jour), ou environ 2 jours ou plus dans un projet géré par RAD
(36 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite
d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit
chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits
non utilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client
à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne
ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements
deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [tarification Bitwarden](https://bitwarden.com/pricing/).

## 1. Vue d'ensemble {#1-overview}

Vaultwarden s'exécute comme un binaire Rust compilé sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service binaire Rust, 1 vCPU / 512 Mio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 (par défaut) ou MySQL 8.0 | Moteur configurable ; le job d'initialisation s'ajuste automatiquement |
| Stockage d'objets | Cloud Storage | Un bucket `vaultwarden-attachments` dédié |
| Secrets | Secret Manager | Mot de passe de la base de données ; Vaultwarden gère son propre jeton d'administration en interne |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Les inscriptions sont fermées par défaut.** `signups_allowed = false` empêche
  la création de comptes anonymes. N'activez que lors de la configuration initiale de l'administrateur, puis désactivez.
- **Aucun jeton d'administration n'est généré automatiquement.** Le panneau `/admin` est désactivé, sauf si vous
  fournissez `ADMIN_TOKEN` dans `environment_variables`. C'est la valeur par défaut sécurisée.
- **`domain` doit être défini pour WebAuthn et TOTP.** Sans l'URL publique complète, les codes QR 2FA
  pointent vers `localhost` et les e-mails d'invitation d'organisation contiennent des liens brisés.
- **Les sondes de santé ciblent `/alive`**, le point de terminaison de santé léger dédié de Vaultwarden.
  Vaultwarden démarre en quelques secondes ; la sonde de démarrage utilise un délai initial de 30 s.
- **`cpu_limit` doit être au moins `1000m`.** Cloud Run gen2 avec CPU toujours alloué
  (requis pour un gestionnaire de mots de passe `min_instance_count ≥ 1`) nécessite au moins 1 vCPU.
- **`execution_environment = "gen2"` est la valeur par défaut** et ne doit pas être modifiée ; elle est
  requise pour les connexions de socket Unix au proxy d'authentification Cloud SQL.
- **`min_instance_count = 1` maintient le coffre-fort chaud.** La mise à l'échelle à zéro rend un gestionnaire de mots de passe
  indisponible pendant plusieurs secondes ; les clients Bitwarden affichent des erreurs de connexion.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Vaultwarden {#a-cloud-run--the-vaultwarden-service}

Vaultwarden s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL — PostgreSQL 15 ou MySQL 8.0 {#b-cloud-sql--postgresql-15-or-mysql-80}

Vaultwarden stocke toutes les données du coffre-fort dans une instance Cloud SQL gérée. Le moteur par défaut
est **PostgreSQL 15** ; définissez `database_type = "MYSQL_8_0"` pour utiliser MySQL à la place. Le
service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix
(pas d'IP publique). Lors du premier déploiement, un job d'initialisation crée la base de données
et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`vaultwarden-attachments`) est provisionné pour
les fichiers joints. Le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans le service au
moment de l'exécution. Vaultwarden gère son propre jeton d'administration interne et ses clés de signature RSA dans
le répertoire `/data` — ceux-ci ne sont pas stockés dans Secret Manager.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN (avec prudence — ne pas mettre en cache les réponses API authentifiées) et Cloud Armor peuvent être superposés. Cloud Armor est fortement recommandé pour protéger le point de terminaison de connexion de Vaultwarden contre les attaques par force brute.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des tests de disponibilité optionnels (ciblant `/alive`) et des règles d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Vaultwarden {#3-vaultwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation crée la base de données
  et l'utilisateur Vaultwarden avant le démarrage du service. Il est idempotent. L'image de job correcte
  est sélectionnée automatiquement : `postgres:15-alpine` pour PostgreSQL, `mysql:8.0-debian`
  pour MySQL.
- **Pas de migrations de schéma au démarrage.** Vaultwarden gère automatiquement sa propre évolution de schéma interne ;
  aucune commande de migration n'est nécessaire.
- **Aucune tâche planifiée requise.** Contrairement à de nombreuses applications web, Vaultwarden n'a pas de
  tâches cron obligatoires. Toutes les opérations de coffre-fort sont basées sur les requêtes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/alive`, qui renvoie
  `OK` lorsque le serveur est prêt. Le délai initial est de 30 s, correspondant au démarrage rapide de Vaultwarden en Rust.
- **Panneau d'administration.** Le panneau `/admin` est désactivé, sauf si `ADMIN_TOKEN` est fourni via
  `environment_variables`. Générez un jeton aléatoire sécurisé (par exemple avec
  `openssl rand -base64 48`) et injectez-le au moment de l'exécution.
- **SMTP pour les notifications.** Vaultwarden utilise SMTP pour la vérification de compte, les codes de récupération 2FA
  et les e-mails d'accès d'urgence. Configurez `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_FROM`, `SMTP_USERNAME` et `SMTP_PASSWORD` (via `secret_environment_variables`)
  comme un ensemble complet — une configuration SMTP partielle entraîne des échecs de livraison silencieux.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Vaultwarden sont listés ; toute autre entrée est
héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application et paramètres Vaultwarden {#group-3--application-identity--vaultwarden-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vaultwarden` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Vaultwarden Password Manager` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `1.32.7` | Tag de version de l'image Vaultwarden. |
| `domain` | `""` | **URL publique complète** (par exemple `https://vault.example.com`). Requise pour WebAuthn, les codes QR TOTP, les invitations d'organisation et les liens de pièces jointes. |
| `signups_allowed` | `false` | Autoriser l'auto-inscription de nouveaux utilisateurs. N'activer que pendant la configuration initiale ; désactiver immédiatement après la création des comptes administrateur. |
| `web_vault_enabled` | `true` | Servir l'interface web de Vaultwarden. Désactiver pour un accès API uniquement via des clients natifs. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit à partir du Dockerfile ; `prebuilt` utilise un URI d'image existant. |
| `cpu_limit` | `1000m` | CPU par instance. Minimum `1000m` appliqué par validation (exigence Cloud Run gen2). |
| `memory_limit` | `512Mi` | Mémoire par instance. Vaultwarden est très léger au repos. |
| `min_instance_count` | `1` | Instances minimales. Garder ≥ 1 pour éviter l'indisponibilité du coffre-fort au démarrage à froid. |
| `max_instance_count` | `3` | Instances maximales (plafond de coût). |
| `container_port` | `80` | Port HTTP Rocket de Vaultwarden. Doit correspondre à `ROCKET_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. Requis. |
| `execution_environment` | `gen2` | Gen2 est requis pour le support des sockets Unix. Ne pas modifier. |
| `cpu_always_allocated` | `false` | Vaultwarden sert sur demande par défaut (facturation basée sur les requêtes). Passer à `true` uniquement si vous activez le serveur de notifications push WebSocket de Vaultwarden — le CPU bridé entre les requêtes rompt sinon la connexion WS persistante que les clients interrogent. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes (0–3600). |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver pour le retour arrière. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Remarque : IAP peut empêcher les clients Bitwarden natifs de se connecter. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(valeurs par défaut SMTP/log)_ | Paramètres en texte clair. Les valeurs principales `ROCKET_PORT`, `SIGNUPS_ALLOWED`, `WEB_VAULT_ENABLED`, `DATA_FOLDER`, et éventuellement `DOMAIN` sont injectées automatiquement. La valeur par défaut inclut `LOG_LEVEL=warn`, `SHOW_PASSWORD_HINT=false`, et des valeurs de stub SMTP. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple `{ SMTP_PASSWORD = "vaultwarden-smtp-pass" }`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Cadence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `30` | Rétention ; la valeur par défaut de 30 jours reflète l'importance de la récupération du coffre-fort. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et Cloud Armor {#group-10--load-balancer-cdn--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | **Recommandé pour Vaultwarden.** Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF pour protéger le point de terminaison de connexion contre la force brute. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés. Définissez également `domain` sur l'URL complète `https://`. |
| `enable_cdn` | `false` | Cloud CDN. **Ne mettez pas en cache les réponses API authentifiées** — assurez-vous que les en-têtes `Cache-Control: no-store` sont en place. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket des pièces jointes. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires. |
| `enable_nfs` | `true` | Volume NFS Filestore optionnel. Non requis pour Vaultwarden dans Cloud Run (les données sont dans Cloud SQL et GCS). |
| `nfs_mount_path` | `/data` | Chemin de montage NFS à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | `POSTGRES_15` (par défaut) ou `MYSQL_8_0`. L'image du job d'initialisation est sélectionnée automatiquement. |
| `db_name` | `vaultwarden` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `vaultwarden` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré (sélectionne automatiquement l'image correcte pour PostgreSQL ou MySQL). |
| `cron_jobs` | `[]` | Vaultwarden n'a pas de tâches planifiées requises ; ajoutez des jobs Cloud Run personnalisés ici si nécessaire. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/alive`, délai de 30 s, 6 échecs | Chemin de santé dédié de Vaultwarden ; 30 s correspond au démarrage rapide de Rust. |
| `liveness_probe` | HTTP `/alive`, délai de 30 s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/alive` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Vaultwarden n'utilise pas Redis nativement. Laisser désactivé sauf si vous ajoutez une intégration personnalisée. |
| `redis_host` / `redis_port` / `redis_auth` | _(défini)_ | Point de terminaison, port et authentification Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
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
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `signups_allowed` | `false` | Critique | Tout utilisateur internet peut s'auto-enregistrer sur le coffre-fort tant que `true`. Désactiver immédiatement après la création des comptes administrateur. |
| `enable_cloudsql_volume` | `true` | Critique | Vaultwarden se connecte à Cloud SQL via un socket Unix ; la désactivation entraîne l'échec de toutes les connexions à la base de données au démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | La modification après le premier déploiement entraîne la connexion de Vaultwarden à une base de données vide ; toutes les informations d'identification semblent perdues. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `domain` | URL `https://` complète | Élevé | Sans cela, les codes QR TOTP pointent vers `localhost`, les e-mails d'invitation d'organisation contiennent des liens brisés et les URL de pièces jointes sont invalides. |
| `database_type` | défini une fois | Élevé | La modification après le premier déploiement entraîne la connexion de Vaultwarden à une base de données vide ; toutes les informations d'identification semblent perdues. |
| `cpu_limit` | `1000m` ou plus | Élevé | Cloud Run gen2 avec CPU toujours alloué rejette les valeurs inférieures à `1000m` au moment du déploiement. |
| `container_port` | `80` | Élevé | Doit correspondre à `ROCKET_PORT` ; une non-concordance signifie que les vérifications de santé de Cloud Run échouent et que toutes les requêtes expirent. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne prend pas en charge le chemin de socket Unix utilisé par le proxy d'authentification Cloud SQL, ce qui entraîne des échecs de connexion à la base de données au démarrage. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro rend un gestionnaire de mots de passe indisponible pendant 5 à 15 s au démarrage à froid ; les clients Bitwarden affichent des erreurs de connexion. |
| `cpu_always_allocated` | `false` sauf si push WS activé | Moyen | Laisser `false` activé alors que le serveur de notifications push WebSocket est activé bride le CPU entre les requêtes et rompt la connexion WS persistante ; passer à `true` dans ce cas. |
| `enable_cloud_armor` | activer pour la production | Moyen | Sans Cloud Armor, le point de terminaison de connexion de Vaultwarden est ouvert aux attaques par force brute depuis Internet. |
| `enable_cdn` | `false` ou avec contrôles de cache | Moyen | La mise en cache des réponses API authentifiées divulgue les données du coffre-fort entre les utilisateurs. |
| `backup_retention_days` | `30` (augmenter pour la production) | Moyen | Un gestionnaire de mots de passe sans rétention adéquate signifie une perte d'informations d'identification en cas de défaillance de la base de données. |
| `enable_iap` avec clients natifs | utiliser avec prudence | Moyen | IAP nécessite OAuth basé sur un navigateur ; les clients Bitwarden natifs ne peuvent pas compléter le flux IAP. |
| `smtp_*` variables d'environnement | configurer comme un ensemble complet | Élevé | Une configuration SMTP partielle entraîne des échecs de livraison d'e-mails silencieux — les codes de récupération 2FA et les e-mails d'invitation ne sont jamais envoyés. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Vaultwarden
partagée avec la variante GKE est décrite dans
**[Vaultwarden_Common](Vaultwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Vaultwarden sur Cloud Run](../labs/Vaultwarden_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Vaultwarden sur GKE Autopilot](Vaultwarden_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vaultwarden Common — Configuration d'application partagée](Vaultwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md), [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Communications d'équipe sécurisées**.
