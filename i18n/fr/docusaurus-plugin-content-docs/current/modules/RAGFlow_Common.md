---
title: "RAGFlow Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module RAGFlow — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/RAGFlow_Common.md @ 3055034 sha256:7fe03e4ec198 -->

# RAGFlow Common — Configuration applicative partagée {#ragflow-common--shared-application-configuration}

`RAGFlow_Common` est la **couche applicative partagée** de RAGFlow. Elle n'est pas
déployée seule ; elle fournit la configuration propre à RAGFlow sur laquelle
s'appuient à la fois [RAGFlow_GKE](RAGFlow_GKE.md) et [RAGFlow_CloudRun](RAGFlow_CloudRun.md),
de sorte que les deux variantes de plateforme se comportent de façon identique là
où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle ne possède aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement RAGFlow, consultez les
guides de plateforme ([RAGFlow_GKE](RAGFlow_GKE.md), [RAGFlow_CloudRun](RAGFlow_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par RAGFlow_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Construit une image personnalisée à partir de `infiniflow/ragflow` via Cloud Build ; `APP_VERSION` est défini à partir de l'`application_version` de l'appelant | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement qui crée la base de données `rag_flow`, l'utilisateur `ragflow` et les droits associés | Output `initialization_jobs` |
| Stockage objet | Déclare le bucket de documents **Cloud Storage** (suffixe `documents`) | Output `storage_buckets` |
| Paramètres de base | Injecte les variables d'environnement de connexion MySQL, Elasticsearch et Redis ; définit le port du service à 80 | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage, de vivacité et de disponibilité ciblant les points de terminaison de santé de RAGFlow | §Observabilité dans les guides de plateforme |
| Configuration de démarrage | Intègre le script `entrypoint.sh` personnalisé qui génère `service_conf.yaml` au démarrage du conteneur | Comportement de démarrage du conteneur |

---

## 2. Image de conteneur et build personnalisé {#2-container-image-and-custom-build}

Contrairement à la plupart des modules applicatifs qui récupèrent une image
préconstruite, `RAGFlow_Common` définit `image_source = "custom"` de manière
inconditionnelle. Cloud Build exécute le `Dockerfile` de `RAGFlow_Common/scripts/`
en utilisant `infiniflow/ragflow` comme image de base et transmet `APP_VERSION`
comme argument de build. Le résultat est poussé dans Artifact Registry et déployé
sur la plateforme cible. Pour déployer une autre version de RAGFlow, incrémentez
`application_version` dans le module de plateforme — cela relance le build Cloud
Build.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

RAGFlow exige **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas pris en
charge. Lors du premier déploiement, un job ponctuel `db-init` se connecte à
Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée la base de données `rag_flow` avec la collation `utf8mb4_unicode_ci` (si elle est absente),
2. crée l'utilisateur applicatif `ragflow` avec le mot de passe généré,
3. accorde à cet utilisateur tous les privilèges sur cette base de données,
4. envoie un signal d'arrêt au sidecar Cloud SQL Auth Proxy afin que le Job se termine.

Le job peut être relancé sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=ragflow --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans
les outputs du déploiement de la plateforme.

---

## 4. Paramètres applicatifs de base et variables d'environnement {#4-core-application-settings-and-environment-variables}

`RAGFlow_Common` établit l'environnement afin que l'application démarre
correctement dès le premier lancement. Les variables suivantes sont toujours
injectées et ne doivent pas être surchargées via `environment_variables` :

| Variable | Valeur | Rôle |
|---|---|---|
| `MYSQL_HOST` | `127.0.0.1` | Adresse du Cloud SQL Auth Proxy (GKE : TCP via le proxy ; Cloud Run : pont socat) |
| `MYSQL_PORT` | `3306` | Port standard de MySQL |
| `MYSQL_DATABASE` | `db_name` (par défaut : `rag_flow`) | Nom de la base de données RAGFlow |
| `MYSQL_USER` | `db_user` (par défaut : `ragflow`) | Utilisateur de la base de données RAGFlow |
| `ELASTICSEARCH_HOSTS` | `elasticsearch_hosts` | Point de terminaison HTTP d'Elasticsearch |
| `ELASTICSEARCH_USERNAME` | `elasticsearch_username` | Nom d'utilisateur Elasticsearch (vide lorsque la sécurité est désactivée) |
| `REDIS_HOST` | `redis_host` | Hôte du serveur Redis (injecté uniquement s'il n'est pas vide) |
| `REDIS_PORT` | `redis_port` | Port du serveur Redis (injecté uniquement s'il n'est pas vide) |

Ajustements propres à chaque plateforme :

- **Cloud Run** utilise un pont `socat` dans le point d'entrée du conteneur pour
  faire correspondre le socket Unix du Cloud SQL Auth Proxy à `127.0.0.1:3306`, car
  le client PyMySQL de RAGFlow ne peut pas se connecter directement via le chemin
  d'un socket Unix.
- **GKE** se connecte à l'Auth Proxy en TCP ; aucun pont de socket n'est nécessaire.
- **Résolution de l'hôte Redis.** Le script `entrypoint.sh` fourni privilégie un
  `REDIS_HOST` explicite ; lorsqu'il n'est pas défini, il se rabat sur
  `NFS_SERVER_IP` (la VM NFS de la plateforme, qui héberge aussi Redis) avant de
  revenir en dernier recours à
  `127.0.0.1`. `RAGFlow_CloudRun` et `RAGFlow_GKE` transmettent tous deux
  `enable_redis` de manière inconditionnelle (sans dépendre de la définition de
  `redis_host`), de sorte que ce repli aboutit de façon fiable à une instance
  Redis fonctionnelle.

---

## 5. Configuration de démarrage — `service_conf.yaml` {#5-startup-configuration--service_confyaml}

RAGFlow exige un fichier `service_conf.yaml` dans `/ragflow/conf/service_conf.yaml`
avant de démarrer. Le script `entrypoint.sh` personnalisé fourni par ce module
génère ce fichier à partir des variables d'environnement injectées au démarrage du
conteneur. Le fichier relie la connexion MySQL, le point de terminaison
Elasticsearch, la connexion Redis et les paramètres facultatifs MinIO/OAuth. Le
point d'entrée délègue ensuite au propre script de démarrage de l'image RAGFlow.

L'image de conteneur elle-même ne contient donc aucun secret — tous les détails
de connexion sont injectés à l'exécution via Secret Manager et des variables
d'environnement.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

RAGFlow charge des modèles d'embedding lors du premier démarrage, ce qui peut
prendre 2 à 3 minutes. Les sondes par défaut sont réglées en conséquence :

| Sonde | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|
| Démarrage | `/v1/health` | 120 s | 10 s | 60 tentatives |
| Vivacité | `/v1/system/version` | 120 s | 30 s | 3 tentatives |
| Disponibilité | `/v1/system/version` | 30 s | 10 s | 3 tentatives |

Cloud Run utilise `/v1/system/version` pour les sondes de démarrage et de vivacité
(défini dans `RAGFlow_CloudRun`) afin de détecter le moment où l'application est
entièrement initialisée. GKE utilise `/v1/health`. Les deux variantes laissent
amplement de temps avant que les sondes ne commencent leurs vérifications.

---

## 7. Stockage objet {#7-object-storage}

Un bucket de documents **Cloud Storage** dédié est déclaré ici avec le suffixe
`documents` et provisionné par le socle dans la région du déploiement. Le compte de
service de la charge de travail y reçoit automatiquement l'accès. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~ragflow"
```

Les buckets supplémentaires et les montages de volumes GCS Fuse se configurent au
niveau du module de plateforme via `storage_buckets` et `gcs_volumes`.

---

Pour la configuration propre à RAGFlow exposée aux utilisateurs (variables par
groupe, outputs, et comment explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[RAGFlow_GKE](RAGFlow_GKE.md)** et
**[RAGFlow_CloudRun](RAGFlow_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [RAGFlow sur Google Cloud Run](RAGFlow_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [RAGFlow sur GKE Autopilot](RAGFlow_GKE.md) — cette configuration déployée sur GKE.
