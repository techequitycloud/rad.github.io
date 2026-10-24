---
title: "Speedtest Tracker sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Speedtest Tracker sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SpeedtestTracker_GKE.md @ 1665a43e sha256:556e81071158 -->

# Speedtest Tracker sur GKE Autopilot {#speedtest-tracker-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SpeedtestTracker_GKE.png" alt="Speedtest Tracker sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Speedtest Tracker est un outil gratuit et open source de surveillance de la
vitesse d'Internet, auto-hébergé et basé sur Laravel (PHP). Il exécute des
tests de vitesse Ookla selon un calendrier récurrent, stocke les résultats dans
une base de données et les présente sous forme de graphiques historiques via un
tableau de bord web et une API REST. Ce module déploie Speedtest Tracker sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Speedtest Tracker et
sur la manière de les explorer et de les opérer depuis la console Google Cloud
et la ligne de commande. Pour les mécanismes communs à chaque application GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte Speedtest Tracker sur RAD, et comment cela se compare {#what-speedtest-tracker-costs-on-rad-and-how-that-compares}

**L'exécution de Speedtest Tracker dans votre propre projet GCP coûte environ 93,10 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide Cloud Run pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~93,10 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~87 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre chaque application GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **93,10 $** |

### Comment cela se compare {#how-it-compares}

- L'empreinte propre de Speedtest Tracker ici (1x vCPU / 1 GiB) est plus petite
  que cette classe de référence, donc un niveau de VPS encore moins cher ferait
  tout aussi bien, mais dimensionné à la plus petite classe couramment citée
  pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**,
  un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP
  Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus
  le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité
  et les mises à niveau, que Cloud SQL géré, Secret Manager et la surveillance
  de RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre
  un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite
  encore.
- Speedtest Tracker exécute des tests planifiés à l'aide d'un minuteur plutôt
  que de servir un trafic continu, il est donc à noter que ce module nécessite
  `alwaysOn` de calcul pour maintenir le calendrier actif sur Cloud Run, c'est
  pourquoi il est la cible la plus coûteuse des deux ici malgré la charge de
  travail légère.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré
par RAD commence par dissocier sa facturation, puis demande à Google de
supprimer purement et simplement le projet — la suppression logicielle
récupérable de 30 jours de Google. Contrairement à la suppression d'un seul
module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une
par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD
gère uniquement pour la facturation), vous devez le restaurer vous-même dans
les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits
pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo).
Google indique que la plupart des services fonctionnent à nouveau pleinement
dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Speedtest
Tracker purement et simplement et de le redéployer plus tard. Un redéploiement
coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits
de temps de build.

La suppression ne permet d'économiser de l'argent que si Speedtest Tracker
devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement
par rapport à son propre coût d'exécution quotidien — par rapport au total du
projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du
coût d'exécution ici est généralement la base de données ; elle ne s'arrête que
lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette
application pendant que quelque chose d'autre partage le projet n'économise que
la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont conservées,
  afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ;
https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les
mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Speedtest Tracker s'exécute comme une charge de travail web PHP sur GKE
Autopilot. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP (LinuxServer), 1 vCPU / 1 GiB par défaut, réplica unique |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — ce module fixe MySQL ; le défaut SQLite de l'image amont est contourné |
| Cache et sessions | Redis (optionnel) | Désactivé par défaut ; Speedtest Tracker utilise le pilote de cache local fichier/sync |
| Secrets | Secret Manager | Clé Laravel `APP_KEY` auto-générée ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé + certificat géré + IP statique par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`database_type` se résout en `MYSQL_8_0`) ;
  PostgreSQL n'est pas pris en charge.
- **L'image `linuxserver/speedtest-tracker` pré-construite est utilisée directement.** Il n'y a
  pas de Cloud Build personnalisé ; l'image officielle LinuxServer.io est mise
  en miroir dans Artifact Registry (`enable_image_mirroring = true`) et déployée telle quelle.
  Repli : `ghcr.io/alexjustesen/speedtest-tracker` (basé sur Alpine) si un runtime spécifique
  s'avère incompatible avec l'image s6-overlay de LinuxServer.
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **Un seul réplica est maintenu** (`min_instance_count = 1`, `max_instance_count = 1` ; GKE n'a
  pas de mise à l'échelle à zéro). C'est une charge portante, pas seulement une
  valeur par défaut de coût — le planificateur Laravel `SPEEDTEST_SCHEDULE` n'a pas de
  verrouillage inter-pods, donc plus d'un réplica risque de déclencher des tests
  de vitesse planifiés en double.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application
  Laravel est générée une fois et stockée dans Secret Manager ; la faire
  tourner rend toutes les valeurs chiffrées de la base de données
  indéchiffrables.
- **L'image exécute `php artisan migrate --force` automatiquement au démarrage**, de sorte que le
  schéma est créé au premier démarrage après que `db-init` ait provisionné la
  base de données et l'utilisateur — il n'y a pas de tâche de migration
  distincte.
- **Pas de stockage par défaut.** Speedtest Tracker stocke tous les résultats et
  la configuration dans Cloud SQL — `create_cloud_storage` et `enable_nfs` sont
  désactivés par défaut.
- **GKE se connecte à Cloud SQL via le sidecar Auth Proxy** sur `127.0.0.1:3306`
  (`enable_cloudsql_volume = true`), et le câblage GKE remplace `DB_HOST = "127.0.0.1"`.
- **Un domaine personnalisé, un certificat géré et une IP statique réservée
  sont activés par défaut** (`enable_custom_domain = true`, `reserve_static_ip = true`), avec
  `session_affinity = "ClientIP"`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Speedtest Tracker {#a-gke-autopilot--the-speedtest-tracker-workload}

Le pod de Speedtest Tracker est planifié sur Autopilot, qui facture le CPU/la
mémoire réellement demandés par le pod. La charge de travail s'exécute en tant
que déploiement à réplica unique afin que le planificateur cron intégré ne
s'exécute jamais simultanément sur plusieurs pods.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Speedtest Tracker pour voir les pods, les révisions et les
  événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy/<service-name> -n "$NAMESPACE"    # strategy, events
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle
et le type de charge de travail (Déploiement vs StatefulSet) sont gérés.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Speedtest Tracker stocke tous les résultats des tests de vitesse et la
configuration de l'application dans une instance gérée de Cloud SQL pour MySQL
8.0. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:3306` (`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée. Lors du
premier déploiement, un Job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=speedtesttracker --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Redis (cache et sessions optionnels) {#c-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; Speedtest Tracker utilise
ses pilotes de cache et de session locaux basés sur des fichiers/synchronisation,
ce qui convient pour un déploiement à réplica unique. Lorsque `enable_redis = true` est
défini, la couche partagée injecte `REDIS_HOST` et `REDIS_PORT`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the DB/schedule wiring injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|REDIS_|SPEEDTEST_'
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : la **clé d'application Laravel `APP_KEY`** (`base64:<44-char base64>`),
utilisée pour chiffrer toutes les données d'application que Speedtest Tracker
stocke chiffrées. Le mot de passe de la base de données est géré séparément par
la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing avec un domaine personnalisé et un certificat géré par Google
(`enable_custom_domain = true`), et une IP statique est réservée (`reserve_static_ip = true`) afin
que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Speedtest Tracker {#3-speedtest-tracker-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il
  détecte le socket Cloud SQL ou le point de terminaison TCP, attend que MySQL
  soit accessible, crée la base de données et l'utilisateur de l'application,
  accorde les privilèges, vérifie que l'utilisateur de l'application peut se
  connecter et arrête gracieusement le sidecar Cloud SQL Auth Proxy. Le job est
  idempotent et peut être réexécuté en toute sécurité (`max_retries = 3`).
- **Auto-migration du schéma au démarrage.** L'image LinuxServer Speedtest
  Tracker exécute `php artisan migrate --force` automatiquement à chaque démarrage du
  conteneur, de sorte que le schéma est créé au premier démarrage et mis à jour
  lors des démarrages ultérieurs — il n'y a **pas de job de migration
  distinct**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application
  Laravel est générée une fois et écrite dans Secret Manager. La faire tourner
  rend toutes les valeurs chiffrées de la base de données
  indéchiffrables de manière permanente. Ne la faites tourner que pendant une
  fenêtre de maintenance planifiée avec un plan de rechiffrement.
- **Planificateur cron intégré.** `SPEEDTEST_SCHEDULE` (par défaut `"0 * * * *"`,
  toutes les heures) pilote le propre planificateur Laravel de Speedtest
  Tracker pour exécuter des tests de vitesse automatisés. Contrairement à Cloud
  Run, les pods GKE s'exécutent en continu (pas de problème de mise à l'échelle
  à zéro), de sorte que cela se déclenche de manière fiable tant que le pod
  unique est en cours d'exécution.
- **Élagage des résultats.** `PRUNE_RESULTS_OLDER_THAN` (par défaut `"0"`,
  désactivé) supprime automatiquement les résultats des tests de vitesse
  datant de plus du nombre de jours configuré.
- **Chemin de santé.** La sonde de vivacité cible `/api/healthcheck` par défaut — le
  point de terminaison de santé JSON non authentifié de Speedtest Tracker. La
  sonde de démarrage est une vérification TCP. Prévoyez une fenêtre généreuse
  pour le premier démarrage (délai initial de 30 secondes, seuil d'échec élevé)
  pour les migrations automatiques.
- **Configuration initiale.** L'interface web de Speedtest Tracker guide la
  création de compte lors de la première visite — il n'y a pas de compte
  administrateur par défaut pré-rempli à modifier.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Speedtest Tracker sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `speedtesttracker` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Speedtest Tracker` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Speedtest Tracker — automated internet speed test monitoring and history on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag d'image `linuxserver/speedtest-tracker` ; épingler (par exemple `version-v1.6.3`) en production. |
| `speedtest_schedule` | `0 * * * *` | Expression Cron pour le calendrier des tests de vitesse automatisés. |
| `prune_results_older_than` | `0` | Nombre de jours après lesquels les anciens résultats sont élagués ; `0` désactive l'élagage. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déployer l'image LinuxServer mise en miroir directement — pas de build personnalisé. |
| `container_image` | `""` | Remplacer la référence de l'image ; laisser vide pour utiliser la valeur par défaut mise en miroir. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LinuxServer dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenir à 1. |
| `max_instance_count` | `1` | Réplicas maximum. Ne pas augmenter tant que `speedtest_schedule` est défini — risque de tests de vitesse planifiés en double. |
| `container_port` | `80` | Speedtest Tracker écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | Mémoire par pod. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (`127.0.0.1:3306`) ; requis sur GKE. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `DISPLAY_TIMEZONE`, `SPEEDTEST_SERVERS`). Ne pas définir `APP_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout en `Deployment` (par défaut). |
| `session_affinity` | `ClientIP` | Le routage persistant maintient la session UI d'un client sur un seul pod. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Non nécessaire — Speedtest Tracker n'a pas d'exigence de stockage par bloc par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod (si activé). |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Quota CPU. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Quota mémoire — utiliser des unités binaires (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Quotas de nombre d'objets. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, chemin `/api/healthcheck`, 30s | Sonde de démarrage (vérification d'écoute de port). |
| `liveness_probe` | HTTP `/api/healthcheck`, délai 300s | Sonde de vivacité contre le point de terminaison de santé non authentifié de Speedtest Tracker. |
| `startup_probe_config` / `health_check_config` | Sondes de niveau App_GKE | Sondes de niveau infrastructure. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Pour les tâches de maintenance non liées — le propre calendrier de tests de vitesse de Speedtest Tracker s'exécute en interne via `SPEEDTEST_SCHEDULE`. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Speedtest Tracker. |

### Groupe 12 — CI/CD et autorisation binaire {#group-12--cicd--binary-authorization}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis par défaut — tout l'état réside dans Cloud SQL. |
| `nfs_mount_path` | `/config` | Chemin de montage si NFS est activé (par exemple pour les certificats personnalisés). |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Découverte/nommage du serveur NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer tous les buckets déclarés dans `storage_buckets` (vide par défaut). |
| `storage_buckets` | `[]` | Buckets GCS à provisionner. Non nécessaire par défaut. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images Artifact Registry récentes à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 15 — Cache et sessions Redis {#group-15--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecter `REDIS_HOST`/`REDIS_PORT` afin que Speedtest Tracker puisse utiliser Redis pour le cache/les sessions. Non requis par défaut. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Fixe — Speedtest Tracker nécessite MySQL 8.0 dans ce module. |
| `application_database_name` | `speedtesttracker` | Nom de la base de données MySQL (préfixé par le locataire). Immuable après le premier déploiement. |
| `application_database_user` | `speedtesttracker` | Utilisateur de la base de données de l'application (préfixé par le locataire). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod (pertinent uniquement si `enable_nfs = true`). |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Speedtest Tracker. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Speedtest Tracker. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnels). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un réplica
> en lecture sans son primaire, IAP sans identités autorisées, un runtime
> `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas au moteur requis par Speedtest Tracker, un `redis_port`/`backup_retention_days`
> hors de portée. Ce module valide en outre que `max_instance_count <= 1` chaque fois que
> `speedtest_schedule` est défini. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute
> ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-générée) | Ne jamais faire tourner après le premier démarrage | Critique | La faire tourner rend toutes les valeurs chiffrées de la base de données indéchiffrables de manière permanente. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `database_type` | `MYSQL_8_0` | Critique | Speedtest Tracker nécessite MySQL dans ce module ; tout autre moteur empêche le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 avec un `speedtest_schedule` actif risque de déclencher des tests de vitesse en double sur le même tick de planification — le planificateur Laravel n'a pas de verrouillage inter-pods. |
| `memory_limit` | `1Gi` | Élevé | Des valeurs plus faibles risquent des arrêts OOM pendant les migrations ou l'utilisation concurrente du tableau de bord. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité MySQL sur GKE ; sa désactivation est bloquée par une protection de validation au moment de la planification. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; maintenir 1 permet également au planificateur cron de fonctionner en continu. |
| Chemin `liveness_probe` | `/api/healthcheck` (par défaut) | Moyen | Pointer la sonde vers tout autre chemin ne renvoie jamais un état sain — `/api/healthcheck` est le point de terminaison de santé JSON non authentifié de Speedtest Tracker. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | Élevé | IAP bloque tout accès anonyme. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Speedtest
Tracker partagée avec la variante Cloud Run est décrite dans
**[SpeedtestTracker_Common](SpeedtestTracker_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Speedtest Tracker sur GKE Autopilot](../labs/SpeedtestTracker_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Speedtest Tracker sur Google Cloud Run](SpeedtestTracker_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Speedtest Tracker Common — Configuration d'application partagée](SpeedtestTracker_Common.md) — la configuration partagée par les deux cibles de déploiement.
