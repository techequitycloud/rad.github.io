---
title: "Wallabag sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Wallabag sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wallabag_CloudRun.md @ e69407af sha256:31df927be9b8 -->

# Wallabag sur Google Cloud Run {#wallabag-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallabag_CloudRun.png" alt="Wallabag sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallabag est une application gratuite, open-source et auto-hébergée d'archivage
d'articles "lire plus tard" — une alternative à Pocket. Enregistrez des
articles depuis une extension de navigateur, un bookmarklet, une application
mobile ou l'API REST, puis lisez-les plus tard dans une vue propre et sans
distraction avec recherche en texte intégral, étiquetage, annotations et flux
RSS de vos éléments enregistrés. Ce module déploie Wallabag sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Wallabag et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Wallabag sur RAD, et comment cela se compare {#what-wallabag-costs-on-rad-and-how-that-compares}

**L'exécution de Wallabag sur Cloud Run dans votre propre projet Google Cloud
coûte environ 70,19 US$/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 75 crédits (7,50 US$) facturé une fois au moment du
déploiement. Wallabag est un archiveur d'articles "lire plus tard" auto-hébergé,
et sa base de données MySQL gérée représente la majeure partie de ce coût
d'exécution. Dans un projet géré par RAD, les frais de module tombent à 67,5
crédits (10 % de moins) — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous — ou consultez le [guide GKE](Wallabag_GKE.md) si vous préférez
l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 70,19 US$/mois, facturé par Google au prix catalogue | ~26 crédits/jour (environ 780/mois, 78 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un abonnement
mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **70,19 US$** |

### Comment cela se compare {#how-it-compares}

- Les créateurs de Wallabag vendent leur propre hébergement officiel sur
  **wallabag.it** : les forfaits vont d'environ 11 €/an (environ 1 $/mois)
  jusqu'à un abonnement "heart" de 30 €/an qui ajoute simplement un support de
  projet supplémentaire sur des fonctionnalités identiques — vérifié sur
  wallabag.it, 8 octobre 2026. C'est beaucoup moins cher que le coût
  d'exécution du propre projet de RAD ici, car wallabag.it est un service
  partagé, multi-locataire, conçu pour un usage personnel ; ce n'est pas une
  comparaison équivalente avec un projet dédié et isolé avec votre propre
  instance Cloud SQL et un contrôle total des données.
- Une comparaison de VPS auto-géré, dimensionné aux valeurs par défaut de
  Wallabag (1 vCPU / 2 Gio) : un Hetzner CPX22 ou un DigitalOcean Droplet de 2
  vCPU/4 Go coûte environ 24 $/mois — moins cher en termes monétaires, plus
  votre propre temps pour les sauvegardes et les correctifs MySQL, que Cloud
  SQL et Secret Manager gérés par RAD couvrent pour vous.
- Pour un usage personnel simple, l'hébergement propre de wallabag.it est de
  loin l'option la moins chère ; le cas de RAD ici est un projet dédié — utile
  pour une archive d'équipe, un déploiement de lab en libre-service, ou
  quiconque souhaite que les données ne quittent jamais l'infrastructure qu'il
  contrôle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement
à la suppression d'un seul module, cela ne démantèle **pas** Cloud SQL, aucune
VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Parce que rien n'a été
détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes — c'est une vérification, pas une reconstruction, et une mise à jour
ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée
de crédits (moins de 1 US$) au total pour une chaîne de déploiement typique de
2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le
palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé Wallabag et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources définitivement, et le retour de Wallabag signifie un redéploiement à
partir de zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou
environ 70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Wallabag devait
autrement rester inutilisé suffisamment longtemps pour compenser ce coût de
redéploiement par rapport à son propre coût d'exécution — environ 3 jours ou
plus dans votre propre projet (environ 2,34 US$ par jour), ou environ 3 jours
ou plus dans un projet géré par RAD (26 crédits par jour).

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
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
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ;
[hébergement wallabag.it](https://www.wallabag.it/en).

## 1. Vue d'ensemble {#1-overview}

Wallabag s'exécute en tant que conteneur PHP/Symfony (nginx + php-fpm sous
s6-overlay) sur Cloud Run v2. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Symfony, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Wallabag_Common fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` est provisionné, mais Wallabag ne le lit ni ne l'écrit — tout le contenu réside dans MySQL |
| Secrets | Secret Manager | `APP_SECRET` auto-généré (jeton de sécurité Symfony) ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par
  `Wallabag_Common` ; la sélection de tout autre moteur rompt le déploiement.
- **`enable_cloudsql_volume = false`.** Cloud Run se connecte à Cloud SQL via
  **TCP IP privée**, et non via le socket Unix du proxy d'authentification. La
  variante GKE utilise plutôt le sidecar du proxy d'authentification sur
  `127.0.0.1`.
- **Un seul secret Secret Manager.** `APP_SECRET` (un jeton de sécurité Symfony)
  est généré automatiquement, remplaçant la valeur par défaut intégrée et
  publiquement connue de Wallabag. Il n'y a pas de secret de mot de passe
  administrateur généré séparément.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent de la latence à la première
  requête après l'inactivité ; définissez `min_instance_count = 1` pour éviter cela.
- **`enable_nfs` par défaut `true` mais est fonctionnellement inutilisé.** Il
  monte Cloud Filestore NFS à `/var/lib/wallabag`, mais l'image de Wallabag
  `WORKDIR` est `/var/www/wallabag` — rien n'écrit sur le chemin monté. Sûr à
  désactiver.
- **Pas de job de migration séparé.** Le propre `bin/console wallabag:install` de Wallabag gère
  à la fois la création du schéma et la configuration de première exécution en
  une seule étape idempotente.
- **L'auto-inscription est désactivée.** `SYMFONY__ENV__FOSUSER_REGISTRATION = "false"` — seul le compte
  administrateur amorcé existe jusqu'à ce qu'un opérateur active
  explicitement l'inscription ou crée d'autres comptes.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Wallabag {#a-cloud-run--the-wallabag-service}

Wallabag s'exécute en tant que service Cloud Run v2 qui s'adapte
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

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Wallabag stocke toutes les données de l'application (articles enregistrés,
balises, utilisateurs, annotations) dans une instance Cloud SQL pour MySQL 8.0
gérée. Le service se connecte via l'**IP privée de l'instance via TCP** (pas le
socket du proxy d'authentification — les valeurs par défaut de `enable_cloudsql_volume` de
Cloud Run `false` pour ce module). Lors du premier déploiement, un job
`db-init` crée la base de données et l'utilisateur de l'application, suivi
de `wallabag-install`, qui exécute l'installateur propre de Wallabag pour créer le
schéma.

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
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket générique `data` est provisionné par défaut (via l'entrée
`storage_buckets` de la Fondation), mais Wallabag lui-même ne le lit ni ne l'écrit
jamais — tout le contenu réside dans MySQL, et `gcs_volumes` (qui monterait un
bucket dans le conteneur via fuse) est vide par défaut.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :
`APP_SECRET` (matérialisé sous cette clé simple ; aliasé sur le vrai nom
`SYMFONY__ENV__SECRET` par le point d'entrée du wrapper). Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Wallabag {#3-wallabag-application-behaviour}

- **Chaîne d'initialisation en deux étapes, pas une étape de migration séparée
  à la Laravel.** `db-init` (`mysql:8.0-debian`) crée la base de données et
  l'utilisateur de l'application vides et accorde les privilèges. `wallabag-install`
  dépend ensuite de `db-init` et réutilise la même image d'application
  personnalisée (de sorte que l'alias d'environnement du point d'entrée du
  wrapper s'exécute toujours) avec sa commande remplacée par `bin/console wallabag:install --env=prod -n`.
  Cette commande unique effectue à la fois la création du schéma *et* la
  configuration de première exécution (y compris l'amorçage du compte
  administrateur par défaut) — il n'y a pas de job de migration séparé à
  exécuter lors des mises à niveau ; réexécuter `wallabag:install` sur une base de
  données déjà installée est sûr et idempotent.
- **Comportement de la vérification de santé.** La sonde de démarrage est
  **TCP** sur le port 80 — elle n'a besoin que de nginx pour se lier,
  indépendamment de la progression de l'installateur. La sonde de vivacité est
  **HTTP `GET /`** : une requête non authentifiée vers le chemin racine
  renvoie une **redirection HTTP 302 vers `/login`**, que les
  sémantiques de vérification de santé de Cloud Run et de Kubernetes traitent
  comme une réponse réussie (tout 2xx–3xx). Ne vous attendez pas à un 200 nu
  de `/` — un 302 vers `/login` est le résultat attendu et sain.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
  ```
- **Compte administrateur de première exécution.** `wallabag:install --env=prod -n` crée le
  compte administrateur par défaut de Wallabag en utilisant les valeurs par
  défaut d'installation documentées de Wallabag (nom d'utilisateur et mot de
  passe tous deux `wallabag`) — il n'y a pas de secret Secret Manager
  contenant un mot de passe administrateur généré. **Changez ce mot de passe
  immédiatement après la première connexion** (Paramètres → votre compte →
  changer le mot de passe, ou `bin/console fos:user:change-password wallabag` à l'intérieur du conteneur). Les
  nouveaux comptes ne peuvent pas s'auto-enregistrer (`SYMFONY__ENV__FOSUSER_REGISTRATION
  = "false"`) — créez
  des utilisateurs supplémentaires depuis l'interface d'administration ou avec
  `bin/console
  fos:user:create`.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Wallabag sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallabag` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Wallabag` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image de base pour `wallabag/wallabag`. `"latest"` correspond à un tag épinglé (`2.6.14`) au moment du build via l'ARG de build `WALLABAG_VERSION` spécifique à l'application. |
| `php_memory_limit`, `upload_max_filesize`, `post_max_size` | `512M` / `64M` / `64M` | Déclarées pour la parité de convention mais **non transmises** nulle part — la définition de celles-ci n'a aucun effet sur le conteneur déployé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `"prebuilt"` ignore entièrement le wrapper d'alias de base de données/secret — ne pas utiliser sans votre propre traduction. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `80` | Nginx de Wallabag écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte via TCP IP privée au lieu du socket du proxy d'authentification. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas écraser `SYMFONY__ENV__DATABASE_*` ici — ils sont calculés par le point d'entrée du wrapper au démarrage du conteneur. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
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
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket GCS générique `data`. Non lu ni écrit par Wallabag. |
| `enable_nfs` | `false` | **Fonctionnellement inutilisé** — monté à `/var/lib/wallabag`, mais l'image de Wallabag n'y écrit rien. Sûr à désactiver. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). Vide par défaut — rien n'est monté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Wallabag_Common`. |
| `db_name` / `db_user` | `wallabag` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (tous vides) | **Inutilisé par Wallabag** — le point d'entrée du wrapper lit directement les variables standard `DB_*` et les alias sur `SYMFONY__ENV__DATABASE_*` lui-même. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne intégrée `db-init` → `wallabag-install`. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 80, délai de 30s, 20 tentatives | N'a besoin que de nginx pour se lier. |
| `liveness_probe` | HTTP `GET /`, délai de 300s, 3 tentatives | Wallabag renvoie une redirection 302 vers `/login` — une réponse réussie. |
| `uptime_check_config` | `{ enabled = true }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Purement optionnel — uniquement utilisé par la fonctionnalité d'importation en masse asynchrone de Wallabag (importation Pocket/Instapaper). L'utilisation normale de sauvegarde/lecture/API ne touche jamais Redis. |
| `redis_host` | `""` | Point d'accès Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `wallabag-install`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification.
> Une configuration invalide échoue au **plan** avec une erreur claire et
> nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement du pilote de base de données (`SYMFONY__ENV__DATABASE_DRIVER`, codée en dur dans `entrypoint.sh`) | doit être définie explicitement (`pdo_mysql` ici) | **Critique** | Le `parameters.yml` livré avec Wallabag par défaut `database_driver` à `pdo_sqlite`. Définir uniquement `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` sans variable de pilote explicite installe toujours silencieusement contre un fichier SQLite local jetable — l'installation "réussit", l'application semble fonctionner, mais toutes les données résident dans un fichier éphémère effacé à chaque redémarrage ou redéploiement, et MySQL n'est jamais touché. Aucune erreur n'est levée. **Si ce module est un jour cloné comme modèle pour une autre application basée sur Symfony, vérifiez que la variable d'environnement du pilote de base de données est définie explicitement** — cette classe d'échec est indétectable de l'extérieur ; seule la comparaison des logs de démarrage du conteneur (`"Configuring the SQLite database..."` vs. une ligne de connexion MySQL) la révèle. Voir [App_CloudRun](App_CloudRun.md) et [App_GKE](App_GKE.md) pour savoir comment la Fondation injecte génériquement les variables d'environnement de base de données — la traduction spécifique à l'application et les pièces manquantes sont toujours la responsabilité du module appelant. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les articles enregistrés. |
| `APP_SECRET` (auto-généré) | Ne jamais modifier manuellement dans Secret Manager après le premier démarrage | Élevé | Wallabag l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et toutes les URL signées déjà émises. |
| Identifiants administrateur par défaut (`wallabag` / `wallabag`, amorcés par `wallabag:install`) | Changer immédiatement après la première connexion | Élevé | L'installateur amorce les identifiants par défaut bien connus de Wallabag — toute personne connaissant l'URL du service et la valeur par défaut publique peut se connecter tant que le mot de passe n'est pas modifié. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue au job d'importation. |
| `container_image_source` | `custom` | Critique | Le passage à `prebuilt` déploie l'image standard `wallabag/wallabag` sans point d'entrée de wrapper — l'alias des variables d'environnement de la base de données et des secrets ne s'exécute jamais, de sorte que l'application ne peut pas du tout atteindre MySQL. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `enable_nfs` | `false` sauf si nécessaire pour un autre usage | Faible / coût | Par défaut `true` et provisionne un partage Filestore que Wallabag n'utilise jamais — un coût récurrent inutile. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Wallabag partagée avec la variante GKE est décrite
dans **[Wallabag_Common](Wallabag_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallabag sur Cloud Run](../labs/Wallabag_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de console et les commandes à
  chaque étape.
- [Wallabag sur GKE Autopilot](Wallabag_GKE.md) — la même application sur
  Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Wallabag Common — Configuration d'application partagée](Wallabag_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md),
  [Trilium sur Google Cloud Run](Trilium_CloudRun.md),
  [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md),
  [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution
  **Connaissances personnelles et lecture**.
