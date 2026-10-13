---
title: "Kestra sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Kestra sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kestra_CloudRun.md @ e69407af sha256:5a806f06fe32 -->

# Kestra sur Google Cloud Run {#kestra-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kestra_CloudRun.png" alt="Kestra sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kestra est une plateforme d'orchestration de données open source (Apache 2.0) pour la
création, la planification et la surveillance de pipelines ETL/ELT, de jobs par lots et
d'automatisation de workflows via des définitions de flux déclaratives basées sur YAML et
un écosystème de plus de 500 plugins. Ce module déploie Kestra sur **Cloud Run v2** en
mode autonome, sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Kestra et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Kestra sur RAD, et comment cela se compare {#what-kestra-costs-on-rad-and-how-that-compares}

**Le module Kestra sur Cloud Run de RAD coûte environ 167 $ US par mois dans votre propre projet, plus des frais de module de 175 crédits (18 $ US) une fois par déploiement — le coût de fonctionnement le plus élevé de ce groupe, car son ordonnanceur en mode autonome a besoin d'un CPU alloué en continu et ne peut pas se mettre à l'échelle à zéro.** Si vous n'exécutez des pipelines que selon un calendrier plutôt que de manière continue, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre vos définitions de flux. Kestra est également disponible en tant que module GKE, et ici le schéma habituel s'inverse : GKE est l'option la moins chère (environ 136 $ US/mois), car la facturation des pods de GKE Autopilot convient mieux à une charge de travail toujours active que le CPU toujours alloué de Cloud Run — dans un projet géré par RAD, l'équilibre s'inverse, car le tarif journalier de 77 crédits de Cloud Run est inférieur aux 110 de GKE. Consultez le guide GKE si vous payez Google directement ; restez sur Cloud Run si RAD gère le projet pour vous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **167,44 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **77 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US en recharge unique, moins sur un plan. Dans un projet géré par
RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les
applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base
de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2 vCPU / 4 GiB (alwaysOn) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 167,44 $ US** |

### Comment cela se compare {#how-it-compares}

- Les offres commerciales de Kestra — Kestra Cloud et Kestra Enterprise Edition — ne
  publient pas de prix mensuel ; les deux pages vous demandent de contacter les ventes, nous
  ne citons donc pas un chiffre que nous n'avons pas pu vérifier.
- L'empreinte de Kestra (2 vCPU, 4 GiB, serveur en mode autonome, plus une base de données
  PostgreSQL) se situe au-dessus d'un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go
  (environ 24 $/mois) et plus proche d'un GCP Compute Engine e2-standard-2 (environ 49
  $/mois) — moins cher en espèces dans les deux cas, mais vous exécutez alors
  l'orchestrateur, PostgreSQL, les sauvegardes et les mises à niveau vous-même, sur un
  système dont d'autres pipelines dépendent pour rester opérationnels.
- RAD vous offre deux façons de l'exécuter qui coûtent différemment pour la même raison : le
  mode autonome de Cloud Run a besoin d'un CPU alloué en continu pour exécuter son propre
  ordonnanceur, il ne peut donc pas se mettre à l'échelle à zéro comme le font les autres
  modules, tandis que la facturation des pods de GKE Autopilot est inférieure pour une
  charge de travail toujours active comme celle-ci.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kestra s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir
— une pause entre les cours, une accalmie saisonnière, ou simplement ne pas savoir si vous
en aurez besoin le mois prochain — c'est la meilleure option, et elle ne coûte presque rien.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
de supprimer purement et simplement le projet : la suppression logique récupérable de 30
jours de Google. Contrairement à la suppression de Kestra en tant que module unique, cela
ne démantèle pas le service Cloud Run/GKE, la base de données Cloud SQL et le réseau un par
un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend,
car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu.
Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources
déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que
la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google
le supprime définitivement — et la restauration est admise comme la création d'un nouveau
projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du
niveau (100 crédits pour le niveau sandbox que la plupart utilisent conviennent). Google
déclare que la plupart des services sont à nouveau pleinement opérationnels dans les 36
heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur
du projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée,
il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le
projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de Kestra couvre
sa base de données (définitions de flux, historique d'exécution) ; copiez-la d'abord si
vous voulez un instantané restaurable au-delà des 30 jours du projet.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la
solution de repli consiste à supprimer Kestra purement et simplement et à le redéployer
plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds —
  environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si
  Kestra devait rester inutilisé pendant environ 3 jours ou plus dans votre propre projet
  (environ 2 jours ou plus dans un projet géré par RAD). Le service Cloud Run toujours actif
  et la base de données représentent la majeure partie du coût de fonctionnement ici, donc la
  suppression de Kestra seul permet d'économiser toute la facture ci-dessus, à moins que
  quelque chose d'autre dans le projet ne partage la base de données.
- **Conservez les données en premier.** Les sauvegardes nocturnes sont écrites dans un
  bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la
  dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la
  supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement
  avec le client. Si le portefeuille est faible, la facturation est suspendue et les données
  sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
  et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de
vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Kestra s'exécute en tant que conteneur Java/JVM sur Cloud Run v2 en mode autonome (serveur,
worker et ordonnanceur dans un seul conteneur). Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Java/JVM, 2 vCPU / 4 GiB par défaut, mode autonome à instance unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — stocke la file d'attente, le référentiel et l'historique d'exécution |
| Stockage d'objets | Cloud Storage | Bucket GCS dédié pour les flux, les exécutions et les artefacts |
| Secrets | Secret Manager | Mot de passe administrateur Kestra et mot de passe de base de données auto-générés |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Kestra utilise PostgreSQL pour sa file d'attente
  interne et son référentiel de flux. MySQL n'est pas pris en charge.
- **Le mode autonome exécute tous les composants dans un seul conteneur.** Conservez `max_instance_count = 1`
  pour éviter les conflits d'état de verrouillage de file d'attente entre les instances.
- **Le démarrage à froid de la JVM Java est lent.** La sonde de démarrage par défaut
  autorise jusqu'à environ 14 minutes. Conservez `min_instance_count = 1` en production afin que les
  déclencheurs planifiés ne soient jamais manqués.
- **Redis n'est pas utilisé.** Kestra utilise PostgreSQL pour la mise en file d'attente en
  mode autonome.
- **Un pont de socket Unix est intégré.** Le proxy d'authentification Cloud SQL crée un
  socket Unix, mais Java JDBC ne peut pas se connecter via des sockets Unix nativement. Le
  `entrypoint.sh` personnalisé utilise `socat` pour relier le socket au TCP `127.0.0.1:5432` de manière
  transparente.
- **Le mot de passe administrateur est auto-généré** et stocké dans Secret Manager ; il
  n'est jamais défini en texte clair.
- **Un bucket de stockage GCS est toujours provisionné** pour les flux, les exécutions et
  les artefacts ; son nom est injecté automatiquement en tant que `KESTRA_STORAGE_GCS_BUCKET`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de
ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Kestra {#a-cloud-run--the-kestra-service}

Kestra s'exécute en tant que service Cloud Run v2. Étant donné que le mode autonome de
Kestra combine le serveur, le worker et l'ordonnanceur en un seul processus, il s'exécute
en tant qu'instance unique de longue durée. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Kestra stocke tout l'état du workflow — définitions de flux, historique d'exécution,
déclencheurs, espaces de noms et file d'attente de tâches interne — dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Le service se connecte via le **proxy d'authentification Cloud
SQL** sur un socket Unix ; le `entrypoint.sh` relie ce socket au TCP afin que le pilote JDBC Java
puisse se connecter (aucune IP publique n'est exposée). Lors du premier déploiement, un job
d'initialisation crée la base de données Kestra, l'utilisateur et accorde les privilèges
requis.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné pour le backend de stockage d'artefacts
GCS de Kestra. Toutes les exécutions de flux, les entrées/sorties de tâches et les objets de
stockage internes y sont écrits. Le nom du bucket est injecté dans chaque instance en tant
que `KESTRA_STORAGE_GCS_BUCKET`. Des buckets supplémentaires ou des volumes GCS Fuse (nécessite
l'environnement d'exécution `gen2`) peuvent être montés pour l'accès aux données de flux.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<kestra-storage-bucket>/        # bucket name in Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur Kestra et le mot de passe de la base de données sont stockés
dans Secret Manager et injectés dans le service au moment de l'exécution. Le texte clair
n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Le secret du mot de passe administrateur est nommé `<resource_prefix>-admin-password`. Le nom du secret du mot de
passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les
paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont acheminées vers Cloud Monitoring. Les sondes de santé ciblent le point de
terminaison `/health` de Kestra. Des vérifications de disponibilité et des politiques
d'alerte facultatives sont disponibles (la vérification de disponibilité est désactivée par
défaut — activez-la pour la surveillance en production).

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Kestra {#3-kestra-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job
  d'initialisation (`db-init`) utilise `postgres:15-alpine` pour se connecter via le proxy
  d'authentification Cloud SQL et crée de manière idempotente la base de données et
  l'utilisateur Kestra, accorde les privilèges et réinitialise le schéma public afin que
  Flyway puisse appliquer toutes les migrations proprement sur une nouvelle instance Cloud
  SQL. Le job signale au proxy de s'arrêter proprement une fois terminé.
- **Migrations Flyway au démarrage.** Kestra exécute des migrations de schéma basées sur
  Flyway à chaque démarrage. Le paramètre `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true` empêche les échecs sur Cloud SQL, qui
  pré-remplit le schéma public avec des objets d'extension. La mise à niveau du `application_version`
  applique automatiquement les modifications de schéma.
- **Pont socket Unix vers TCP.** Le proxy d'authentification Cloud SQL de Cloud Run crée un
  socket Unix à `${DB_HOST}/.s.PGSQL.5432`. Java JDBC ne peut pas se connecter via un socket Unix
  nativement. Le `entrypoint.sh` personnalisé détecte ce socket, crée un lien symbolique à
  `/tmp/cloudsql.sock` (pour éviter les problèmes de séparateur de deux-points) et démarre un pont
  `socat` qui transmet le TCP `127.0.0.1:5432` au socket. Les variables JDBC `DATASOURCES_POSTGRES_URL`, `DATASOURCES_POSTGRES_USERNAME` et
  `DATASOURCES_POSTGRES_PASSWORD` sont ensuite assemblées à partir des variables d'environnement `DB_*` injectées
  par la plateforme avant le lancement de Kestra.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /health` sur le port 8080. La sonde de démarrage par défaut autorise jusqu'à environ 14
  minutes pour le démarrage de la JVM. La sonde de démarrage au niveau de l'infrastructure
  est TCP (pas de chemin), donnant à la couche de routage de Cloud Run un simple signal de
  vivacité avant que la sonde d'application ne prenne le relais.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  `admin`. Le mot de passe est récupéré de Secret Manager (voir §2.D).
- **Déclencheurs planifiés.** L'ordonnanceur interne de Kestra traite les déclencheurs
  définis par le flux (cron, intervalle, webhook). `min_instance_count = 1` garantit qu'une instance chaude
  est toujours disponible. La mise à l'échelle à zéro (`0`) entraîne des fenêtres de
  déclenchement manquées pendant les périodes de démarrage à froid.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Kestra sont listés ; toutes
les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
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
| `application_name` | `kestra` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Kestra ; incrémenter pour déployer une nouvelle version (par exemple `0.17.0`). |
| `display_name` | `Kestra Data Orchestration` | Nom convivial affiché dans la console et l'interface utilisateur de la plateforme. |
| `description` | `Kestra Data Orchestration - ETL/ELT pipeline and workflow orchestration on Cloud Run` | Description du service Cloud Run. |
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU minimum recommandés pour la JVM Kestra. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés (minimum 2 GiB). |
| `container_port` | `8080` | Port du serveur Kestra/Micronaut. Doit correspondre à `MICRONAUT_SERVER_PORT`. |
| `min_instance_count` | `1` | Instances minimales. Garder ≥ 1 pour que les déclencheurs planifiés ne soient jamais manqués. |
| `max_instance_count` | `1` | Instances maximales. Garder à 1 pour le mode autonome afin d'éviter les conflits de file d'attente. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes. |
| `execution_environment` | `gen2` | `gen2` est requis pour les montages de volume GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Sidecar du proxy d'authentification Cloud SQL — requis pour le pont JDBC de socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Kestra dans Artifact Registry avant le déploiement. |
| `cpu_always_allocated` | `true` | Maintenir le CPU alloué en permanence (recommandé pour l'ordonnanceur Kestra). |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service : `all`, `internal` ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `traffic_split` | `[]` | Allocation de trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Kestra de base sont injectées automatiquement ; ne les écrasez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret (0–300). |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — NFS et SQL personnalisé {#group-9--nfs--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionner un partage Cloud Filestore (NFS) et le monter dans le service. Nécessite `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge HTTPS externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend HTTPS LB. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage {#group-11--storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires dans `storage_buckets`. Le bucket de stockage Kestra est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de stockage intégré. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `kestra` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `kestra` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_type` | `POSTGRES_15` | Moteur Cloud SQL. Kestra nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_cloudsql_volume` | `true` | Requis pour le pont JDBC de socket Unix. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Fournir une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés à côté du service Kestra principal. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai 30s, période 20s, 40 échecs | Sonde de démarrage de l'application — autorise jusqu'à ~14 minutes pour le démarrage de la JVM. |
| `liveness_probe` | HTTP `/health`, délai 180s, période 30s, 5 échecs | Sonde de vivacité de l'application. |
| `startup_probe_config` | TCP, pas de chemin | Sonde de démarrage au niveau de l'infrastructure (ne suit pas les redirections HTTP). |
| `uptime_check_config` | désactivé, chemin `/health` | Vérification de disponibilité de Cloud Monitoring. Activer pour la surveillance en production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket de stockage Kestra). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `db_name` | `kestra` — défini une fois | Critique | Immuable après le premier déploiement ; le modifier connecte Kestra à une base de données vide, perdant tous les flux, l'historique d'exécution, les déclencheurs et les espaces de noms. |
| `application_name` | `kestra` — défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP, entraînant une recréation complète avec perte de données. |
| `KESTRA_BASICAUTH_ENABLED` (injecté `true`) | laisser tel quel | Critique | Le remplacer par `false` expose l'interface utilisateur et l'API REST complètes de Kestra sans authentification. Ne désactiver que derrière un proxy d'authentification fiable (IAP, Cloud Armor). |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `max_instance_count` | `1` | Élevé | Plusieurs instances provoquent des conflits de verrouillage de file d'attente PostgreSQL et une double affectation de tâches dans l'édition communautaire. |
| `min_instance_count` | `1` | Élevé | Le définir à `0` entraîne des déclencheurs planifiés manqués pendant les périodes de démarrage à froid. |
| `memory_limit` | `4Gi` | Élevé | Des valeurs inférieures à 2 GiB provoquent des erreurs OutOfMemoryErrors de la JVM sous une charge d'exécution concurrente. |
| `enable_cloudsql_volume` | `true` | Élevé | Requis pour le pont JDBC de socket Unix ; sans lui, le pont de socket `entrypoint.sh` n'a pas de socket à relier. |
| `KESTRA_QUEUE_TYPE` / `KESTRA_REPOSITORY_TYPE` (injecté `postgres`) | laisser tel quel | Élevé | Seul PostgreSQL est provisionné ; le remplacer par un backend non pris en charge entraîne un échec de démarrage. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS et GCS Fuse nécessitent gen2 ; le modifier en `gen1` entraîne des échecs de montage. |
| Seuil d'échec `startup_probe` | 40 (par défaut) | Élevé | Le réduire en dessous de ~10 provoque des redémarrages prématurés lors d'un démarrage lent de la JVM avant que Kestra n'ait fini de charger. |
| `ENDPOINTS_ALL_PORT` (injecté `8080`) | laisser tel quel | Élevé | Le remplacement de ce port interrompt les vérifications de santé de Cloud Run, entraînant des redémarrages continus du conteneur. |
| `min_instance_count` | `1` | Moyen | Le définir à `0` ajoute une latence de démarrage à froid et risque de manquer des travaux planifiés. |
| `ingress_settings` | `all` (ou LB-only pour la production) | Moyen | Le définir à `internal` bloque tous les déclencheurs de webhook externes et les appels d'API depuis l'extérieur du VPC. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur et l'API Kestra sont autrement accessibles publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour les exigences de rétention de conformité. |
| `organization_id` | définir lors de l'utilisation de VPC-SC | Moyen | Si vide, les contrôles de service VPC sont ignorés silencieusement. |

### Destruction des ressources — délai connu du sous-réseau Cloud Run {#destroying-resources--known-cloud-run-subnet-delay}

Lors de la destruction de ce déploiement, vous pouvez rencontrer :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es)
on subnet ... are still in use.
```

GCP conserve les adresses IPv4 sans serveur de manière asynchrone après la suppression du
service Cloud Run. Attendez 20 à 30 minutes après la tentative de destruction initiale et
réexécutez la commande de destruction ; elle réussira une fois que GCP aura libéré les
adresses réservées.

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Kestra
partagée avec la variante GKE est décrite dans **[Kestra_Common](Kestra_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Kestra sur Cloud Run](../labs/Kestra_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kestra sur GKE Autopilot](Kestra_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Kestra Common — Configuration d'application partagée](Kestra_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Windmill sur Google Cloud Run](Windmill_CloudRun.md), [Temporal sur GKE Autopilot](Temporal_GKE.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) dans la solution **Orchestration de données et de workflows**.
