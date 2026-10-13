---
title: "Module Formbricks GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Formbricks sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Formbricks_GKE.md @ e69407af sha256:3e590d51f49c -->

# Module Formbricks GKE — Guide de configuration {#formbricks-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Formbricks_GKE.png" alt="Module Formbricks GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit toutes les variables de configuration disponibles dans le module `Formbricks_GKE`. `Formbricks_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique `App_GKE` avec la configuration d'application partagée `Formbricks_Common` pour déployer la plateforme open source de sondage et de gestion d'expérience [Formbricks](https://formbricks.com/) sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Formbricks GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Formbricks** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Ce que coûte Formbricks sur RAD, et comment cela se compare {#what-formbricks-costs-on-rad-and-how-that-compares}

**L'exécution de Formbricks dans votre propre projet Google Cloud coûte environ 142,62 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD). Formbricks est une plateforme open source de sondage et de gestion d'expérience. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Formbricks est également disponible sur Cloud Run — voir le [guide Cloud Run](Formbricks_CloudRun.md) pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~142,62 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~108 crédits/jour (~10,80 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **142,62 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan payant le moins cher de **Formbricks Cloud**, Pro, est de 74 $ US/mois (3 espaces de travail, 2 000 réponses mensuelles, sièges illimités) — vérifié sur [https://formbricks.com/pricing](https://formbricks.com/pricing). Cela est inférieur à la facture Google Cloud de RAD d'environ 142,62 $ US/mois pour la variante GKE, rien qu'au prix affiché, mais cela plafonne l'utilisation ; l'instance de RAD est illimitée, auto-hébergée, et les données ne quittent jamais votre propre projet.
- Le véritable compromis ici est entre le plafond et le contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Formbricks est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module Formbricks seul, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de module de 99 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Formbricks et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Formbricks se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou **99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Formbricks reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution : environ **3 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 142,62 $ US/mois), ou **environ 1 jour ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~108 crédits/jour).

La majeure partie du coût d'exécution de Formbricks est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul propre à cette application du total ci-dessus.

Priorité aux données : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tarification de Formbricks Cloud](https://formbricks.com/pricing) pour les chiffres de Formbricks Cloud.

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`.

| Zone de configuration | Notes spécifiques à Formbricks |
|---|---|
| Métadonnées du module | Plateforme uniquement, non transmises à `App_GKE` ; voir [Groupe 0 : Métadonnées du module](#group-0-module-metadata). |
| Projet et identité | Identique à `App_GKE`. |
| Identité de l'application | Valeurs par défaut spécifiques à Formbricks ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | Valeurs par défaut spécifiques à Formbricks pour `container_port`, `cpu_limit`, `memory_limit` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Cluster GKE et charge de travail | Identique à `App_GKE` ; voir [Groupe 3b : Cluster GKE et charge de travail](#group-3b-gke-cluster--workload). |
| Variables d'environnement et secrets | Secrets Formbricks injectés automatiquement ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau | Identique à `App_GKE`. |
| Scripts SQL personnalisés | Identique à `App_GKE` ; voir [Groupe 4b : Scripts SQL personnalisés](#group-4b-custom-sql-scripts). |
| Quotas de ressources | Identique à `App_GKE` ; voir [Groupe 4c : Quotas de ressources](#group-4c-resource-quotas). |
| Contrôles de service VPC | Identique à `App_GKE` ; voir [Groupe 4d : Contrôles de service VPC](#group-4d-vpc-service-controls). |
| Jobs d'initialisation | Job PostgreSQL `db-init` fourni automatiquement par `Formbricks Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Stockage — NFS | `enable_nfs` par défaut à `true` ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | Bucket GCS `uploads` provisionné automatiquement ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | PostgreSQL 15 requis ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Planification et rétention des sauvegardes | Identique à `App_GKE`. |
| Observabilité et vérifications de santé | Point de terminaison `/api/v2/health` ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| Cloud Armor WAF | Identique à `App_GKE`. |
| Proxy compatible avec l'identité | Identique à `App_GKE`. |
| Autorisation binaire | Identique à `App_GKE`. |
| Trafic et Ingress | Identique à `App_GKE`. |
| Domaine personnalisé et IP statique | Formbricks `webapp_url` doit être configuré pour correspondre ; voir [Groupe 11 : Domaine personnalisé et IP statique](#group-11-database-configuration). |
| Déclencheurs Cloud Build | Identique à `App_GKE`. |
| Pipeline Cloud Deploy | Identique à `App_GKE`. |
| Mise en miroir d'images | `enable_image_mirroring` par défaut à `true`. |
| Budgets d'interruption de pod | Identique à `App_GKE`. |
| Contraintes de répartition de topologie | Identique à `App_GKE`. |
| Rotation automatique des mots de passe | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | `enable_redis` par défaut à `true` ; voir [Groupe 12 : Cache Redis](#group-12-redis-cache). |
| Importation de sauvegarde | Expose `backup_uri` et `backup_file`. |
| Configuration StatefulSet | Voir [Groupe 15 : Charges de travail avec état](#group-15-stateful-workloads). |

---

## Comment Formbricks GKE est lié à App GKE {#how-formbricks-gke-relates-to-app-gke}

`Formbricks GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Formbricks Common` qui fournit les valeurs par défaut, les secrets et la configuration d'application spécifiques à Formbricks. Les principaux effets sont les suivants :

1.  **PostgreSQL 15 est requis.** Formbricks est construit sur Prisma ORM ciblant PostgreSQL. La valeur par défaut de `database_type` est `"POSTGRES_15"`.
2.  **Les secrets d'application sont générés automatiquement.** `Formbricks Common` crée `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY` et `S3_SECRET_KEY` dans Secret Manager lors du premier déploiement. Ceux-ci sont injectés dans le pod en tant que variables d'environnement secrètes via le pilote CSI du magasin de secrets.
3.  **Un bucket GCS `uploads` est provisionné automatiquement.** `Formbricks Common` fournit un bucket `uploads` que Formbricks utilise via l'API XML compatible S3 de GCS. Les identifiants HMAC dans Secret Manager authentifient la connexion. Vous n'avez pas besoin de le définir dans `storage_buckets`.
4.  **Un job `db-init` s'exécute lors du premier déploiement.** `Formbricks Common` fournit un job Kubernetes `db-init` par défaut qui initialise le schéma PostgreSQL et crée l'utilisateur de l'application. Les migrations Prisma s'exécutent ensuite automatiquement lorsque le conteneur Formbricks démarre.
5.  **Les valeurs par défaut des ressources sont dimensionnées pour Formbricks.** Les valeurs par défaut de `cpu_limit` (2 vCPU) et `memory_limit` (2 Gi) reflètent les exigences d'exécution de Next.js de Formbricks et du pool de connexions Prisma.
6.  **La mise en cache Redis est activée par défaut.** Formbricks utilise Redis pour la mise en cache des réponses API et la limitation du débit. Obligatoire pour une mise à l'échelle horizontale sécurisée.
7.  **`webapp_url` doit être défini après le premier déploiement.** NextAuth.js nécessite l'URL publique de l'instance Formbricks pour les URI de redirection OAuth et les liens e-mail. Laissez vide lors du premier déploiement ; mettez à jour avec l'IP externe, le domaine nip.io ou le domaine personnalisé une fois que l'IP de l'équilibreur de charge est connue.
8.  **L'affinité de session est par défaut à `ClientIP`.** La gestion des sessions Next.js de Formbricks bénéficie de l'acheminement des requêtes répétées du même navigateur vers le même pod. Requis pour maintenir un état d'authentification cohérent dans le panneau d'administration.

---

## Groupe 0 : Métadonnées du module {#group-0-module-metadata}

Métadonnées de la plateforme/UI lues par la plateforme RAD pour le catalogue, l'ordonnancement des dépendances, la facturation des crédits et le contrôle d'accès. Aucune de ces métadonnées n'est transmise à `App_GKE` — elles n'ont aucun effet sur l'infrastructure déployée.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` | Texte de description de Formbricks | Affiché dans le catalogue de la plateforme. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/modules/Formbricks_GKE"` | Lien vers ce guide. |
| `module_dependency` | `["Services_GCP"]` | Modules que la plateforme déploie en premier. |
| `requires_services` | `{ create_postgres=true, create_network_filesystem=true, create_google_kubernetes_engine=true, ... }` | Indique à la plateforme quels basculements `Services_GCP` `create_*` doivent être activés lors du provisionnement automatique de `Services_GCP` pour ce déploiement. |
| `module_services` | `["GKE Autopilot", "Cloud SQL (PostgreSQL 15)", ...]` | Services GCP affichés dans l'interface utilisateur de la plateforme. |
| `credit_cost` | `110` | Crédits de plateforme consommés par déploiement. |
| `require_credit_purchases` | `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts ou d'événements gratuits. |
| `enable_purge` | `true` | Permet la suppression complète des ressources lors de la destruction. |
| `public_access` | `true` | Liste ce module dans le catalogue public. |
| `require_services_gcp_module` | `true` | Échoue au moment de la planification si aucun VPC géré par `Services_GCP` n'est détecté. Définir `false` pour un déploiement autonome avec des prérequis intégrés. |
| `shared_users` | `[]` | Utilisateurs ayant accès quel que soit `public_access`. |
| `technical_support_users` | `[]` | Utilisateurs vers lesquels la plateforme achemine les demandes de support. |
| `resource_creator_identity` | `"rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com"` | Compte de service que Terraform utilise pour créer des ressources. |
| `application_module` | `""` | Non référencé — n'a aucun effet dans ce module d'application. |
| `impersonation_service_account` | `""` | Non référencé — n'a aucun effet dans ce module d'application. |
| `job_execution_wait_timeout` | `900` | Nombre maximal de secondes qu'un déploiement attend pour le job `db-init` avant d'annuler l'apply. |
| `explicit_secret_values` | `{}` | Non référencé — n'a aucun effet dans ce module d'application (les propres valeurs secrètes de `Formbricks_Common` sont câblées en interne à la place). |
| `scripts_dir` | `""` | Non référencé — n'a aucun effet dans ce module d'application (le module pointe toujours vers le propre répertoire `scripts/` de `Formbricks_Common`). |

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | — | ID du projet GCP. **Obligatoire.** |
| `region` | `"us-central1"` | Région GCP pour le déploiement des ressources. Utilisée comme solution de repli pour la découverte de VPC et comme emplacement du bucket de stockage pour le bucket `uploads`. |
| `tenant_id` | `"demo"` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources provisionnées. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

**Valeurs par défaut spécifiques à Formbricks :**

| Variable | Valeur par défaut Formbricks GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"formbricks"` | `"gkeapp"` | Utilisé comme nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Formbricks Surveys"` | `"App GKE Application"` | Affiché dans les tableaux de bord et l'interface utilisateur de la plateforme. Peut être modifié librement. |
| `application_description` | `"Formbricks Surveys on GKE Autopilot"` | `"App GKE Custom Application"` | Étiquette descriptive. Non transmise à `App_GKE` — la variable `description` contrôle cela. |
| `application_version` | `"latest"` | `"1.0.0"` | Le tag de version Formbricks à construire et déployer. Définir sur une version spécifique pour la production (par exemple, `"v2.3.0"`). |
| `description` | `"Formbricks - Open Source Survey and Experience Management"` | — | Transmis à `Formbricks Common` comme description du job db-init. |
| `webapp_url` | `""` | — | URL publique de l'instance Formbricks. Laisser vide lors du premier déploiement ; mettre à jour après que l'IP externe est connue. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

**Valeurs par défaut et comportement spécifiques à Formbricks :**

| Variable | Valeur par défaut Formbricks GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `3000` | `8080` | Port HTTP natif de Formbricks. Ne pas modifier. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Le serveur Next.js de Formbricks bénéficie de 2 vCPU ; `"1000m"` provoque une latence de réponse notable sous un trafic de sondage modéré. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Formbricks avec pool de connexions Prisma et mise en cache des réponses nécessite au moins 1 Gi ; 2 Gi sont recommandés pour la production avec prise en charge du téléchargement de fichiers. |
| `min_instance_count` | `0` | — | Par défaut à 0 (mise à l'échelle à zéro). Définir à `1` pour la production afin d'éliminer les démarrages à froid. |
| `max_instance_count` | `3` | `3` | HPA maxReplicas. Augmenter pour les campagnes de sondage à fort trafic. |
| `container_image_source` | `"custom"` | `"custom"` | `Formbricks Common` fournit un build basé sur Dockerfile. Définir à `"prebuilt"` pour déployer directement l'image `ghcr.io/formbricks/formbricks` en amont. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy fournit le point de terminaison PostgreSQL dans GKE (Cloud Run utilise le volume Cloud SQL natif — un socket Unix sous `/cloudsql`). |
| `enable_image_mirroring` | `true` | varie | Met en miroir l'image Formbricks de `ghcr.io` vers Artifact Registry pour éviter les limites de débit et assurer la fiabilité du pull. |
| `session_affinity` | `"ClientIP"` | varie | Requis pour un état d'authentification cohérent dans les sessions d'administration Formbricks. Voir la note ci-dessous. |

**Note `session_affinity` :** Le serveur Next.js de Formbricks gère l'état de session en cours de processus (avec Redis comme stockage externe). Sans affinité de session `ClientIP`, les requêtes du panneau d'administration peuvent être acheminées vers différents pods qui n'ont pas encore synchronisé leur cache de session en mémoire, ce qui entraîne des échecs d'authentification intermittents. Conservez `"ClientIP"` pour tous les déploiements Formbricks GKE.

**`container_resources` :** La valeur par défaut de la variable `container_resources` (`{ cpu_limit = "1000m", memory_limit = "512Mi" }`) est remplacée par les valeurs `cpu_limit` et `memory_limit` (respectivement `"2000m"` et `"2Gi"`) fournies par Formbricks Common dans la fusion des locaux `main.tf`. Pour définir des limites de ressources personnalisées, définissez `cpu_limit` et `memory_limit` directement plutôt que `container_resources`.

Les variables d'exécution restantes (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans le guide App_GKE.

---

## Groupe 3b : Cluster GKE et charge de travail {#group-3b-gke-cluster--workload}

Identique à `App_GKE` — pas de valeurs par défaut spécifiques à Formbricks.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE cible. Laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laisser vide pour générer automatiquement à partir de `application_name` + `tenant_id`. |
| `workload_type` | `"Deployment"` | `"Deployment"` ou `"StatefulSet"`. |
| `service_type` | `"LoadBalancer"` | `"LoadBalancer"`, `"ClusterIP"`, ou `"NodePort"`. |
| `configure_service_mesh` | `false` | Active l'injection de sidecar Istio/Anthos Service Mesh pour l'espace de noms. |
| `enable_network_segmentation` | `false` | Crée des NetworkPolicies Kubernetes restreignant le trafic pod-à-pod au même espace de noms. |
| `termination_grace_period_seconds` | `30` | Secondes que Kubernetes attend après SIGTERM avant SIGKILL. |
| `deployment_timeout` | `1800` | Secondes que Terraform attend que le déploiement soit terminé pendant l'apply. |
| `network_name` | `""` | Réseau VPC à utiliser. Non référencé — n'a aucun effet dans ce module d'application. |
| `gke_cluster_selection_mode` | `"primary"` | Non référencé — n'a aucun effet dans ce module d'application. |
| `enable_multi_cluster_service` | `false` | Non référencé — n'a aucun effet dans ce module d'application. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | Non référencé — n'a aucun effet dans ce module d'application. |
| `prereq_subnet_cidr_override` | `""` | Déclaré pour la parité de convention ; non transmis, donc le définir n'a aucun effet ici. |
| `extra_service_ports` | `[]` | Déclaré pour la parité de convention ; non transmis, donc le définir n'a aucun effet ici. |

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Les variables réseau suivantes sont disponibles dans `Formbricks GKE` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. Recommandé pour les déploiements Formbricks internes ou de staging. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google ayant accès à IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour IAP. Requis lorsque `enable_iap = true`. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour IAP. Requis lorsque `enable_iap = true`. |
| `iap_support_email` | `""` | E-mail de support affiché sur l'écran de consentement Google OAuth. |
| `enable_custom_domain` | `true` | Configure l'API Kubernetes Gateway pour le routage de domaine personnalisé avec des certificats SSL gérés. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple, `["surveys.example.com"]`). Lorsque `enable_custom_domain = true` et que ce champ est vide, un domaine nip.io est utilisé pour les tests. |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. Recommandé pour la production. |
| `static_ip_name` | `""` | Nom de l'IP réservée. Généré automatiquement si vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. Le tag `nfsserver` est requis pour la connectivité NFS. |
| `enable_cloud_armor` | `false` | Active une politique de sécurité Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées via Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_cdn` | `false` | Active Cloud CDN via GCPBackendPolicy pour la passerelle. |

> **Configuration de l'URL Formbricks :** Lorsque vous utilisez un domaine personnalisé, définissez `webapp_url` pour qu'il corresponde au domaine. Formbricks utilise cette valeur pour générer les URI de redirection NextAuth.js, les liens de confirmation par e-mail et les URL de partage de sondage. Une non-concordance entre l'URL de service réelle et `webapp_url` interrompt l'authentification et provoque des liens brisés dans les e-mails de sondage.

---

## Groupe 4b : Scripts SQL personnalisés {#group-4b-custom-sql-scripts}

Identique à `App_GKE`. Exécute des scripts SQL arbitraires à partir d'un bucket GCS pendant l'initialisation, en plus (et non à la place) du job `db-init` fourni par `Formbricks_Common`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Exécute des scripts SQL personnalisés à partir de GCS pendant l'initialisation. |
| `custom_sql_scripts_bucket` | `""` | Bucket GCS contenant les scripts. |
| `custom_sql_scripts_path` | `""` | Préfixe de chemin dans le bucket ; les scripts s'exécutent par ordre alphabétique. |
| `custom_sql_scripts_use_root` | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données au lieu de l'utilisateur de l'application. |

---

## Groupe 4c : Quotas de ressources {#group-4c-resource-quotas}

Identique à `App_GKE`. Crée un ResourceQuota Kubernetes limitant le total de CPU, de mémoire et le nombre d'objets dans l'espace de noms Formbricks — utile dans les clusters partagés. Les valeurs de mémoire nécessitent des suffixes binaires (`Gi`/`Mi`) ; les entiers bruts sont traités comme des octets et bloquent toute planification de pod.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms. |
| `quota_cpu_requests` | `""` | Total des requêtes CPU autorisées. Vide = pas de quota. |
| `quota_cpu_limits` | `""` | Total des limites CPU autorisées. Vide = pas de quota. |
| `quota_memory_requests` | `""` | Total des requêtes mémoire autorisées (par exemple, `"4Gi"`). Vide = pas de quota. |
| `quota_memory_limits` | `""` | Total des limites mémoire autorisées (par exemple, `"8Gi"`). Vide = pas de quota. |
| `quota_max_pods` | `""` | Nombre maximal de pods dans l'espace de noms. Vide = pas de quota. |
| `quota_max_services` | `""` | Nombre maximal de services Kubernetes dans l'espace de noms. Vide = pas de quota. |
| `quota_max_pvcs` | `""` | Nombre maximal de PVC dans l'espace de noms. Pertinent uniquement lorsque `workload_type = "StatefulSet"`. Vide = pas de quota. |

---

## Groupe 4d : Contrôles de service VPC {#group-4d-vpc-service-controls}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre de contrôles de service VPC autour des API GCP utilisées par ce module. |
| `vpc_cidr_ranges` | `[]` | CIDR de sous-réseau pour le niveau d'accès VPC-SC. Découvert automatiquement à partir du VPC si vide. |
| `vpc_sc_dry_run` | `true` | Enregistre les violations sans bloquer, recommandé pour le déploiement initial. |
| `organization_id` | `""` | ID d'organisation GCP pour Access Context Manager. Découvert automatiquement si vide. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud détaillés (DATA_READ/DATA_WRITE/ADMIN_READ) pour le projet. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

`Formbricks Common` injecte automatiquement les variables d'environnement suivantes. Vous n'avez pas besoin de les définir dans `environment_variables` :

| Variable d'environnement | Valeur / Source | Notes |
|---|---|---|
| `STORAGE_PROVIDER` | `"s3"` | Indique à Formbricks d'utiliser le pilote de stockage S3. |
| `S3_ENDPOINT_URL` | `"https://storage.googleapis.com"` | Pointe le client S3 de Formbricks vers GCS. |
| `S3_BUCKET_NAME` | `<uploads-bucket-name>` | Bucket GCS `uploads` provisionné automatiquement. |
| `NEXTAUTH_URL` | `var.webapp_url` | URL de base de NextAuth.js. Vide jusqu'à ce que `webapp_url` soit défini. |
| `WEBAPP_URL` | `var.webapp_url` | URL publique de Formbricks pour les liens e-mail. |
| `HUB_API_URL` | `var.hub_api_url` | Point de terminaison de l'API Formbricks Hub (v5+). |
| `CUBEJS_API_URL` | `var.cubejs_api_url` | Point de terminaison de l'API d'analyse Cube.js (v5+). |
| `SMTP_HOST` | `var.smtp_host` | Serveur SMTP. Vide désactive l'e-mail. |
| `SMTP_PORT` | `var.smtp_port` | Port SMTP (valeur par défaut `587`). |
| `SMTP_USER` | `var.smtp_user` | Nom d'utilisateur SMTP. |
| `SMTP_SECURE_ENABLED` | `var.smtp_secure_enabled` (`"1"` / `"0"`) | Indicateur TLS implicite. `true` pour le port `465`, `false` pour STARTTLS sur `587`. |
| `MAIL_FROM` | `var.mail_from` | Adresse de l'expéditeur. |

`smtp_password` (valeur par défaut `""`, sensible) est injecté en tant que Secret Kubernetes `SMTP_PASSWORD` — voir le tableau des secrets ci-dessous. S'il est laissé vide, `Formbricks_Common` génère automatiquement une valeur aléatoire dans Secret Manager.

Les valeurs sensibles suivantes sont injectées en tant que Secrets Kubernetes via le pilote CSI du magasin de secrets (à partir de Secret Manager) :

| Secret Kubernetes | Variable d'environnement | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | `NEXTAUTH_SECRET` | Clé de signature JWT — ne pas modifier après l'existence des utilisateurs. |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY` | Clé de chiffrement des données. |
| `CRON_SECRET` | `CRON_SECRET` | Jeton d'authentification Cron. |
| `HUB_API_KEY` | `HUB_API_KEY` | Clé de connectivité du Hub. |
| `CUBEJS_API_SECRET` | `CUBEJS_API_SECRET` | Secret JWT Cube.js. |
| `S3_ACCESS_KEY` | `S3_ACCESS_KEY` | Clé d'accès HMAC GCS. |
| `S3_SECRET_KEY` | `S3_SECRET_KEY` | Clé secrète HMAC GCS. |
| `SMTP_PASSWORD` | `SMTP_PASSWORD` | Lorsque `smtp_host` est configuré. |
| `REDIS_URL` | `REDIS_URL` | Lorsque l'authentification Redis est activée. |

Utilisez `secret_environment_variables` pour injecter des secrets Secret Manager supplémentaires au-delà de ceux fournis par `Formbricks Common`.

Les variables de secrets restantes (`secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent de manière identique à `App_GKE`.

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

**Valeurs par défaut spécifiques à Formbricks :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajuster pour correspondre à vos objectifs de récupération de données de sondage. |
| `backup_retention_days` | `7` | Augmenter à plus de 30 jours pour les déploiements de sondages actifs avec des données de réponse précieuses. |

**Importation de sauvegarde :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'importation unique pendant le déploiement. |
| `backup_source` | `"gcs"` | `"gcs"` importe à partir d'un URI Cloud Storage ; `"gdrive"` importe à partir d'un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (par exemple, `"gs://my-bucket/formbricks.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom de fichier d'une sauvegarde déjà placée dans le bucket de sauvegardes géré par le module. |
| `backup_format` | `"sql"` | Format : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Variables disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

**Job `db-init` par défaut de Formbricks :**

Lorsque `initialization_jobs` est laissé comme liste vide par défaut, `Formbricks Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | Image client compatible PostgreSQL |
| Objectif | Crée la base de données et l'utilisateur PostgreSQL `formbricks`, puis accorde les privilèges |
| Exécuter à chaque apply | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |

Les migrations Prisma s'exécutent ensuite automatiquement lorsque le conteneur Formbricks démarre — le job `db-init` garantit seulement que la base de données et l'utilisateur existent au préalable.

Remplacez `initialization_jobs` par une liste non vide pour remplacer cette valeur par défaut par des jobs personnalisés. Chaque job personnalisé doit spécifier au moins l'un des éléments `command`, `args` ou `script_path`.

`additional_services` (valeur par défaut `[]`) déploie des services GKE compagnons supplémentaires aux côtés de Formbricks — non utilisés par la configuration par défaut, disponibles pour une personnalisation avancée.

> **Note :** Les jobs cron GKE (`cron_jobs`) utilisent les champs CronJob de Kubernetes (`restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`) plutôt que les champs de style Cloud Run (`parallelism`, `paused`, `max_retries`, `task_count`) utilisés dans `Formbricks CloudRun`.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

**Valeurs par défaut spécifiques à Formbricks :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Le stockage NFS est activé par défaut. Formbricks stocke les téléchargements de fichiers partagés, les actifs mis en cache et les données de session sur le volume NFS afin que toutes les répliques de pods accèdent au même système de fichiers. |
| `nfs_mount_path` | `"/mnt/nfs"` | Le chemin où le volume NFS est monté à l'intérieur du conteneur Formbricks. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base pour une VM GCE NFS intégrée lorsqu'il n'en existe pas. |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. Déclaré pour la parité de convention ; non transféré, donc le paramétrage n'a aucun effet ici. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

`Formbricks Common` provisionne automatiquement un bucket GCS `uploads` en plus de tout bucket défini dans `storage_buckets`. Ce bucket est utilisé par Formbricks pour le stockage de fichiers compatible S3 — les pièces jointes aux réponses d'enquête, les images téléchargées et les actifs personnalisés y sont stockés via l'API XML de GCS avec des identifiants HMAC.

| Bucket | `name_suffix` | Objectif |
|---|---|---|
| Provisionné automatiquement | `uploads` | Téléchargements de fichiers Formbricks via l'API XML GCS compatible S3 |

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain` (par défaut `7`), `delete_untagged_images` (par défaut `true`) et `image_retention_days` (par défaut `30`) se comportent de manière identique à `App_GKE` — les trois dernières régissent le nettoyage des images d'Artifact Registry pour le dépôt créé en ligne.

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

**Valeurs par défaut et restrictions spécifiques à Formbricks :**

| Variable | Valeur par défaut Formbricks GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Formbricks nécessite PostgreSQL. Ne pas changer pour MySQL ou SQL Server — l'ORM Prisma dans ce module cible PostgreSQL. |
| `db_name` | `"formbricks"` | — | Raccourci pour le nom de la base de données Formbricks. **Ne pas modifier après le premier déploiement.** |
| `db_user` | `"formbricks"` | — | Raccourci pour l'utilisateur de la base de données Formbricks. **Ne pas modifier après le premier déploiement.** |
| `application_database_name` | `"formbricksdb"` | `"gkeappdb"` | La variable de niveau `App_GKE` pour le nom de la base de données. Ceci est effectivement remplacé par `db_name` dans `Formbricks Common` — utiliser `db_name` pour Formbricks. |
| `application_database_user` | `"formbricksuser"` | `"gkeappuser"` | La variable de niveau `App_GKE` pour l'utilisateur de la base de données. Utiliser `db_user` pour Formbricks. |
| `enable_postgres_extensions` | `true` | `false` | Les extensions PostgreSQL sont activées par défaut pour Formbricks. |
| `postgres_extensions` | `["vector", "uuid-ossp"]` | `[]` | `vector` (pgvector) est requis par le schéma Prisma de Formbricks (fonctionnalités d'embeddings/IA) — sans cela, `prisma db push` échoue avec une erreur de permission car l'utilisateur de la base de données de l'application ne peut pas `CREATE EXTENSION`. `uuid-ossp` prend en charge la génération d'UUID. |
| `enable_mysql_plugins` | `false` | `false` | N/A — Formbricks nécessite PostgreSQL. Transféré à `App_GKE` mais n'a aucun effet tant que `database_type` reste `POSTGRES_15`. |
| `mysql_plugins` | `[]` | `[]` | N/A — Formbricks nécessite PostgreSQL. |

**Découverte d'instances Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laisser vide pour la découverte automatique. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base pour une instance Cloud SQL intégrée. L'ID de déploiement est ajouté. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job de rotation automatique des mots de passe de base de données. Lorsque `true`, le mot de passe de la base de données est tourné selon le calendrier défini par `secret_rotation_period` et les pods GKE sont redémarrés. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |
| `database_password_length` | `32` | Longueur du mot de passe de base de données auto-généré (16 à 64 caractères). |

**Variables de parité de convention inertes :** `application_database_name` (`"formbricksdb"`) et `application_database_user` (`"formbricksuser"`) sont les variables d'identité de base de données de niveau `App_GKE` — Formbricks utilise `db_name`/`db_user` à la place (voir ci-dessus), donc celles-ci ne sont pas référencées. `db_host_env_var_name`, `db_name_env_var_name`, `db_password_env_var_name`, `db_port_env_var_name` et `db_user_env_var_name` (tous par défaut `""`) permettent à un module enveloppant d'exposer les détails de connexion à la base de données sous des noms de variables d'environnement supplémentaires, non standard ; `Formbricks_GKE` les déclare pour la parité de convention mais ne les transmet pas, donc les définir n'a aucun effet ici.

---

## Groupe 12 : Cache Redis {#group-12-redis-cache}

Formbricks utilise Redis pour la mise en cache des réponses API, la limitation de débit et la coordination des jobs en arrière-plan. Redis est **obligatoire pour la mise à l'échelle horizontale** — sans Redis, plusieurs pods Formbricks ne peuvent pas partager l'état du cache, ce qui entraîne des buckets de limitation de débit en double et des réponses API incohérentes.

> **Note :** Dans `Formbricks GKE`, les variables Redis se trouvent dans le **groupe 15** du fichier de variables, mais sont documentées ici comme groupe 12 pour plus de clarté.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis comme backend de cache et de limitation de débit de Formbricks. **Requis pour `max_instance_count > 1`.** Lorsque `redis_host` est vide, le module utilise par défaut l'adresse IP du serveur NFS. |
| `redis_host` | `""` | Nom d'hôte ou adresse IP du serveur Redis. Laisser vide pour utiliser l'adresse IP du serveur NFS. Remplacer par une instance Cloud Memorystore pour la production. |
| `redis_port` | `"6379"` | Port TCP Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis. Laisser vide si Redis ne nécessite pas d'authentification. Sensible. |
| `hub_api_url` | `"http://localhost:8080"` | URL de l'API Formbricks Hub (groupe 15). |
| `cubejs_api_url` | `"http://localhost:4000"` | URL de l'API d'analyse Cube.js (groupe 15). |

**Validation de Redis dans GKE :**
```bash
# Confirm the Redis environment variable is set in the Formbricks pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# Test Redis connectivity from inside the Formbricks pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379

# List Memorystore Redis instances (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,authEnabled)"
```

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Formbricks expose `/api/v2/health` — un point de terminaison de santé dédié qui renvoie `HTTP 200` uniquement lorsque l'application et sa connexion PostgreSQL sont opérationnelles.

`Formbricks GKE` expose **deux ensembles parallèles** de variables de sonde :

| Ensemble de variables | Configure |
|---|---|
| `startup_probe`, `liveness_probe` | Transmis à `Formbricks Common` ; configure la spécification de la sonde Kubernetes du conteneur d'application |
| `startup_probe_config`, `health_check_config` | Transmis directement à `App GKE` ; configure les vérifications de santé au niveau de l'infrastructure et de l'équilibreur de charge |

**Sonde de démarrage** (`startup_probe` → Formbricks Common) :

| Champ | Valeur par défaut Formbricks | Notes |
|---|---|---|
| `path` | `"/api/v2/health"` | Point de terminaison de santé natif de Formbricks — reflète la connectivité de la base de données. |
| `initial_delay_seconds` | `0` | La sonde de démarrage Kubernetes utilise `failureThreshold × periodSeconds` comme allocation totale. |
| `period_seconds` | `30` | Vérifier toutes les 30 secondes. |
| `failure_threshold` | `10` | Jusqu'à 300 secondes au total (10 × 30s) pour que Formbricks démarre. |
| `timeout_seconds` | `10` | |

**Sonde de vivacité** (`liveness_probe` → Formbricks Common) :

| Champ | Valeur par défaut Formbricks | Notes |
|---|---|---|
| `path` | `"/api/v2/health"` | Même point de terminaison que la sonde de démarrage. |
| `initial_delay_seconds` | `60` | Donne à Formbricks le temps de se stabiliser avant le début des vérifications de vivacité. |
| `period_seconds` | `30` | |
| `failure_threshold` | `3` | Conteneur redémarré après 3 échecs consécutifs (90 secondes). |

**Sondes standard App GKE** (`startup_probe_config`, `health_check_config` → App GKE) :

Les deux sont par défaut `path = "/"`. Pour des vérifications de santé précises de l'équilibreur de charge, remplacez les deux pour utiliser `path = "/api/v2/health"` afin de correspondre au point de terminaison de santé réel de Formbricks.

| Variable | Groupe | Valeur par défaut |
|---|---|---|
| `startup_probe_config` | 10 | `{ enabled = true, type = "TCP", path = "/" }` |
| `health_check_config` | 10 | `{ enabled = true, type = "HTTP", path = "/" }` |
| `uptime_check_config` | 10 | `{ enabled = false, path = "/" }` |
| `alert_policies` | 10 | `[]` |

---

## Groupe 14 : Politiques de fiabilité {#group-14-reliability-policies}

Identique à `App_GKE`. Variables disponibles : `enable_pod_disruption_budget` (par défaut `true`), `pdb_min_available` (par défaut `"1"`), `enable_topology_spread` (par défaut `false`), `topology_spread_strict` (par défaut `false`).

Pour les déploiements Formbricks en production avec `max_instance_count > 1`, définissez `enable_topology_spread = true` pour distribuer les pods sur les zones de nœuds GKE Autopilot et améliorer la disponibilité.

---

## Groupe 15 : Charges de travail avec état {#group-15-stateful-workloads}

Lorsque `stateful_pvc_enabled = true`, le module utilise automatiquement un type de charge de travail `StatefulSet`. Cela provisionne un PVC par pod pour le stockage local de Formbricks.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Active le PVC par pod pour StatefulSet. Définissez `true` si NFS est désactivé et qu'un stockage persistant local est nécessaire. |
| `stateful_pvc_size` | `"10Gi"` | Taille du PVC par pod. Les téléchargements de fichiers d'enquête peuvent augmenter rapidement — prévoyez 50+ Gi pour les déploiements actifs. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin de montage pour le PVC par pod. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Valeur par défaut de GKE Autopilot (PD équilibré, ReadWriteOnce). |
| `stateful_headless_service` | `true` | Crée un Service sans tête pour des identités DNS de pod stables. |
| `stateful_pod_management_policy` | `"OrderedReady"` | Démarrage séquentiel des pods. Utilisez `"Parallel"` pour démarrer tous les pods simultanément. |
| `stateful_update_strategy` | `"RollingUpdate"` | Remplacements de pods en continu lors des changements de modèle. |

> **Note :** `stateful_pvc_enabled = true` et `workload_type = "Deployment"` ne peuvent pas être utilisés ensemble — cela échoue au moment de la planification.

---

## Sorties du module {#module-outputs}

`Formbricks GKE` expose les sorties suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `service_url` | URL du service. |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement. |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (inclut le bucket `uploads`). |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — relancez l'apply pour terminer le déploiement. |

---

## Exploration avec la console GCP {#exploring-with-the-gcp-console}

Après le déploiement, utilisez la console GCP pour observer et opérer le déploiement Formbricks GKE.

**Charges de travail GKE :**
- Naviguez vers **Kubernetes Engine → Workloads** et sélectionnez votre projet et votre cluster.
- Filtrez par l'espace de noms Formbricks (par exemple, `formbricks-demo`). Vous verrez le `Deployment` ou `StatefulSet` Formbricks ainsi que tous les Jobs `db-init`.
- Cliquez sur la charge de travail pour voir le nombre de pods, l'état de la mise à jour continue et les requêtes/limites de ressources.
- L'onglet **Events** affiche les décisions du planificateur Kubernetes, l'état de l'extraction d'images et les échecs de sonde. C'est le premier endroit où chercher lorsque les pods ne démarrent pas.
- L'onglet **YAML** affiche le manifeste Kubernetes complet, y compris toutes les variables d'environnement injectées et les montages de volumes secrets.

**Services et Ingress GKE :**
- Naviguez vers **Kubernetes Engine → Services & Ingress** et sélectionnez l'espace de noms Formbricks.
- Le service Formbricks (type `LoadBalancer`) affiche son adresse IP externe. C'est l'adresse IP à définir comme base `webapp_url` lors du premier déploiement.
- Si `enable_custom_domain = true`, une ressource Gateway apparaît ici avec l'état du certificat SSL attaché.
- L'onglet **Backend health** sur l'Ingress/Gateway indique si l'équilibreur de charge considère les pods Formbricks comme sains.

**HPA (Horizontal Pod Autoscaler) :**
- Naviguez vers **Kubernetes Engine → Workloads**, sélectionnez le déploiement Formbricks, puis regardez la section **Horizontal Pod Autoscaler**.
- Le nombre de répliques actuel, l'utilisation cible du CPU et les événements de mise à l'échelle sont visibles ici.
- Alternativement, naviguez vers le cluster dans **Kubernetes Engine → Clusters** et utilisez le Cloud Shell intégré : `kubectl get hpa -n formbricks-demo`.

**Secret Manager :**
- Naviguez vers **Security → Secret Manager** et filtrez par `formbricks`.
- Tous les secrets auto-générés apparaissent ici : `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, et conditionnellement `SMTP_PASSWORD` et `REDIS_URL`.
- Cliquez sur n'importe quel secret pour voir son historique de versions, son horodatage de création et les charges de travail Kubernetes qui le référencent (sous **Usage**).

**Cloud SQL :**
- Naviguez vers **SQL** et sélectionnez l'instance PostgreSQL.
- L'onglet **Connections** affiche les connexions actives des pods GKE. Sous forte charge, le nombre de connexions est un indicateur de santé clé — les limites du pool de connexions de Prisma le maintiennent généralement bas.
- L'onglet **Operations** enregistre la création de la base de données et de l'utilisateur du job `db-init`.

**Cloud Storage :**
- Naviguez vers **Cloud Storage → Buckets** et trouvez le bucket `uploads`.
- Les pièces jointes aux fichiers d'enquête téléchargées par les répondants y sont stockées en tant qu'objets.
- L'onglet **Permissions** confirme que le compte de service HMAC a `roles/storage.objectAdmin`.

**Cloud Build :**
- Naviguez vers **Cloud Build → History** pour voir l'historique de build de l'image Formbricks.
- Chaque journal de build affiche les étapes du Dockerfile, les arguments de build référençant `application_version` et l'étape de push vers Artifact Registry.

---

## Exploration avec gcloud {#exploring-with-gcloud}

Les commandes suivantes sont utiles pour les opérations quotidiennes. Remplacez `PROJECT_ID`, `REGION`, `CLUSTER_NAME` et `NAMESPACE` par vos valeurs.

**Obtenir les identifiants du cluster et définir le contexte de l'espace de noms :**
```bash
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

kubectl config set-context --current --namespace=NAMESPACE
```

**Lister tous les pods et leur statut :**
```bash
kubectl get pods -n NAMESPACE -o wide
```

**Décrire un pod Formbricks (affiche les événements, l'état de la sonde, l'utilisation des ressources) :**
```bash
kubectl describe pod POD_NAME -n NAMESPACE
```

**Afficher les journaux en direct du conteneur Formbricks :**
```bash
kubectl logs -n NAMESPACE -l app=formbricks --follow --tail=100
```

**Vérifier l'état de l'HPA et l'historique de mise à l'échelle :**
```bash
kubectl get hpa -n NAMESPACE
kubectl describe hpa formbricks -n NAMESPACE
```

**Confirmer que tous les secrets Formbricks sont montés dans le pod :**
```bash
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E 'NEXTAUTH|ENCRYPTION|CRON|S3|REDIS|SMTP'
```

**Lister les secrets Secret Manager pour le déploiement Formbricks :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, replication.automatic, createTime)"
```

**Afficher la dernière version d'un secret (métadonnées uniquement) :**
```bash
gcloud secrets versions describe latest \
  --secret=formbricks-nextauth-secret \
  --project=PROJECT_ID
```

**Vérifier l'instance Cloud SQL PostgreSQL :**
```bash
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier)"

gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Vérifier l'adresse IP externe de l'Ingress / Gateway GKE :**
```bash
kubectl get gateway -n NAMESPACE
kubectl get svc -n NAMESPACE formbricks
```

**Vérifier le bucket GCS des téléchargements Formbricks :**
```bash
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, location, storageClass)"

gcloud storage ls gs://UPLOADS_BUCKET_NAME/ --long
```

**Afficher les événements au niveau du cluster GKE (utile pour les échecs de planification) :**
```bash
kubectl get events -n NAMESPACE --sort-by='.lastTimestamp' | tail -30
```

**Vérifier Memorystore Redis (si vous utilisez Memorystore pour Redis) :**
```bash
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"
```

**Déclencher manuellement le job db-init :**
```bash
kubectl create job formbricks-db-init-manual \
  --from=cronjob/formbricks-db-init \
  -n NAMESPACE
kubectl logs -n NAMESPACE job/formbricks-db-init-manual --follow
```

**Afficher l'historique de build d'images Cloud Build :**
```bash
gcloud builds list \
  --project=PROJECT_ID \
  --limit=10 \
  --format="table(id, status, createTime, duration)"
```

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `webapp_url` | Définie après le premier déploiement | **Élevé** | NextAuth.js génère des URI de redirection OAuth et des liens e-mail référençant la valeur de `webapp_url`. Si elle est laissée vide après le premier déploiement, l'authentification échoue pour tout fournisseur OAuth et les liens e-mail renvoient à localhost. Récupérez l'adresse IP externe de `kubectl get svc`, définissez `webapp_url` et redéployez. |
| `db_name` | `"formbricks"` | **Critique** | Immuable après le premier déploiement — la modification recrée la base de données, détruisant toutes les définitions d'enquête, les réponses et les données d'équipe. |
| `db_user` | `"formbricks"` | **Critique** | Immuable après le premier déploiement — la modification recrée l'utilisateur de la base de données et rompt toutes les références d'identifiants existantes. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Le schéma Prisma de Formbricks cible PostgreSQL. La définition à `MYSQL_8_0` ou `NONE` entraîne l'échec de Formbricks au démarrage avec une erreur client Prisma. |
| `enable_redis` | `true` | **Élevé** | Redis est activé par défaut. Lorsque `redis_host = ""`, le module utilise l'adresse IP du serveur NFS. Si `enable_nfs = false` et `redis_host` est également vide, Formbricks échoue au démarrage. Avec `max_instance_count > 1`, Redis est obligatoire — sans lui, chaque pod maintient un cache isolé, entraînant une limitation de débit et un comportement de réponse incohérents. |
| `session_affinity` | `"ClientIP"` | **Élevé** | Sans affinité de session, les requêtes du panneau d'administration Formbricks sont acheminées vers différents pods. Les caches de session en mémoire divergent, provoquant des échecs d'authentification intermittents et des déconnexions inattendues. Gardez `"ClientIP"` pour tous les déploiements Formbricks multi-répliques. |
| `enable_nfs` | `true` | **Élevé** | Sans NFS, les actifs d'enquête téléchargés sont stockés sur le système de fichiers éphémère du pod. Tous les téléchargements sont perdus lors du redémarrage du pod ou de la mise à jour continue. Plusieurs répliques servent un contenu de fichier incohérent. |
| `memory_limit` | `"2Gi"` | **Élevé** | La valeur par défaut de base `container_resources` de GKE n'est que `"512Mi"`. Le runtime Next.js de Formbricks nécessite au moins 1 Gi ; le pool de connexions Prisma et la mise en cache des réponses sous un trafic d'enquête actif nécessitent 2 Gi. Un sous-provisionnement entraîne des plantages OOM de Node.js. |
| `smtp_host` | `""` | **Élevé** | Sans SMTP, Formbricks ne peut pas envoyer d'invitations d'utilisateurs, de notifications de réponse d'enquête ou d'e-mails de connexion par lien magique. Configurez un fournisseur SMTP valide avant d'inviter des membres de l'équipe. |
| `min_instance_count` | `0` | **Moyen** | La mise à l'échelle à zéro entraîne des démarrages à froid de 15 à 20 secondes. Les répondants à l'enquête qui visitent immédiatement après une période d'inactivité subissent ce délai. Définissez à `1` pour les enquêtes de production avec des exigences de SLA. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour les déploiements d'enquêtes actives. Augmentez à plus de 30 jours pour tout déploiement Formbricks en production collectant des données de réponse d'enquête précieuses. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers bruts sont traités comme des octets par Kubernetes et bloquent entièrement la planification de tous les pods. |
| `enable_pod_disruption_budget` | `true` | **Moyen** | Déjà activé. La désactivation permet de terminer tous les pods simultanément lors des mises à niveau de nœuds GKE Autopilot, entraînant une panne de service complète. |
| `pdb_min_available` | `"1"` | **Moyen** | Avec une seule réplique, PDB empêche toutes les perturbations volontaires jusqu'à ce que le pod soit replanifié. Utilisez au moins 2 répliques en production pour permettre une maintenance continue. |
| `stateful_pvc_size` | `"10Gi"` | **Moyen** | Les téléchargements de fichiers d'enquête augmentent rapidement. `10Gi` est un minimum pour le développement. Prévoyez 50 à 100 Gi pour les déploiements de production actifs acceptant les pièces jointes. La taille du PVC peut être étendue mais pas réduite sans migration de données. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le panneau d'administration Formbricks n'est protégé que par l'authentification propre à Formbricks. Activez-le pour tout déploiement de production accessible publiquement. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Formbricks sur GKE Autopilot](../labs/Formbricks_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Formbricks Common](Formbricks_Common.md) — la configuration partagée par les deux cibles de déploiement.
