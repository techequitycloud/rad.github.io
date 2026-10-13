---
title: "Module Listmonk GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Listmonk sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Listmonk_GKE.md @ e69407af sha256:7c389846d166 -->

# Module Listmonk GKE — Guide de configuration {#listmonk-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Listmonk_GKE.png" alt="Module Listmonk GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit toutes les variables de configuration disponibles dans le module `Listmonk_GKE`. `Listmonk_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Listmonk_Common`](./Listmonk_Common) pour déployer [Listmonk](https://listmonk.app/), le gestionnaire de newsletters et de listes de diffusion auto-hébergé, sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Listmonk GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Listmonk** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Coût de Listmonk sur RAD et comparaison {#what-listmonk-costs-on-rad-and-how-that-compares}

**Listmonk sur le module GKE Autopilot de RAD coûte environ 91 US$ par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11,00 US$).** GKE convient à Listmonk pour l'envoi continu aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Listmonk_CloudRun.md) exécute le même Listmonk pour environ 68 US$ par mois. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 91 US$ deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 US$ au prix de la recharge) | 99,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **91 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **91 crédits par jour**, soit environ 2730 par mois (environ 273 US$ au prix de la recharge, 218 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins avec un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 0,5 Gio | 34,29 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 91 US$** |

### Comparaison {#how-it-compares}

- **Il n'existe pas de SaaS Listmonk hébergé officiel** — il est auto-hébergé par conception.
- Un GCE e2-standard-2 (2 vCPU/8 Go, environ 49 US$/mois) est la comparaison auto-gérée de taille plus proche pour le pod GKE plus son Postgres, moins les sauvegardes gérées et l'autoscaling de pod que RAD inclut.
- Ou consultez le [guide Cloud Run](Listmonk_CloudRun.md) pour l'option à moindre coût, qui se met également à l'échelle à zéro entre les envois.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Listmonk s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les
30 jours pour presque rien.** Cela convient bien mieux à Listmonk dont vous n'avez besoin qu'occasionnellement — un
projet de cours, une démo, une évaluation de courte durée — que de le faire fonctionner
en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL ou le calcul propre à Listmonk un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Pour Listmonk
  derrière un petit Services_GCP et Project_GCP, cela représente **une poignée de crédits
  (moins de 1 US$)** au total, contre les 115 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne
  gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après
  cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart
  des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de Listmonk
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Listmonk et souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  dedans, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  115 crédits (11,50 US$), car RAD
  recrée le projet et les services partagés avant Listmonk. La suppression permet d'économiser de l'argent
  seulement si Listmonk resterait inutilisé pendant environ quatre jours
  ou plus, à la fois dans votre propre projet (environ 3,04 US$ par jour) et dans
  un projet géré par RAD (91 crédits par jour).
- **Supprimez tout ce que Listmonk utilise.** La majeure partie du coût d'exécution est généralement la base de données. Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Listmonk alors que quelque chose d'autre partage le projet n'économise que la partie calcul propre à Listmonk.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Listmonk pour une classe. Chaque
  participant obtient Listmonk dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie pour sa propre place. Tout est supprimé lorsque la
  session se termine, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Listmonk pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et estimation quotidienne de 91 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Listmonk |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Listmonk ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Listmonk pour `container_port`, `cpu_limit`, `memory_limit` et `min_instance_count` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Configuration du service principal | Secret `LISTMONK_ADMIN_PASSWORD` auto-généré par `Listmonk Common` ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et politiques réseau | §3.D Réseau et politiques réseau | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Job PostgreSQL `db-init` fourni automatiquement par `Listmonk Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Services supplémentaires | Identique. |
| Stockage — NFS | §3.C Stockage (NFS / GCS / GCS Fuse) | `enable_nfs` par défaut à `false` ; Listmonk utilise GCS Fuse pour les téléchargements ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Bucket GCS provisionné automatiquement pour les téléchargements de médias ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **PostgreSQL 15 requis** ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Plan de sauvegarde et rétention | §3.B Base de données (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Jobs d'initialisation et CronJobs | Identique. |
| Observabilité et vérifications de santé | §3.A Calcul (GKE Autopilot) | Le point de terminaison de santé est `/api/health` ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Proxy conscient de l'identité | §4.B Proxy conscient de l'identité (IAP) | Identique. |
| Autorisation binaire | §4.C Autorisation binaire | Identique. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |
| Pilote CSI du magasin de secrets | §4.E Pilote CSI du magasin de secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | §5 Trafic et Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | L'URL publique de Listmonk doit correspondre au domaine configuré dans `application_domains` ; voir [Groupe 16 : Domaine personnalisé et IP statique](#group-16-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Déclencheurs Cloud Build | Identique. |
| Pipeline Cloud Deploy | §6.B Pipeline Cloud Deploy | Identique. |
| Mise en miroir d'images | §6.C Mise en miroir d'images | Identique. |
| Budgets de perturbation de pod | §7.A Budgets de perturbation de pod | Identique. |
| Contraintes de répartition de topologie | §7.B Contraintes de répartition de topologie | Identique. |
| Quotas de ressources | §7.C Quotas de ressources | Identique. |
| Rotation automatique des mots de passe | §7.D Rotation automatique des mots de passe | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` par défaut à `false` ; Listmonk ne nécessite pas Redis ; voir [Groupe 15 : Cache Redis](#group-15-redis-cache). |
| Importation de sauvegarde | §8.B Importation de sauvegarde | Prend en charge à la fois l'URI GCS et le bucket de sauvegarde géré par le module ; voir [Groupe 6 : Sauvegarde et maintenance](#group-6-backup--maintenance). |
| Maillage de services (ASM) | §8.C Maillage de services (ASM via Fleet) | Identique. |
| Services multi-clusters | §8.D Services multi-clusters (MCS) | Identique. |

---

## Comment Listmonk GKE est lié à App GKE {#how-listmonk-gke-relates-to-app-gke}

`Listmonk GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Listmonk Common` qui fournit des valeurs par défaut et une configuration d'application spécifiques à Listmonk. Les principaux effets sont les suivants :

1.  **PostgreSQL 15 est requis.** Listmonk utilise PostgreSQL comme seul backend de base de données pris en charge. La valeur par défaut `database_type` est définie sur `"POSTGRES_15"` et ne doit pas être modifiée pour MySQL ou tout autre moteur.
2.  **`LISTMONK_ADMIN_PASSWORD` est auto-généré.** `Listmonk Common` crée un mot de passe administrateur généré aléatoirement et le stocke dans Secret Manager, injecté dans le conteneur en tant que `LISTMONK_ADMIN_PASSWORD` — vous n'avez pas besoin de le configurer manuellement. Le nom d'utilisateur administrateur correspondant est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`.
3.  **Listmonk exécute automatiquement les migrations de schéma au premier démarrage.** Aucune initialisation manuelle du schéma n'est requise au-delà du job `db-init` qui crée la base de données et l'utilisateur. Le binaire de Listmonk applique toutes les migrations en attente lors de son démarrage.
4.  **Un job `db-init` s'exécute lors du premier déploiement.** `Listmonk Common` fournit un job Kubernetes `db-init` par défaut utilisant une image `postgres:15-alpine` qui crée la base de données et l'utilisateur dans Cloud SQL. Remplacez `initialization_jobs` par une liste non vide pour le remplacer par vos propres jobs.
5.  **GCS Fuse est utilisé pour les téléchargements de médias au lieu de NFS.** `enable_nfs` par défaut à `false`. Listmonk stocke les fichiers d'abonnés, les pièces jointes et les médias téléchargés via GCS Fuse, qui fournit un stockage d'objets durable sans nécessiter de volume NFS partagé.
6.  **Les valeurs par défaut des ressources sont dimensionnées pour Listmonk.** Les valeurs par défaut `cpu_limit` (`1000m`) et `memory_limit` (`512Mi`) sont appropriées pour les opérations de listes de diffusion de petite à moyenne taille. Augmentez `container_resources` pour les campagnes avec un grand nombre d'abonnés ou une utilisation élevée et concurrente de l'API.
7.  **L'affinité de session est par défaut `"ClientIP"`.** L'interface de gestion de campagne de Listmonk maintient l'état de session en cours de traitement. Sans affinité de session, l'interface utilisateur web peut perdre son état entre les requêtes lorsque plusieurs réplicas de pod sont en cours d'exécution. L'affinité de session par défaut `"ClientIP"` maintient chaque session de navigateur acheminée vers le même pod.
8.  **Redis n'est pas requis.** Listmonk n'utilise pas de couche de cache — `enable_redis` par défaut à `false`. Vous n'avez pas besoin d'une instance Memorystore pour exécuter Listmonk.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

**Variables Listmonk GKE dans ce groupe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(requis)* | ID du projet GCP. Aucune valeur par défaut — le déploiement échoue sans cette valeur. |
| `tenant_id` | `"demo"` | Suffixe ajouté aux noms de ressources pour distinguer plusieurs déploiements dans le même projet. |
| `support_users` | `[]` | Utilisateurs ayant un accès en lecture aux sorties de déploiement (par exemple, URL, noms de secrets). |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources GCP créées par ce module. |
| `region` | `"us-central1"` | Région GCP pour toutes les ressources. Utilisée comme emplacement par défaut du bucket de stockage et région du nœud GKE. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-3--application-identity) pour les descriptions.

**Valeurs par défaut spécifiques à Listmonk :**

| Variable | Valeur par défaut Listmonk GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"listmonk"` | `"gkeapp"` | Utilisé comme nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Listmonk"` | `"App GKE Application"` | Affiché dans l'interface utilisateur et les tableaux de bord de la plateforme. Peut être modifié librement. |
| `application_description` | `"Listmonk Newsletter Manager on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"latest"` | `"1.0.0"` | Le tag d'image Listmonk à déployer. L'utilisation de `"latest"` est acceptable pour le développement ; épinglez à une version spécifique (par exemple `"v4.1.0"`) pour la production afin d'assurer des déploiements reproductibles. |
| `admin_username` | `"listmonk"` | *(pas dans App GKE)* | Déclaré et transmis à `Listmonk_Common`, mais actuellement inutilisé là — le nom d'utilisateur super-administrateur initial est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`, quelle que soit la valeur de cette variable. |
| `deploy_application` | `true` | `true` | Défini sur `false` pour provisionner l'infrastructure sans déployer la charge de travail Listmonk — utile pour les déploiements échelonnés ou les actualisations d'infrastructure uniquement. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

**Valeurs par défaut et comportement spécifiques à Listmonk :**

| Variable | Valeur par défaut Listmonk GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `9000` | `8080` | Port HTTP natif de Listmonk. Ne pas modifier sauf si votre Dockerfile personnalisé lie Listmonk à un port différent. |
| `min_instance_count` | `1` | `1` | Au moins un pod est toujours en cours d'exécution — pas de mise à l'échelle à zéro sur GKE. Le planificateur de campagnes et les tâches d'importation d'abonnés de Listmonk nécessitent un processus en cours d'exécution continue. |
| `max_instance_count` | `3` | `3` | Suffisant pour la plupart des charges de travail de listes de diffusion. Augmenter pour une utilisation API très concurrente ou des scénarios d'importation d'abonnés en masse. |
| `container_image` | `"listmonk/listmonk:latest"` | *(aucun)* | Image Docker Hub officielle de Listmonk. Remplacer par une image privée d'Artifact Registry lorsque `container_image_source = "custom"`. |
| `container_image_source` | `"custom"` | `"custom"` | Par défaut à une build personnalisée pour permettre une configuration spécifique à l'environnement via les variables d'environnement `LISTMONK_*` intégrées à l'image. Définir sur `"prebuilt"` pour déployer directement l'image Docker Hub officielle. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy monte un socket Unix que Listmonk utilise pour se connecter à Cloud SQL sans exposer les identifiants de base de données sur le réseau. Ne désactiver que si vous vous connectez à Cloud SQL via une connexion TCP privée directe. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | `"/cloudsql"` | Chemin à l'intérieur du conteneur où le socket Cloud SQL Auth Proxy est monté. |

**`container_resources` :** La valeur par défaut de la variable est `{ cpu_limit = "1000m", memory_limit = "512Mi" }`. Cela convient pour le développement et les petites listes d'abonnés. Pour les déploiements de production envoyant des campagnes à des dizaines de milliers d'abonnés, augmentez à au moins `{ cpu_limit = "2000m", memory_limit = "1Gi" }` pour éviter les arrêts OOM lors des opérations d'envoi de campagnes en masse.

Les variables d'exécution restantes (`enable_image_mirroring`, `container_build_config`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy), [App_GKE](./App_GKE.md#group-19--access--networking) et [App_GKE](./App_GKE.md#group-21--cloud-armor--cdn).

Les variables réseau suivantes sont disponibles dans `Listmonk GKE` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `"LoadBalancer"` | Type de service Kubernetes. `"LoadBalancer"` provisionne un équilibreur de charge externe GCP. Utilisez `"ClusterIP"` avec `enable_custom_domain = true` pour le routage basé sur la passerelle. |
| `enable_network_segmentation` | `false` | Déploie une NetworkPolicy Kubernetes restreignant le trafic pod-à-pod aux chemins explicitement autorisés. |
| `namespace_name` | `""` | Espace de noms Kubernetes pour la charge de travail Listmonk. Auto-généré à partir de `application_name` et `tenant_id` lorsqu'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. |
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google ayant accès à IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration IAP. |
| `iap_support_email` | `""` | E-mail de support affiché sur l'écran de consentement Google OAuth. |
| `enable_custom_domain` | `true` | Configure Ingress/Gateway pour le routage de domaine personnalisé avec des certificats SSL gérés. Activé par défaut. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple `["listmonk.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; auto-généré si vide. |
| `enable_cloud_armor` | `false` | Active une politique de sécurité Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées via Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_cdn` | `false` | Active Cloud CDN sur le service backend. Nécessite le chemin de routage Gateway (`enable_custom_domain = true`). |
| `enable_vpc_sc` | `false` | Active l'application du périmètre des contrôles de service VPC. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR pour les règles d'égression VPC-SC. |
| `vpc_sc_dry_run` | `true` | Exécute VPC-SC en mode simulation (audit uniquement) avant l'application. |
| `organization_id` | `""` | Remplacement de l'ID d'organisation GCP. Requis uniquement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud pour l'activité VPC-SC. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Valeurs par défaut spécifiques à Listmonk :**

`Listmonk Common` injecte automatiquement la configuration de connexion à la base de données dans le conteneur via les variables d'environnement `LISTMONK_*`. Vous n'avez pas besoin de définir manuellement les chaînes de connexion à la base de données. Les secrets suivants sont créés et injectés automatiquement :

| Variable d'environnement secrète | Objectif |
|---|---|
| `LISTMONK_ADMIN_PASSWORD` | Mot de passe administrateur généré aléatoirement pour l'interface utilisateur web de Listmonk (le nom d'utilisateur est le `admin` codé en dur). Récupérez-le de Secret Manager après le déploiement pour vous connecter pour la première fois. |
| `LISTMONK_API_TOKEN` | Jeton API déterministe pour l'utilisateur API programmatique auto-réparateur (`LISTMONK_API_USER`, par défaut `rad-api`), réaffirmé dans la base de données à chaque démarrage. |

Des variables d'environnement `LISTMONK_*` supplémentaires (par exemple, la configuration SMTP pour les e-mails transactionnels) peuvent être ajoutées via `environment_variables`. La configuration de Listmonk utilise une notation hiérarchique à double underscore (`__`) :

```hcl
environment_variables = {
  LISTMONK_smtp__host     = "smtp.mailgun.org"
  LISTMONK_smtp__port     = "587"
  LISTMONK_smtp__username = "postmaster@mg.example.com"
  LISTMONK_smtp__password = "your-smtp-password"
  LISTMONK_smtp__tls_type = "STARTTLS"
}
```

Les variables de secrets restantes (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-17--backup--maintenance).

**Valeurs par défaut spécifiques à Listmonk :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajustez pour correspondre à votre objectif de point de récupération. Les bases de données Listmonk augmentent régulièrement avec les enregistrements d'abonnés et de campagnes — planifiez les sauvegardes pendant les périodes de faible trafic. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez à plus de 30 jours pour les déploiements de production avec des listes d'abonnés actives. |

**Importation de sauvegarde** — Listmonk GKE prend en charge l'importation d'une sauvegarde existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'importation unique pendant le déploiement pour restaurer la sauvegarde spécifiée par `backup_source` et `backup_file`. Configurez avant d'activer. |
| `backup_source` | `"gcs"` | Système source pour le fichier de sauvegarde. `"gcs"` importe à partir d'un URI Cloud Storage ; `"gdrive"` importe à partir d'un ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom de fichier d'une sauvegarde stockée dans le bucket GCS de sauvegardes créé automatiquement par le module. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

Les variables CI/CD suivantes sont disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config` (par défaut `{ branch_pattern = "^main$" }`), `enable_cloud_deploy`, `cloud_deploy_stages` (par défaut `[dev, staging, prod]`), `enable_binary_authorization`, `binauthz_evaluation_mode` (par défaut `"ALWAYS_ALLOW"` ; options : `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`).

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation), avec un comportement important spécifique à Listmonk.

**Job `db-init` par défaut de Listmonk :**

Lorsque `initialization_jobs` est laissé à sa valeur par défaut (liste vide `[]`), `Listmonk Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | `postgres:15-alpine` |
| Objectif | Crée la base de données et l'utilisateur PostgreSQL de Listmonk dans l'instance Cloud SQL |
| Exécuter à chaque apply | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |

Remplacez `initialization_jobs` par une liste non vide pour remplacer cette valeur par défaut par vos propres jobs. Chaque job personnalisé doit spécifier au moins l'un des `command`, `args` ou `script_path`.

> **Migrations de schéma :** Contrairement à certaines applications, Listmonk ne nécessite pas de job d'initialisation de schéma séparé. Le binaire de Listmonk détecte une nouvelle base de données et applique la migration complète du schéma au premier démarrage. Le job `db-init` n'a besoin que de créer la base de données et l'utilisateur — Listmonk gère le reste.

**CronJobs et services supplémentaires :**

Les variables `cron_jobs` et `additional_services` sont disponibles et se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-11--workload-automation) pour une documentation complète.

> **Note :** Le schéma `cron_jobs` dans `Listmonk GKE` utilise les champs CronJob de Kubernetes — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend` — plutôt que les champs de style Cloud Run. Le champ `secret_env_vars` n'est pas disponible dans les cron jobs GKE ; les secrets sont gérés via `secret_environment_variables` au niveau du module.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-13--nfs-storage).

**Valeurs par défaut spécifiques à Listmonk :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. Listmonk utilise GCS Fuse pour le stockage des médias et des pièces jointes plutôt qu'un volume NFS partagé. N'activez NFS que si votre déploiement nécessite un système de fichiers POSIX partagé sur tous les pods pour des raisons indépendantes des besoins de stockage propres à Listmonk. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin où le volume NFS est monté si NFS est activé. Non utilisé par défaut. |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom d'une instance Filestore existante à utiliser. Auto-découvert si vide. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base de l'instance Filestore lors de la création d'une nouvelle instance. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

**Valeurs par défaut spécifiques à Listmonk :**

`Listmonk Common` provisionne automatiquement un bucket GCS pour le stockage des médias et des pièces jointes de Listmonk via GCS Fuse. Ce bucket est monté dans le conteneur à un chemin que Listmonk utilise pour les fichiers téléchargés. Vous n'avez pas besoin de le définir manuellement dans `storage_buckets`.

| Bucket | `name_suffix` | Objectif |
|---|---|---|
| Auto-provisionné | `listmonk-uploads` | Médias téléchargés par Listmonk, fichiers d'importation d'abonnés et pièces jointes de campagne via le pilote CSI GCS Fuse |

Des buckets GCS supplémentaires peuvent être définis dans `storage_buckets` — par exemple, un bucket séparé pour les exportations de sauvegarde ou les ressources de modèles personnalisés.

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` se comportent comme décrit dans [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-16--database-configuration).

**Valeurs par défaut et restrictions spécifiques à Listmonk :**

| Variable | Valeur par défaut Listmonk GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | **Listmonk nécessite PostgreSQL.** Ne changez pas cela pour une variante MySQL — Listmonk ne prend en charge que PostgreSQL et échouera au démarrage avec une erreur de base de données non prise en charge. |
| `application_database_name` | `"listmonk"` | `"gkeappdb"` | Le nom de la base de données PostgreSQL créée dans l'instance Cloud SQL. **Ne pas modifier après le déploiement** — la modification recrée la base de données et détruit toutes les données Listmonk. |
| `application_database_user` | `"listmonk"` | `"gkeappuser"` | L'utilisateur PostgreSQL que Listmonk utilise pour se connecter. **Ne pas modifier après le déploiement** — la modification recrée l'utilisateur et invalide toutes les informations d'identification existantes. |
| `database_password_length` | `32` | `32` | Longueur du mot de passe de base de données auto-généré. Des mots de passe plus longs améliorent la sécurité ; 32 caractères conviennent pour la production. |
| `enable_postgres_extensions` | `false` | `false` | Listmonk ne nécessite aucune extension PostgreSQL supplémentaire au-delà des valeurs par défaut. N'activez que si vous ajoutez des fonctionnalités de base de données personnalisées. |

> **Important :** Listmonk applique automatiquement les migrations de schéma au démarrage. Le premier démarrage après un nouveau déploiement prendra légèrement plus de temps que les démarrages ultérieurs, car le schéma complet est créé. La sonde de démarrage est configurée avec un délai initial de 30 secondes pour tenir compte de cela.

**Découverte d'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloudsql_volume` | `true` | Monte le socket Unix du proxy d'authentification Cloud SQL à l'intérieur du conteneur. Requis pour que Listmonk se connecte à Cloud SQL via le chemin du socket. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Chemin où le socket du proxy d'authentification est monté à l'intérieur du conteneur Listmonk. |

**La rotation automatique des mots de passe** est également prise en charge :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job de rotation automatique du mot de passe de la base de données. Lorsque `true`, le mot de passe de la base de données est tourné selon le calendrier défini par `secret_rotation_period` et les pods GKE sont redémarrés pour prendre en compte les nouvelles informations d'identification. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods, pour permettre la réplication de Secret Manager. |

---

## Groupe 12 : Scripts SQL personnalisés {#group-12-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-18--custom-sql-scripts).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Exécute des scripts SQL personnalisés à partir d'un bucket GCS pendant le déploiement. Utile pour initialiser Listmonk avec des définitions de listes, des modèles ou des segments d'abonnés. |
| `custom_sql_scripts_bucket` | `""` | Bucket GCS contenant les scripts SQL à exécuter. |
| `custom_sql_scripts_path` | `""` | Préfixe de chemin dans le bucket pour les fichiers de script SQL. |
| `custom_sql_scripts_use_root` | `false` | Exécute des scripts SQL personnalisés en tant qu'utilisateur root Cloud SQL au lieu de l'utilisateur de l'application. Requis pour les scripts qui créent des extensions ou modifient des paramètres au niveau du système. |

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-10--observability).

**Valeurs par défaut spécifiques à Listmonk :**

Listmonk expose un point de terminaison HTTP dédié `/api/health`, mais à partir de Listmonk v6.1.0, il est derrière une authentification de session et renvoie `403 {"message":"invalid session"}` à une requête non authentifiée — donc une sonde HTTP contre celui-ci ne passe jamais. `Listmonk_GKE` utilise donc des sondes **TCP** sur le port 9000 par défaut (Kubernetes prend en charge `tcpSocket` pour les sondes de démarrage et de vivacité, contrairement à Cloud Run qui interdit une sonde de vivacité TCP). Le point de terminaison non authentifié `/health` (sans préfixe `/api`) renvoie bien 200, mais n'est pas câblé comme sonde par défaut.

**Valeurs par défaut des sondes de santé :**

| Variable | Valeur par défaut Listmonk | Notes |
|---|---|---|
| `health_check_config` | `{ enabled = true, type = "TCP", path = "/api/health", initial_delay_seconds = 30, period_seconds = 30, failure_threshold = 3 }` | Sonde de vivacité Kubernetes. Vérification TCP sur le port 9000 — le champ `path` est conservé dans le schéma mais inutilisé pour une vérification TCP. |
| `startup_probe_config` | `{ enabled = true, type = "TCP", path = "/api/health", initial_delay_seconds = 30, period_seconds = 10, failure_threshold = 30 }` | Sonde de démarrage Kubernetes. `failure_threshold = 30` donne à Listmonk jusqu'à 300 secondes (30 × 10 s) pour démarrer avant que Kubernetes ne redémarre le pod — suffisant même pour les migrations de schéma à froid. |
| `uptime_check_config` | `{ enabled = false, path = "/api/health" }` | Test de disponibilité Cloud Monitoring. **Désactivé par défaut** — activez-le explicitement si vous souhaitez qu'une alerte soit déclenchée vers `support_users` lorsque le point de terminaison cesse de répondre (notez que `/api/health` nécessite une session, donc un test de disponibilité HTTP devrait cibler `/health` à la place). |

La variable `alert_policies` est disponible et se comporte comme décrit dans [App_GKE](./App_GKE.md#group-10--observability).

---

## Groupe 14 : Politiques de fiabilité {#group-14-reliability-policies}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-9--reliability).

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Empêche tous les pods Listmonk d'être interrompus simultanément lors des mises à niveau des nœuds GKE. Fortement recommandé pour les déploiements de production. |
| `pdb_min_available` | `"1"` | Au moins un pod reste disponible pendant les interruptions volontaires. Avec un déploiement à réplica unique, cela bloque les opérations de drainage des nœuds — utilisez au moins 2 réplicas en production pour permettre une maintenance continue. |

Variables supplémentaires : `enable_topology_spread`, `topology_spread_strict`.

---

## Groupe 15 : Cache Redis {#group-15-redis-cache}

Ces variables configurent l'intégration optionnelle de Redis. Listmonk n'utilise **pas** Redis dans le cadre de son architecture principale — `enable_redis` est par défaut `false` et Redis n'est pas nécessaire pour exécuter Listmonk.

> **Note :** Redis est désactivé par défaut dans `Listmonk GKE`. Contrairement aux applications qui utilisent Redis pour la mise en cache de pages, Listmonk effectue toute la planification des campagnes et la gestion des abonnés en interne sans couche de cache. N'activez Redis que si vous avez un cas d'utilisation d'intégration spécifique, tel qu'un plugin personnalisé ou une file d'attente de tâches externe.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | Désactivé par défaut. Listmonk ne nécessite pas Redis. Activez-le uniquement si une intégration personnalisée ou un service sidecar dans votre déploiement consomme Redis. Lorsqu'il est activé et que `redis_host` est vide, le module utilise par défaut l'adresse IP du serveur NFS — assurez-vous de `enable_nfs = true` ou fournissez une `redis_host` explicite. |
| `redis_host` | `""` | Nom d'hôte ou adresse IP | Le nom d'hôte ou l'adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS découverte automatiquement lorsque Redis est activé. Remplacez par un hôte dédié pour une instance Google Cloud Memorystore. |
| `redis_port` | `"6379"` | Chaîne de numéro de port | Port Redis standard. Ne modifiez que si votre instance Redis est sur un port non standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification pour le serveur Redis. Laissez vide pour un Redis non authentifié. Pour Memorystore avec AUTH activé, définissez-le sur la chaîne AUTH de l'instance. |

### Validation des paramètres du groupe 15 {#validating-group-15-settings}

**Console Google Cloud :**
- **Instance Memorystore (si utilisée) :** Accédez à **Memorystore → Redis** pour confirmer que l'instance existe, son adresse IP, son port et son statut AUTH.
- **Variables d'environnement Redis dans le pod :** Confirmez que la variable d'environnement `REDIS_HOST` est présente dans l'environnement du pod Listmonk si Redis a été activé.

**CLI gcloud / kubectl :**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm any Redis environment variables are set in the Listmonk pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i redis

# Test Redis connectivity from inside the Listmonk pod (if enabled)
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379
```

---

## Groupe 16 : Domaine personnalisé et IP statique {#group-16-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking).

> **Configuration de l'URL de base de Listmonk :** Listmonk doit connaître son URL publique pour générer des liens de désabonnement, des e-mails de confirmation et des pixels de suivi de campagne. Ce n'est **pas** une variable d'environnement — `app.root_url` est une ligne dans la table `settings` de Listmonk, donc `Listmonk_Common`'s `entrypoint.sh` la définit automatiquement à chaque démarrage à partir de la `GKE_SERVICE_URL` injectée par la plateforme, après l'étape `--install` (en utilisant `psql`, puisque `--install` ne l'initialise que via `INSERT ... ON CONFLICT DO NOTHING`, donc l'entrée `UPDATE` l'emporte toujours lors des démarrages ultérieurs). Si vous attachez un domaine personnalisé via `application_domains`, vérifiez `app.root_url` sous **Settings → General** dans l'interface utilisateur de Listmonk et mettez-le à jour manuellement s'il affiche toujours l'URL du service GKE au lieu de votre domaine personnalisé.

---

## Groupe 17 : Configuration du backend GKE {#group-17-gke-backend-configuration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-6--gke-backend-config).

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds` (par défaut `30`), `gke_cluster_selection_mode` (par défaut `"primary"` ; options : `explicit`, `round-robin`, `primary`), `network_name` (par défaut `""` ; découverte automatique si vide).

> **Note sur l'affinité de session :** `session_affinity` est par défaut `"ClientIP"` dans Listmonk GKE. C'est essentiel pour l'interface de gestion de campagne de Listmonk : sans affinité de session, l'interface utilisateur web de Listmonk peut perdre l'état d'édition de campagne entre les chargements de page lorsque les requêtes sont acheminées vers différentes répliques de pods. Conservez `"ClientIP"` pour tout déploiement Listmonk GKE multi-réplicas.

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#group-7--statefulset--pvc) (`workload_type = "StatefulSet"`) et les variables StatefulSet associées.

Variables disponibles : `stateful_pvc_enabled` (par défaut `null`), `stateful_pvc_size` (par défaut `"10Gi"`), `stateful_pvc_mount_path` (par défaut `"/data"`), `stateful_pvc_storage_class` (par défaut `"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group` (par défaut `0`).

> **Sélection automatique de StatefulSet :** Définir `stateful_pvc_enabled = true` sans `workload_type` explicite se résout automatiquement en `"StatefulSet"`. Définir `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` échoue au moment de la planification.

Listmonk stocke tout l'état persistant dans PostgreSQL plutôt que sur un disque local, donc `stateful_pvc_enabled` n'est pas requis pour un fonctionnement normal. N'activez les PVC StatefulSet que si votre déploiement nécessite un système de fichiers local stable — par exemple, pour les données de plugins personnalisés ou les tampons de file d'attente locaux.

---

## Sorties du module {#module-outputs}

`Listmonk GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `service_url` | URL du service |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID de déploiement |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données de l'application |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — le cluster est créé mais le point de terminaison n'est pas encore lisible, donc les ressources Kubernetes sont ignorées. Le pipeline CI/CD doit réexécuter apply pour terminer le déploiement. |

---

## Exploration avec la console GCP {#exploring-with-the-gcp-console}

Une fois votre déploiement Listmonk GKE terminé, la console GCP offre une vue riche de chaque couche du déploiement. Cette section passe en revue chaque zone et explique ce qu'il faut rechercher.

### Charges de travail GKE {#gke-workloads}

Accédez à **Kubernetes Engine → Workloads** dans la console GCP. Sélectionnez votre cluster dans la liste déroulante des clusters.

- **Déploiement Listmonk :** Vous devriez voir un déploiement nommé `listmonk-<tenant_id>` dans l'espace de noms `listmonk-<tenant_id>`. La colonne **Pods** devrait afficher au moins `1/1` pods en cours d'exécution si `min_instance_count = 1`. Accédez au déploiement pour voir le modèle de pod, les variables d'environnement (y compris la configuration `LISTMONK_*`), les requêtes et limites de ressources, et le conteneur sidecar Cloud SQL Auth Proxy.
- **Job db-init :** Lors du premier déploiement, un job terminé nommé `db-init` apparaîtra dans le même espace de noms sous **Kubernetes Engine → Workloads** (filtrer par type de ressource : Job). Une coche verte indique que la base de données et l'utilisateur PostgreSQL ont été créés avec succès. Si le job affiche un état d'échec rouge, cliquez sur les logs du pod du job pour diagnostiquer le problème de connexion ou d'authentification Cloud SQL.
- **Pods :** Accédez à **Kubernetes Engine → Pods** et filtrez par espace de noms. Chaque pod en cours d'exécution affiche deux conteneurs : le conteneur de l'application Listmonk (`listmonk`) et le sidecar Cloud SQL Auth Proxy (`cloud-sql-proxy`). Cliquez sur un pod et sélectionnez l'onglet **Logs** pour diffuser les logs de l'application en direct directement depuis la console.
- **Services et Ingress :** Accédez à **Kubernetes Engine → Services & Ingress**. Le service LoadBalancer pour Listmonk apparaîtra avec une colonne **External endpoints** affichant l'adresse IP et le port provisionnés. Si `enable_custom_domain = true`, une ressource Gateway ou Ingress apparaîtra à côté.

### Cloud SQL {#cloud-sql}

Accédez à **SQL** dans la console GCP.

- **Instance :** L'instance Cloud SQL est généralement nommée `app-sql-<tenant_id>` (ou un nom personnalisé si `sql_instance_name` a été défini). Cliquez sur l'instance pour vérifier que sa version de base de données affiche **PostgreSQL 15**. L'onglet **Overview** affiche l'utilisation du CPU et de la mémoire, les connexions actives et le débit des requêtes — utile pour valider que Listmonk se connecte et envoie des requêtes.
- **Bases de données :** Sous l'onglet **Databases** de l'instance, confirmez que la base de données `listmonk` existe (ou votre `application_database_name` personnalisé). C'est la base de données que la migration de schéma de Listmonk a créée au premier démarrage.
- **Utilisateurs :** Sous l'onglet **Users**, confirmez que l'utilisateur `listmonk` (ou votre `application_database_user`) existe. Listmonk se connecte en tant que cet utilisateur pour toutes les opérations de base de données.
- **Connexions :** Sous l'onglet **Connections**, confirmez que l'instance est configurée pour l'IP privée uniquement (si vous utilisez la connectivité VPC-native) ou que le Cloud SQL Auth Proxy est le seul chemin de connexion. La connexion Auth Proxy depuis le cluster GKE apparaîtra dans le panneau **Active connections**.
- **Sauvegardes :** Sous l'onglet **Backups**, confirmez que les sauvegardes automatisées sont activées et que la sauvegarde la plus récente s'est terminée avec succès. Le calendrier de sauvegarde suit `backup_schedule` (par défaut `0 2 * * *`).

### Secret Manager {#secret-manager}

Accédez à **Security → Secret Manager** dans la console GCP.

- **Mot de passe de la base de données :** Un secret nommé `secret-<resource_prefix>-<app>-db-password` (ou similaire, géré par Foundation) contient l'identifiant de base de données auto-généré. Cliquez sur le secret et accédez à **Versions** pour confirmer qu'une version `ENABLED` actuelle existe. Ne désactivez pas ou ne détruisez pas cette version — elle est montée dans le pod Listmonk au moment de l'exécution.
- **Mot de passe administrateur :** Un secret nommé `secret-<resource_prefix>-listmonk-admin-password` (injecté comme `LISTMONK_ADMIN_PASSWORD`) contient le mot de passe de l'interface utilisateur d'administration Listmonk généré aléatoirement (le nom d'utilisateur est le `admin` codé en dur). Cliquez sur la dernière version et utilisez **Access secret value** pour récupérer le mot de passe de votre première connexion. Stockez immédiatement cet identifiant dans un gestionnaire de mots de passe.
- **Jeton API :** Un secret nommé `secret-<resource_prefix>-listmonk-api-token` (injecté comme `LISTMONK_API_TOKEN`) contient le jeton API déterministe pour l'utilisateur API programmatique auto-réparateur.
- **Journal d'accès :** L'onglet **Access log** de chaque secret affiche un journal d'audit Cloud de chaque fois qu'une version a été consultée, par quel compte de service et depuis quelle IP. Vérifiez que seul le compte de service d'identité de charge de travail Listmonk accède au secret du mot de passe de la base de données.

### Artifact Registry {#artifact-registry}

Accédez à **Artifact Registry → Repositories** dans la console GCP.

- **Dépôt :** Si `container_image_source = "custom"` et `enable_image_mirroring = true`, un dépôt nommé d'après le déploiement (par exemple `listmonk-<tenant_id>`) contiendra l'image Listmonk construite. Le dépôt affichera le tag de l'image (correspondant à `application_version`) et le digest.
- **Détails de l'image :** Cliquez sur un tag d'image pour afficher le digest complet, la taille, l'heure de création et les résultats de l'analyse des vulnérabilités. Examinez l'onglet des résultats des vulnérabilités avant de passer en production — l'image de base de Listmonk est régulièrement mise à jour, et la politique de rétention de la plateforme (`max_images_to_retain = 7`) nettoiera automatiquement les anciennes versions d'images.
- **Politiques de nettoyage :** Sous l'onglet **Settings** du dépôt, confirmez que la politique de nettoyage est configurée pour conserver les `max_images_to_retain` dernières images et supprimer les images non taguées après `image_retention_days` jours.

### Cloud Monitoring {#cloud-monitoring}

Accédez à **Monitoring → Dashboards** ou **Monitoring → Uptime checks** dans la console GCP.

- **Tests de disponibilité :** `uptime_check_config.enabled` est par défaut `false`. S'il est explicitement activé, un test de disponibilité ciblant `GET /api/health` sur le point de terminaison du service Listmonk apparaîtra (notez que ce chemin renvoie 403 non authentifié — ciblez `/health` à la place pour un contrôle significatif). Un indicateur d'état vert confirme que le point de terminaison répond. Un état rouge ou jaune déclenche une alerte vers `support_users`.
- **Politiques d'alerte :** Accédez à **Monitoring → Alerting**. Deux politiques d'alerte sont provisionnées automatiquement : une pour les échecs de test de disponibilité et une pour le seuil d'échec de vérification. Cliquez sur chaque politique pour confirmer que les canaux de notification (adresses e-mail de `support_users`) sont configurés correctement.
- **Explorateur de métriques :** Accédez à **Monitoring → Metrics Explorer** et interrogez `kubernetes.io/container/cpu/request_utilisation` et `kubernetes.io/container/memory/used_bytes` pour le conteneur `listmonk` dans votre espace de noms. Comparez avec les `cpu_limit` configurés (`1000m`) et `memory_limit` (`512Mi`) pour valider le dimensionnement des ressources pendant les envois de campagnes actives.
- **Vue d'ensemble du cluster GKE :** Accédez à **Kubernetes Engine → Clusters**, cliquez sur votre cluster et sélectionnez l'onglet **Observability** pour voir l'utilisation du CPU et de la mémoire au niveau des nœuds. GKE Autopilot provisionne des nœuds à la demande — lors d'un envoi de campagne important, vous pouvez voir un événement de provisionnement de nœud lorsque les exigences de ressources des pods augmentent temporairement.

### Cloud Build (si CI/CD activé) {#cloud-build-if-cicd-enabled}

Accédez à **Cloud Build → History** dans la console GCP.

- **Historique des builds :** Chaque push vers la branche correspondant à `cicd_trigger_config.branch_pattern` (par défaut `^main$`) déclenche un build. Les builds sont listés avec le statut, la durée et le commit déclencheur. Cliquez sur un build pour afficher le journal étape par étape, y compris la construction de l'image, le push vers Artifact Registry et le déclencheur de déploiement optionnel.
- **Déclencheurs :** Accédez à **Cloud Build → Triggers** pour confirmer que le déclencheur est connecté au bon dépôt GitHub et au bon modèle de branche.

---

## Exploration avec gcloud / kubectl {#exploring-with-gcloud--kubectl}

Les commandes suivantes vous permettent d'inspecter chaque couche d'un déploiement Listmonk GKE depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION`, `CLUSTER_NAME`, `NAMESPACE` et `POD_NAME` par vos valeurs réelles. L'espace de noms et le nom du déploiement sont généralement `listmonk-<tenant_id>`.

```bash
# ── Cluster Access ──────────────────────────────────────────────────────────

# Fetch GKE cluster credentials and set the local kubeconfig context
gcloud container clusters get-credentials CLUSTER_NAME \
  --region REGION \
  --project PROJECT_ID

# List all GKE clusters in the project to find the correct cluster name
gcloud container clusters list \
  --project PROJECT_ID \
  --format="table(name,location,status,currentNodeCount)"

# ── Namespace & Workload Overview ────────────────────────────────────────────

# List all pods in the Listmonk namespace and their status
kubectl get pods -n NAMESPACE -o wide

# Show full details of the Listmonk Deployment (replicas, strategy, conditions)
kubectl describe deployment listmonk-DEPLOYMENT_ID -n NAMESPACE

# Watch pods in real time during a rolling update or new deployment
kubectl get pods -n NAMESPACE --watch

# ── Pod Logs ─────────────────────────────────────────────────────────────────

# Tail live logs from the Listmonk application container
kubectl logs -n NAMESPACE POD_NAME -c listmonk --follow

# Show the last 100 lines from the Cloud SQL Auth Proxy sidecar container
kubectl logs -n NAMESPACE POD_NAME -c cloud-sql-proxy --tail=100

# Show logs from all Listmonk pods simultaneously (useful after a campaign send)
kubectl logs -n NAMESPACE -l app=listmonk --all-containers=true --follow

# ── Container Environment & Health ───────────────────────────────────────────

# List all environment variables inside the Listmonk container (confirm LISTMONK_* vars)
kubectl exec -n NAMESPACE POD_NAME -c listmonk -- env | grep LISTMONK

# Confirm the Cloud SQL Auth Proxy socket is present inside the container
kubectl exec -n NAMESPACE POD_NAME -c listmonk -- ls -la /cloudsql/

# Test the Listmonk health endpoint from inside the container
kubectl exec -n NAMESPACE POD_NAME -c listmonk -- \
  wget -qO- http://localhost:9000/api/health

# ── Services & Networking ─────────────────────────────────────────────────────

# Show the Listmonk Kubernetes Service and its external IP
kubectl get service -n NAMESPACE

# Describe the LoadBalancer service to see provisioned IP and port mappings
kubectl describe service listmonk-DEPLOYMENT_ID -n NAMESPACE

# ── Initialization Jobs ───────────────────────────────────────────────────────

# List all Jobs in the namespace (including the db-init job)
kubectl get jobs -n NAMESPACE

# Show the logs from the db-init job pod to confirm successful DB creation
kubectl logs -n NAMESPACE -l job-name=db-init

# ── Cloud SQL ─────────────────────────────────────────────────────────────────

# List Cloud SQL instances in the project
gcloud sql instances list \
  --project PROJECT_ID \
  --format="table(name,databaseVersion,region,state,ipAddresses[0].ipAddress)"

# Describe the Listmonk Cloud SQL instance
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project PROJECT_ID \
  --format="yaml(name,databaseVersion,state,settings.backupConfiguration)"

# List databases on the Cloud SQL instance
gcloud sql databases list \
  --instance SQL_INSTANCE_NAME \
  --project PROJECT_ID

# List users on the Cloud SQL instance
gcloud sql users list \
  --instance SQL_INSTANCE_NAME \
  --project PROJECT_ID

# ── Secret Manager ────────────────────────────────────────────────────────────

# List all secrets with the listmonk deployment prefix
gcloud secrets list \
  --project PROJECT_ID \
  --filter="name:listmonk" \
  --format="table(name,createTime,replication.automatic)"

# Access the Listmonk admin password secret value (first login)
gcloud secrets versions access latest \
  --secret="secret-RESOURCE_PREFIX-listmonk-admin-password" \
  --project PROJECT_ID

# Check secret version status (confirm the latest version is ENABLED)
gcloud secrets versions list LISTMONK_DB_PASSWORD_SECRET_NAME \
  --project PROJECT_ID \
  --format="table(name,state,createTime)"

# ── GCS Storage ───────────────────────────────────────────────────────────────

# List GCS buckets created for this Listmonk deployment
gsutil ls -p PROJECT_ID | grep listmonk

# Show the contents of the Listmonk uploads bucket
gsutil ls gs://LISTMONK_UPLOADS_BUCKET_NAME/

# ── Resource Usage ────────────────────────────────────────────────────────────

# Show live CPU and memory usage for all pods in the namespace
kubectl top pods -n NAMESPACE

# Show node-level resource usage for the GKE Autopilot cluster
kubectl top nodes
```

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | *(requis)* | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Listmonk ne prend en charge que PostgreSQL. Le passage à une variante MySQL entraîne l'échec de Listmonk au démarrage avec une erreur de pilote de base de données. Toutes les injections d'identifiants et l'assemblage de chaînes de connexion supposent PostgreSQL. |
| `application_database_name` | `"listmonk"` | **Critique** | Immuable après le déploiement — la modification recrée la base de données et détruit tous les abonnés, campagnes, listes et modèles. |
| `application_database_user` | `"listmonk"` | **Critique** | Immuable après le déploiement — la modification recrée l'utilisateur, invalide l'identifiant stocké et interrompt la connexion de Listmonk à la base de données. |
| `container_port` | `9000` | **Critique** | Listmonk écoute sur le port 9000. La modification sans faire correspondre le port lié du conteneur entraîne l'échec de toutes les sondes de santé et le pod entre dans une boucle de crash. |
| `health_check_config.type` / `startup_probe_config.type` | `"TCP"` | **Critique** | Les deux sont par défaut une vérification TCP sur le port 9000, pas HTTP. Le passage à `"HTTP"` contre `/api/health` fera échouer chaque sonde — ce point de terminaison nécessite une session authentifiée et renvoie 403 au kubelet, provoquant une boucle de redémarrage permanente. |
| `startup_probe_config.failure_threshold` | `30` | **Élevé** | Listmonk exécute des migrations de schéma au premier démarrage. La réduction de cette valeur en dessous de ~10 peut entraîner le redémarrage du pod par Kubernetes avant la fin des migrations, créant une boucle de redémarrage infinie sur les nouveaux déploiements. |
| `session_affinity` | `"ClientIP"` | **Élevé** | L'interface de gestion de campagne de Listmonk stocke l'état en mémoire par processus. Sans affinité de session `"ClientIP"`, l'interface utilisateur web perd l'état d'édition de campagne à chaque chargement de page qui est acheminé vers une réplique de pod différente. |
| `container_resources.memory_limit` | `"512Mi"` | **Moyen** | Suffisant pour les petites listes au repos. Lors des importations d'abonnés en masse ou des envois de campagnes importantes, l'utilisation de la mémoire augmente. Augmentez à au moins `"1Gi"` pour les listes de plus de 50 000 abonnés. |
| `container_resources.cpu_limit` | `"1000m"` | **Moyen** | Suffisant pour un fonctionnement normal de Listmonk. Les envois de campagnes à haute fréquence vers de grandes listes sont limités par le CPU — envisagez d'augmenter à `"2000m"` pour les charges de travail d'envoi actives. |
| `min_instance_count` | `1` | **Élevé** | Définir sur `0` active la mise à l'échelle à zéro, ce qui ne convient pas à Listmonk. Le planificateur de campagne et le gestionnaire de rebonds nécessitent un processus en cours d'exécution continue. Les démarrages à froid lors de la mise à l'échelle retardent les envois de campagnes en attente. |
| `enable_nfs` | `false` | **Faible** | Listmonk utilise GCS Fuse pour le stockage, pas NFS. L'activation de NFS provisionne inutilement une instance Filestore et entraîne des coûts supplémentaires sans avantage pour Listmonk. |
| `enable_redis` | `false` | **Faible** | Listmonk n'utilise pas Redis. L'activer sans un `redis_host` valide peut entraîner la tentative de connexion du module à l'adresse IP du serveur NFS sur le port 6379, générant des erreurs de connexion si aucun processus Redis n'y est en cours d'exécution. |
| `application_version` | `"latest"` | **Moyen** | L'utilisation de `"latest"` pour la production n'est pas recommandée — cela rend les déploiements non reproductibles et peut introduire des changements cassants lorsque l'image amont est mise à jour. Épinglez à un tag de version spécifique (par exemple `"v4.1.0"`) pour la production. |
| `backup_retention_days` | `7` | **Moyen** | Trop court pour les listes de diffusion actives. Une importation d'abonné corrompue ou une suppression accidentelle de liste peut ne pas être découverte dans les 7 jours. Augmentez à 30 jours et plus pour la production. |
| `enable_pod_disruption_budget` | `true` | **Moyen** | Déjà activé. La désactivation permet à tous les pods Listmonk d'être terminés simultanément lors des mises à niveau des nœuds GKE, ce qui entraîne une interruption de service pour les envois de campagnes en cours. |
| `pdb_min_available` | `"1"` | **Moyen** | Avec un réplica unique, PDB empêche le drainage volontaire des nœuds indéfiniment. Utilisez au moins 2 réplicas en production pour permettre une maintenance continue sans bloquer les mises à niveau du cluster. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers nus sont traités comme des octets par Kubernetes et empêchent tous les pods d'être planifiés dans l'espace de noms. |
| `termination_grace_period_seconds` | `30` | **Moyen** | Listmonk traite les requêtes en cours et peut avoir des goroutines d'envoi de campagne actives à l'arrêt. Si Listmonk est en cours d'envoi d'un grand lot de campagnes, 30 secondes peuvent ne pas suffire pour vider la file d'attente. Envisagez d'augmenter à `60` ou `120` pour les charges de travail d'envoi à grand volume. |
| `enable_auto_password_rotation` | `false` | **Faible** | Désactivé par défaut. Lorsqu'il est activé, la rotation redémarre tous les pods Listmonk. Planifiez les rotations pendant les fenêtres de maintenance pour éviter d'interrompre les envois de campagnes actives. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, l'interface utilisateur d'administration de Listmonk (`/`) est protégée uniquement par l'authentification propre à Listmonk. Activez Cloud Armor et configurez `admin_ip_ranges` pour tout déploiement de production accessible publiquement. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Listmonk sur GKE Autopilot](../labs/Listmonk_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune de Listmonk](Listmonk_Common.md) — la configuration partagée par les deux cibles de déploiement.
