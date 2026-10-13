---
title: "NocoDB sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de NocoDB sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/NocoDB_CloudRun.md @ e69407af sha256:05e2a9ff26d5 -->

# NocoDB sur Google Cloud Run {#nocodb-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NocoDB_CloudRun.png" alt="NocoDB sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

NocoDB est une alternative open source à Airtable qui transforme n'importe quelle
base de données en une feuille de calcul intelligente avec une interface sans code,
des API REST et GraphQL, et des automatisations intégrées. Ce module déploie NocoDB
sur **Cloud Run v2** en s'appuyant sur la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par NocoDB et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte NocoDB sur RAD, et comment cela se compare {#what-nocodb-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de NocoDB sur RAD coûte environ 69 US$ par mois, les frais de module étant facturés une seule fois en crédits RAD.** Si vous avez besoin que NocoDB reste opérationnel en permanence, qu'il s'adapte à plusieurs pods ou qu'il fonctionne avec d'autres charges de travail Kubernetes, consultez le [guide GKE](NocoDB_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **NocoDB**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (8 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 3 à 6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **69 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 par mois (environ 78 US$ au prix de la recharge, 62 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 1 GiB (scaleToZero) | 11,58 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 69 US$** |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| Airtable, plan Équipe | 20 $/utilisateur/mois, facturé annuellement | Airtable. Par siège ; ce que NocoDB est conçu pour remplacer |
| Airtable, plan Business | 45 $/utilisateur/mois, facturé annuellement | Airtable |
| NocoDB Cloud, Plus | environ 12-15 $/mois, sièges illimités | Le propre plan hébergé de NocoDB Labs pour le même projet open source |
| NocoDB Cloud, Business | environ 24-30 $/mois, sièges illimités | NocoDB Labs |
| **RAD, Cloud Run, votre propre projet** | **Environ 69 US$**, plus 8 US$ une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 780 crédits (62-78 US$)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](NocoDB_GKE.md) | RAD |

**Airtable facture par siège ; le coût de RAD est l'infrastructure, qui ne croît pas avec les effectifs.** Une équipe de cinq personnes sur le plan Équipe d'Airtable paie 100 $/mois avant tout ajout d'automatisation ; la même équipe sur le propre projet de RAD paie un coût de fonctionnement fixe, quel que soit le nombre de personnes ayant des identifiants. Le prix illimité de NocoDB Cloud est la comparaison la plus pertinente, car il s'agit du même projet open source hébergé par son mainteneur — le chiffre du propre projet de RAD se situe en dessous de son plan Plus et son chiffre géré par RAD se situe près de son plan Business, pour une infrastructure que vous pouvez également inspecter et déplacer à tout moment.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si NocoDB s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à NocoDB dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne supprime pas la base de données ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela coûte environ une poignée de crédits (moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3 éléments.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 69 US$.** Déployez NocoDB, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et le temps pendant lequel NocoDB était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé NocoDB et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 US$) dans votre propre projet, ou 72 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que NocoDB resterait inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 2,29 US$ par jour), ou environ 3 jours ou plus dans un projet géré par RAD (26 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de NocoDB alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient NocoDB dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute NocoDB pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Tarification NocoDB](https://nocodb.com/pricing) ; [Tarification Airtable](https://airtable.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

NocoDB s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | `database_type` n'a aucun effet sur Cloud Run — Postgres 15 est toujours provisionné |
| Stockage d'objets | Cloud Storage | Provisionné, mais non connecté au stockage des pièces jointes de NocoDB (voir ci-dessous) |
| Cache (optionnel) | Redis | Désactivé par défaut ; requis lors de l'exécution de plusieurs instances |
| Secrets | Secret Manager | Secret JWT auto-généré (`NC_AUTH_JWT_SECRET`) et mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app`, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 uniquement, sur Cloud Run.** La variable `database_type` est définie mais
  n'est jamais transmise à `NocoDB_Common` (qui code en dur `POSTGRES_15`), donc la définir
  n'a aucun effet ici — Postgres 15 est provisionné quelle que soit la valeur. MySQL
  8.0 est pris en charge sur `NocoDB_GKE`, où la surcharge équivalente est câblée.
- **NocoDB se connecte via IP privée TCP, pas le socket Auth Proxy.** Le sidecar
  Cloud SQL Auth Proxy est **désactivé** par défaut (`enable_cloudsql_volume = false`)
  car le constructeur d'URL interne de NocoDB rejette les chemins de socket Unix. L'IP
  privée est utilisée directement.
- **NFS est désactivé par défaut.** NocoDB n'a pas de dépendance de système de fichiers
  partagé, mais il n'a pas non plus de backend de pièce jointe Cloud Storage fonctionnel
  prêt à l'emploi (voir §2C) — les pièces jointes utilisent le disque de conteneur local/éphémère
  sauf configuration manuelle.
- **Redis est désactivé par défaut.** Une seule instance s'exécute sans Redis ; activez-le
  avant de passer à l'échelle au-delà d'une instance.
- **`cpu_always_allocated = false` par défaut.** Facturation basée sur les requêtes ; l'automatisation en
  arrière-plan de NocoDB et la logique de nouvelle tentative de webhook ne continuent que
  tant qu'une instance gère une requête. Définissez `true` (avec `min_instance_count ≥ 1`) pour un
  traitement en arrière-plan ininterrompu.
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager. Ne le
  faites pas pivoter après le premier déploiement — toutes les sessions et jetons API
  existants seraient immédiatement invalidés.
- **NocoDB gère ses propres migrations de base de données au premier démarrage.** Aucun
  job d'initialisation externe n'est requis.
- **Les sondes de santé ciblent `/api/v1/health`**, le point de terminaison de santé dédié
  exposé par NocoDB.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service NocoDB {#a-cloud-run--the-nocodb-service}

NocoDB s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la
charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions pour
des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NocoDB stocke toutes les données de l'application (tables, vues, automatisations,
données de ligne) dans une instance gérée Cloud SQL pour PostgreSQL 15. Le service
se connecte via une connexion TCP IP privée (pas d'IP publique, pas de socket Auth
Proxy). Lors du premier déploiement, un job d'initialisation crée la base de données
et l'utilisateur de l'application ; NocoDB exécute ensuite ses propres migrations
de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — provisionné, non connecté aux pièces jointes {#c-cloud-storage--provisioned-not-wired-to-attachments}

La variable `storage_buckets` provisionne un bucket GCS (par défaut `name_suffix =
"data"`) et une
valeur `GCS_BUCKET_NAME` est injectée dans le service en tant que variable d'environnement.
Cependant, le script d'entrée de `NocoDB_Common` ne lit jamais `GCS_BUCKET_NAME` (ou toute
autre variable S3/GCS), et la valeur injectée ne correspond pas au nom d'un bucket
réellement créé par la fondation. NocoDB ne stocke donc **pas** automatiquement les
pièces jointes dans Cloud Storage — les fichiers téléchargés sont écrits sur le disque
de conteneur local/éphémère et sont perdus au redémarrage ou au démarrage à froid. Pour
persister les pièces jointes dans GCS, configurez manuellement les propres paramètres
de stockage compatible S3 de NocoDB (via son interface d'administration ou `environment_variables`)
pointant vers un bucket auquel le compte de service Cloud Run peut accéder.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket provisionné.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/      # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse, CMEK et les options de bucket
supplémentaires.

### D. Cache Redis (optionnel) {#d-redis-cache-optional}

Redis soutient la couche de mise en cache de NocoDB et, dans les déploiements
multi-instances, maintient la cohérence de l'état du cache et de la session. Redis
est désactivé par défaut ; un `redis_host` doit être fourni lorsqu'il est activé.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret JWT de NocoDB (`NC_AUTH_JWT_SECRET`) et le mot de passe de la base de données sont
stockés dans Secret Manager et injectés dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité
optionnels par rapport à `/api/v1/health` et des politiques d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application NocoDB {#3-nocodb-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  (`db-init`) crée la base de données et l'utilisateur NocoDB avant le démarrage du
  service. Il est idempotent.
- **Migrations auto-gérées.** NocoDB exécute ses propres migrations de schéma de base de
  données au démarrage — il n'est pas nécessaire de configurer des jobs de migration externes.
- **Secret JWT.** `NC_AUTH_JWT_SECRET` est généré automatiquement et stocké dans Secret Manager.
  Ne le faites pas pivoter après le premier déploiement ; toutes les sessions et jetons API
  existants sont immédiatement invalidés si le secret change.
- **Les téléchargements GCS ne sont pas automatiques.** Une variable d'environnement `GCS_BUCKET_NAME`
  est injectée, mais le script d'entrée ne la lit jamais et la valeur ne correspond à aucun
  bucket créé par la fondation. Les pièces jointes utilisent le disque de conteneur local/éphémère
  sauf si l'opérateur configure manuellement les propres paramètres de stockage compatible S3 de NocoDB.
- **Variables d'environnement NC_DB_*.** Le Dockerfile personnalisé dans `NocoDB_Common`
  mappe les variables de connexion standard `DB_*` (injectées par la fondation) aux
  noms `NC_DB_*` attendus par NocoDB. Lorsque `container_image_source = "prebuilt"` le mappage n'est pas
  appliqué — configurez les variables `NC_DB_*` manuellement via `environment_variables`.
- **URL publique.** L'URL du service Cloud Run est injectée en tant que `NC_PUBLIC_URL` afin
  que NocoDB génère des URL absolues correctes dans les liens de partage, les notifications
  par e-mail et les rappels de webhook. Contrôlé par `service_url_env_var_name` (par défaut `"NC_PUBLIC_URL"`).
- **Chemin de santé.** Les sondes de disponibilité (readiness) et de vivacité (liveness) ciblent
  `/api/v1/health`, qui renvoie HTTP 200 lorsque NocoDB est prêt à accepter les requêtes.
- **Sessions multi-instances.** Avec plus d'une instance et sans Redis, NocoDB ne peut pas
  partager l'état de la session ou du cache ; les utilisateurs peuvent être déconnectés lorsque
  les requêtes sont acheminées vers une instance différente. Activez Redis et définissez
  `redis_host` avant de passer à l'échelle au-delà d'une instance.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour NocoDB sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nocodb` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `NocoDB` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Balise de version de l'image NocoDB ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; minimum 1 GiB pour éviter les OOM au démarrage. |
| `min_instance_count` | `0` | Instances minimales ; `0` active la mise à l'échelle à zéro. Garder ≥ 1 si les webhooks ne doivent pas être perdus. |
| `max_instance_count` | `3` | Instances maximales. |
| `container_port` | `8080` | NocoDB écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 recommandé pour un démarrage plus rapide et une meilleure mise en réseau. |
| `enable_cloudsql_volume` | `false` | **Désactivé** — NocoDB se connecte via IP privée TCP, pas le socket Auth Proxy. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut. Définissez `true` pour maintenir les tâches d'automatisation en arrière-plan en cours d'exécution entre les requêtes. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build avec le mappage NC_DB_* ; `prebuilt` déploie une image existante. |
| `traffic_split` | `[]` | Allocation de trafic Canary/blue-green entre les révisions. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google. Recommandé pour les espaces de travail internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS définis dans `storage_buckets`. Non connecté aux pièces jointes NocoDB — voir §2C. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `enable_nfs` | `false` | NFS n'est pas requis pour NocoDB. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Non câblé sur Cloud Run — `NocoDB_Common` code en dur `POSTGRES_15` quelle que soit cette valeur ; utilisez `NocoDB_GKE` pour `MYSQL_8_0`. |
| `application_database_name` | `nocodb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `nocodb` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` | `NC_DB_HOST` | Nom de la variable d'environnement supplémentaire pour l'hôte de la base de données. |
| `db_port_env_var_name` | `NC_DB_PORT` | Nom de la variable d'environnement supplémentaire pour le port de la base de données. |
| `db_name_env_var_name` | `NC_DB_NAME` | Nom de la variable d'environnement supplémentaire pour le nom de la base de données. |
| `db_user_env_var_name` | `NC_DB_USER` | Nom de la variable d'environnement supplémentaire pour l'utilisateur de la base de données. |
| `db_password_env_var_name` | `NC_DB_PASSWORD` | Nom de la variable d'environnement supplémentaire pour le mot de passe de la base de données. |
| `service_url_env_var_name` | `NC_PUBLIC_URL` | Nom de la variable d'environnement sous laquelle l'URL publique du service est injectée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job intégré `db-init`. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v1/health` | Sonde de démarrage HTTP, délai initial de 30 s. |
| `liveness_probe` / `health_check_config` | `/api/v1/health` | Sonde de vivacité HTTP. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel par rapport à `/api/v1/health`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis. Requis lors de l'exécution de plus d'une instance. |
| `redis_host` | `null` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
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
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` | auto-généré (immuable) | Critique | La rotation après le premier déploiement invalide immédiatement toutes les sessions et tous les jetons API. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `enable_cloudsql_volume` | `false` (par défaut) | Critique | La définition de `true` n'aide pas NocoDB — son constructeur d'URL rejette les chemins de socket et toutes les connexions à la base de données échouent. |
| `memory_limit` | `1Gi` | Élevé | Le processus Node.js de NocoDB est tué par OOM en dessous de 512 Mo ; les charges de travail de production avec de nombreuses automatisations nécessitent 2 Go. |
| `enable_redis` | `true` lorsque >1 instance | Élevé | Plusieurs instances sans Redis entraînent une invalidation de session lorsque les requêtes sont acheminées vers des instances différentes. |
| `redis_host` | explicite lorsque Redis est activé | Élevé | Un hôte manquant entraîne l'échec de toutes les connexions Redis au démarrage. |
| `NC_PUBLIC_URL` / `service_url_env_var_name` | `NC_PUBLIC_URL` (par défaut) | Élevé | NocoDB l'utilise pour construire des liens de partage, des URL de webhook et des notifications par e-mail ; une valeur incorrecte rompt toutes les références sortantes. |
| `cpu_always_allocated` | `false` (par défaut) ; `true` pour une automatisation intensive | Moyen | Sous la facturation basée sur les requêtes par défaut, l'automatisation en arrière-plan de NocoDB et les tâches de nouvelle tentative de webhook sont mises en pause entre les requêtes. |
| `min_instance_count` | `1` | Moyen | `0` provoque des démarrages à froid pendant lesquels les rappels de webhook expirent et sont perdus. |
| `max_instance_count` | garder bas sans Redis | Moyen | L'augmentation au-dessus de `1` sans Redis provoque une invalidation de session. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interne | Moyen | NocoDB est autrement accessible publiquement à son URL `run.app`. |
| `application_version` | épingler à une balise spécifique | Moyen | `latest` déclenche des mises à niveau incontrôlées à chaque reconstruction de conteneur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
NocoDB partagée avec la variante GKE est décrite dans **[NocoDB_Common](NocoDB_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : NocoDB sur Cloud Run](../labs/NocoDB_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [NocoDB sur GKE Autopilot](NocoDB_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [NocoDB Common — Configuration d'application partagée](NocoDB_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md), [Azimutt sur Google Cloud Run](Azimutt_CloudRun.md) dans la solution **BI en libre-service**.
