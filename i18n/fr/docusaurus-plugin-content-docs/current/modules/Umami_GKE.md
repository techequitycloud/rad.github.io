---
title: "Module Umami GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement d'Umami sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Umami_GKE.md @ 1665a43e sha256:2f5bd432d0d0 -->

# Module Umami GKE — Guide de configuration {#umami-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Umami_GKE.png" alt="Module Umami GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Umami_GKE`. `Umami_GKE` est un **module wrapper** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Umami_Common`](./Umami_Common) pour déployer la plateforme d'analyse web axée sur la confidentialité [Umami](https://umami.is/) sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Umami GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Umami** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Ce que coûte Umami sur RAD, et comment cela se compare {#what-umami-costs-on-rad-and-how-that-compares}

**L'exécution d'Umami sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 104,74 $ US/mois en frais Google Cloud** (environ 177,74 $ US si ce n'est pas votre seul cluster Autopilot), en plus de frais de module RAD uniques de 110 crédits (11 $ US) — plus élevés que les frais du module Cloud Run car cette variante exécute également un volume NFS partagé sur GKE. GKE Autopilot convient à Umami qui doit rester opérationnel ou évoluer sur plusieurs pods ; pour le coût le plus bas, consultez plutôt le [guide Cloud Run](Umami_CloudRun.md). Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 104,74 $ US/mois, facturé par Google au prix catalogue | ~92 crédits/jour (environ 2760/mois, 276 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un abonnement mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 Gio | 34,29 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **104,74 $ US** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- La propre solution hébergée d'Umami, **Umami Cloud**, propose un niveau Hobby gratuit, puis Pro à 20 $/mois et Business à 200 $/mois — vérifié sur la page de tarification d'Umami, le 8 octobre 2026. Le coût d'exécution de RAD dans votre propre projet est un forfait d'environ 105 $ US/mois, quel que soit le volume d'événements.
- Une comparaison avec un VPS autogéré, dimensionné selon la configuration par défaut d'Umami de 1 vCPU / 0,5 Gio : un Hetzner CPX11 ou un Droplet DigitalOcean de 1 vCPU/2 Go coûte environ 6-12 $/mois — plus votre propre temps pour les sauvegardes et les correctifs, et aucun plan de contrôle Kubernetes à gérer.
- La majeure partie du coût de ce module par rapport à la variante Cloud Run est due au pod GKE et au volume NFS ; le [module Cloud Run](Umami_CloudRun.md) n'a besoin ni de l'un ni de l'autre et est l'option par défaut la moins chère pour Umami.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la propre suppression logicielle récupérable de Google pendant 30 jours. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer
le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart
des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Umami et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Umami signifie redéployer à partir de
zéro. Cela coûte environ 113-116 crédits dans votre propre projet, ou environ
102-105 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Umami resterait inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — environ 3 jours ou plus dans votre propre projet
(environ 3,49 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(92 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin,
le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [tarification Umami](https://umami.is/pricing).

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Umami |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Umami ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Umami pour `container_port`, `cpu_limit`, `memory_limit` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Configuration du service principal | `APP_SECRET` auto-généré ; `DATABASE_URL` assemblé à l'exécution ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et politiques réseau | §3.D Réseau et politiques réseau | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Job `db-init` fourni automatiquement par `Umami Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Services supplémentaires | Identique. |
| Stockage — NFS | §3.C Stockage (NFS / GCS / GCS Fuse) | `enable_nfs` par défaut à `false` — Umami est sans état et n'a pas besoin de système de fichiers partagé. |
| Stockage — GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Aucun bucket de stockage provisionné par défaut ; voir [Groupe 14 : Cloud Storage](#group-14-cloud-storage). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **PostgreSQL requis** ; voir [Groupe 16 : Configuration de la base de données](#group-16-database-configuration). |
| Planification et rétention des sauvegardes | §3.B Base de données (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Jobs d'initialisation et CronJobs | Identique. |
| Observabilité et vérifications de santé | §3.A Calcul (GKE Autopilot) | Point de terminaison de santé `/api/heartbeat` ; voir [Groupe 10 : Observabilité et santé](#group-10-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Proxy conscient de l'identité | §4.B Proxy conscient de l'identité (IAP) | Identique. |
| Autorisation binaire | §4.C Autorisation binaire | Identique. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |
| Pilote CSI du magasin de secrets | §4.E Pilote CSI du magasin de secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | §5 Trafic et Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | Voir [Groupe 19 : Domaine personnalisé et IP statique](#group-19-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Déclencheurs Cloud Build | Identique. |
| Pipeline Cloud Deploy | §6.B Pipeline Cloud Deploy | Identique. |
| Mise en miroir d'images | §6.C Mise en miroir d'images | Activé par défaut pour éviter les limites de débit de GitHub Container Registry. |
| Budgets d'interruption de pod | §7.A Budgets d'interruption de pod | Identique. |
| Contraintes de répartition topologique | §7.B Contraintes de répartition topologique | Identique. |
| Quotas de ressources | §7.C Quotas de ressources | Identique. |
| Rotation automatique des mots de passe | §7.D Rotation automatique des mots de passe | Voir [Groupe 16 : Configuration de la base de données](#group-16-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | Redis non câblé — Umami ne le nécessite pas ; voir [Groupe : Cache Redis](#redis-cache). |
| Importation de sauvegarde | §8.B Importation de sauvegarde | Voir [Groupe 21 : Importation de sauvegarde](#group-21-backup-import). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Services multi-clusters | §8.D Services multi-clusters (MCS) | Identique. |

---

## Comment Umami GKE se rapporte à App GKE {#how-umami-gke-relates-to-app-gke}

`Umami GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Umami Common` qui fournit des valeurs par défaut et une configuration d'application spécifiques à Umami. Les principaux effets sont :

1.  **PostgreSQL est requis.** Umami nécessite PostgreSQL pour tout le stockage de données. La valeur par défaut de `database_type` est `"POSTGRES"` (l'option PostgreSQL générique).
2.  **`DATABASE_URL` est assemblé à l'exécution.** Le point d'entrée Umami personnalisé construit `DATABASE_URL` à partir des variables DB_* injectées par la plateforme. Cela évite de stocker une chaîne de connexion en texte clair dans les variables d'environnement ou l'état Terraform.
3.  **`APP_SECRET` est auto-généré.** `Umami Common` génère un secret alphanumérique de 32 caractères et le stocke dans Secret Manager. Il est injecté dans le pod en tant que `APP_SECRET`.
4.  **Aucun bucket de stockage n'est provisionné par défaut.** Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. `storage_buckets` est par défaut une liste vide.
5.  **Un job `db-init` s'exécute lors du premier déploiement.** `Umami Common` fournit un job Kubernetes `db-init` par défaut qui pré-crée la base de données et l'utilisateur PostgreSQL d'Umami. Umami exécute ensuite ses propres migrations Prisma au démarrage.
6.  **Les valeurs par défaut des ressources sont dimensionnées pour Umami.** Les valeurs par défaut de `cpu_limit` (1 vCPU) et `memory_limit` (512 Mio) reflètent l'empreinte légère d'Umami.
7.  **Les sondes de santé ciblent `/api/heartbeat`.** Le point de terminaison de santé dédié d'Umami, et non un chemin racine générique.
8.  **Redis n'est pas utilisé.** Umami stocke tout dans PostgreSQL ; le module ne câble aucune connexion Redis (la déclaration `enable_redis` mise en miroir n'est pas transmise à la Fondation).
9.  **La mise en miroir d'images est activée par défaut.** Umami est distribué via GitHub Container Registry (`ghcr.io`). Le module met en miroir l'image vers Artifact Registry pour éviter les limites de débit en production.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | ID du projet GCP. **Requis.** |
| `region` | `"us-central1"` | Région GCP pour Cloud SQL, GCS et d'autres ressources. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-3--application-identity) pour les descriptions.

**Valeurs par défaut spécifiques à Umami :**

| Variable | Valeur par défaut Umami GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"umami"` | `"gkeapp"` | Utilisé comme nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Umami"` | `"App GKE Application"` | Affiché dans l'interface utilisateur et les tableaux de bord de la plateforme. Peut être modifié librement. |
| `application_description` | `"Umami Analytics on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"postgresql-latest"` | `"1.0.0"` | La version de publication d'Umami à construire et déployer. Doit utiliser une balise préfixée par `postgresql-`. |
| `deploy_application` | `true` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support sans déployer la charge de travail Umami. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

**Valeurs par défaut et comportement spécifiques à Umami :**

| Variable | Valeur par défaut Umami GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `3000` | `8080` | Port Next.js natif d'Umami. Ne pas modifier sauf si votre Dockerfile personnalisé lie Umami à un port différent. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Mêmes valeurs par défaut — Umami est léger. Augmentez `memory_limit` à `1Gi` pour les tableaux de bord d'analyse à fort trafic. |
| `min_instance_count` | `1` | varie | La valeur par défaut de GKE est 1 pod minimum. Définissez une valeur plus élevée pour les déploiements à haute disponibilité. |
| `max_instance_count` | `10` | `3` | Umami s'adapte horizontalement en toute sécurité — tout l'état est dans PostgreSQL, permettant de nombreuses instances concurrentes. |
| `container_image_source` | `"custom"` | `"custom"` | Le mode `custom` construit une image wrapper qui assemble `DATABASE_URL` à partir des variables DB_*. Définissez sur `"prebuilt"` uniquement si vous fournissez `DATABASE_URL` manuellement. |
| `enable_cloudsql_volume` | `true` | `true` | Sidecar Cloud SQL Auth Proxy. Requis pour qu'Umami se connecte à Cloud SQL via un socket Unix. |
| `workload_type` | `"Deployment"` | `"Deployment"` | Umami est sans état — `Deployment` est le type de charge de travail correct. N'utilisez pas `StatefulSet` sauf si vous attachez un stockage local persistant pour un cas d'utilisation non standard. |

**`enable_vertical_pod_autoscaling` :** Par défaut à `false`. Activez pour permettre à GKE Autopilot de dimensionner automatiquement les pods Umami en fonction de l'utilisation observée des ressources. Utile pour l'optimisation des coûts en production.

Les variables d'exécution restantes (`enable_image_mirroring`, `container_build_config`, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`, `termination_grace_period_seconds`, `deployment_timeout`) se comportent comme décrit dans [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy), [App_GKE](./App_GKE.md#group-19--access--networking), et [App_GKE](./App_GKE.md#group-21--cloud-armor--cdn).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google ayant accès à IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration IAP. |
| `iap_support_email` | `""` | E-mail de support affiché sur l'écran de consentement Google OAuth. |
| `enable_cloud_armor` | `false` | Attache une politique de sécurité Cloud Armor au backend Ingress GKE. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées via Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_vpc_sc` | `false` | Active l'application du périmètre des contrôles de service VPC. |
| `network_name` | `""` | Nom du réseau VPC. Laisser vide pour la découverte automatique. |
| `network_tags` | `[]` | Balises de pare-feu appliquées aux nœuds du cluster GKE. |
| `enable_network_segmentation` | `false` | Applique des règles Kubernetes NetworkPolicy pour restreindre le trafic pod-à-pod. |

**Note IAP pour Umami :** IAP protège le tableau de bord d'analyse Umami. Si vous appliquez IAP, notez que le point de terminaison du script de suivi (`/script.js`) et le point de terminaison de collecte d'événements (`/api/send`) doivent rester accessibles publiquement pour que les sites web suivis puissent rapporter des données. Considérez attentivement l'architecture de routage si vous restreignez l'accès.

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Comportement spécifique à Umami :**

`Umami Common` génère `APP_SECRET` et l'injecte comme variable d'environnement `APP_SECRET`. Aucune valeur par défaut SMTP n'est pré-remplie — Umami n'envoie pas d'e-mail nativement.

Utilisez `environment_variables` pour les options de configuration d'Umami :

```hcl
environment_variables = {
  DISABLE_TELEMETRY = "1"    # Disable Umami's anonymous telemetry reporting
  TRACKER_SCRIPT_NAME = "analytics.js"  # Rename tracking script to avoid ad blockers
  ALLOWED_FRAME_URLS = "https://example.com"  # Allow Umami to be embedded in iframes
}
```

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair injectées dans le pod à l'exécution. |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées comme variables d'environnement. |
| `secret_rotation_period` | `'2592000s'` | Période de rotation pour les secrets Secret Manager (30 jours). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

---

## Groupe 6 : Cluster GKE {#group-6-gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE Autopilot cible. Laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Auto-généré à partir de `application_name` et `tenant_id` lorsqu'il est vide. |
| `service_type` | `"LoadBalancer"` | Type de service Kubernetes. `"LoadBalancer"` (la valeur par défaut) expose Umami directement sur une IP externe ; utilisez `"ClusterIP"` pour un accès interne uniquement derrière un Ingress. |
| `session_affinity` | `"None"` | Mode d'affinité de session. `"None"` est correct pour Umami — tout l'état est dans PostgreSQL, donc n'importe quel pod peut gérer n'importe quelle requête. |
| `enable_multi_cluster_service` | `false` | Enregistre le service auprès de GKE Multi Cluster Services. |
| `configure_service_mesh` | `false` | Injecte les proxys sidecar Anthos Service Mesh (Istio). |
| `termination_grace_period_seconds` | `30` | Secondes pendant lesquelles Kubernetes attend la terminaison du pod avant de le tuer de force. |
| `deployment_timeout` | `1800` | Nombre maximal de secondes à attendre pour que le déploiement GKE atteigne un état sain. |
| `gke_cluster_selection_mode` | `"primary"` | Stratégie de choix du cluster cible. |

---

## Groupe 7 : Sauvegarde et maintenance {#group-7-backup--maintenance}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajustez à votre fenêtre de maintenance préférée. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez pour les déploiements de production (30 à 90 jours recommandés). |

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation), avec un comportement important spécifique à Umami.

**Job `db-init` par défaut d'Umami :**

Lorsque `initialization_jobs` est laissé comme valeur par défaut (liste vide `[]`), `Umami Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | Image client PostgreSQL |
| Objectif | Pré-crée la base de données et l'utilisateur PostgreSQL d'Umami avant qu'Umami n'exécute ses propres migrations Prisma |
| Exécuter à chaque apply | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |

Remplacez `initialization_jobs` par une liste non vide pour remplacer cette valeur par défaut par vos propres jobs. Chaque job personnalisé doit spécifier au moins l'un des `command`, `args` ou `script_path`.

**CronJobs :** Les variables `cron_jobs` et `additional_services` sont disponibles et se comportent de manière identique à `App_GKE`. Utilisez `cron_jobs` pour des tâches telles que les exportations régulières de données d'analyse ou la maintenance de la base de données.

> **Note :** Le schéma `cron_jobs` dans `Umami GKE` utilise les champs CronJob de Kubernetes — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`.

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-9--reliability).

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut. Empêche tous les pods Umami d'être évincés simultanément pendant la maintenance du cluster. |
| `pdb_min_available` | `"1"` | Au moins un pod Umami doit rester disponible pendant les perturbations volontaires. |
| `enable_topology_spread` | `false` | Activer pour les déploiements à haute disponibilité afin de répartir les pods sur plusieurs zones. |
| `topology_spread_strict` | `false` | Lorsque `true`, utilise la contrainte de répartition `DoNotSchedule`. |

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-10--observability).

**Point de terminaison de santé Umami :** Umami expose `/api/heartbeat` comme son point de terminaison de santé dédié. Ce point de terminaison renvoie HTTP 200 lorsque Umami est en cours d'exécution et connecté à PostgreSQL. Toutes les configurations de sonde par défaut utilisent ce chemin.

| Variable | Valeur par défaut Umami GKE | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=30 }` | Un `failure_threshold` élevé permet les migrations Prisma au premier démarrage. |
| `health_check_config` | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=3 }` | Sonde de vivacité — redémarre les pods non sains. |
| `uptime_check_config` | `{ enabled=false, path="/api/heartbeat" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte de métriques personnalisées Cloud Monitoring. |

**Note sur la sonde de démarrage :** La sonde `failure_threshold = 30` avec `period_seconds = 10` donne à Umami jusqu'à 5 minutes (plus le délai initial de 30 secondes) pour terminer le démarrage et exécuter les migrations Prisma sur une nouvelle base de données. Lors des redémarrages ultérieurs (migrations déjà appliquées), le démarrage est beaucoup plus rapide.

---

## Groupe 11 : Automatisation des charges de travail (Jobs) {#group-11-workload-automation-jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs Kubernetes à exécuter avant le démarrage de l'application Umami. Laisser vide pour que `Umami Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | `[]` | Ressources CronJob Kubernetes récurrentes. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés à côté du conteneur Umami principal. |

---

## Groupe 12 : CI/CD et intégration GitHub {#group-12-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cicd_trigger` | `false` | Provisionne un déclencheur Cloud Build GitHub. |
| `github_repository_url` | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | `""` | Jeton d'accès personnel GitHub. Sensible. |
| `github_app_installation_id` | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | `false` | Passe à un pipeline Google Cloud Deploy géré. |
| `cloud_deploy_stages` | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. |
| `enable_binary_authorization` | `false` | Applique la politique d'autorisation binaire sur le cluster GKE. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Mode d'application de l'autorisation binaire. Non référencé. |

---

## Groupe 13 : NFS {#group-13-nfs}

Umami ne nécessite pas de NFS. `enable_nfs` est par défaut à `false`. Toutes les données Umami sont stockées dans PostgreSQL.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne une instance Cloud Filestore (NFS). Non requis pour Umami. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin de montage NFS du conteneur. Utilisé uniquement lorsque `enable_nfs = true`. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS GCE existante. Auto-découvert si vide. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base pour une VM NFS GCE intégrée (inline). |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. |

---

## Groupe 14 : Cloud Storage {#group-14-cloud-storage}

Umami ne nécessite pas de buckets GCS. `storage_buckets` est par défaut une liste vide.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Contrôle si le module provisionne les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Configurations de bucket GCS. Vide par défaut — Umami est sans état. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` | `false` | Crée un trousseau de clés CMEK KMS pour les buckets GCS. |
| `enable_artifact_registry_cmek` | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneurs à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images non étiquetées d'Artifact Registry. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

---

## Groupe 16 : Configuration de la base de données {#group-16-database-configuration}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-16--database-configuration).

**Valeurs par défaut et restrictions spécifiques à Umami :**

| Variable | Valeur par défaut Umami GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | `"POSTGRES"` | Umami nécessite PostgreSQL. Ne pas changer pour MySQL ou NONE. |
| `application_database_name` | `"umami"` | `"gkeappdb"` | **Ne pas modifier après le déploiement** — la modification recrée la base de données et détruit toutes les données d'analyse. |
| `application_database_user` | `"umami"` | `"gkeappuser"` | **Ne pas modifier après le déploiement.** |
| `database_password_length` | `32` | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job de rotation automatique des mots de passe de la base de données. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

**Extensions PostgreSQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par exemple, `['uuid-ossp', 'pg_trgm']`). |

---

## Groupe 19 : Domaine personnalisé et IP statique {#group-19-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Kubernetes Ingress pour le routage de domaine personnalisé. Activé par défaut. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple, `["analytics.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. Recommandé pour les déploiements de production. |
| `static_ip_name` | `""` | Nom de l'IP réservée. Auto-généré si vide. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend Ingress GKE. |
| `network_tags` | `[]` | Balises réseau de pare-feu VPC appliquées aux nœuds GKE. |
| `network_name` | `""` | Nom du réseau VPC. Auto-découvert si vide. |

---

## Groupe 21 : Importation de sauvegarde {#group-21-backup-import}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Déclenche un job d'importation de base de données unique pendant le déploiement. |
| `backup_source` | `"gcs"` | Source du fichier de sauvegarde : `"gcs"` ou `"gdrive"`. |
| `backup_file` | `"backup.sql"` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | `"sql"` | Format de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 8 : Quota de ressources {#group-8-resource-quota}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-8--resource-quota).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms de l'application. |
| `quota_cpu_requests` | `""` | Requêtes CPU totales autorisées dans l'espace de noms. |
| `quota_cpu_limits` | `""` | Limites CPU totales autorisées dans l'espace de noms. |
| `quota_memory_requests` | `""` | Requêtes mémoire totales. **Doit utiliser des suffixes d'unité binaire** (par exemple, `"4Gi"`, `"8192Mi"`). |
| `quota_memory_limits` | `""` | Limites mémoire totales. **Doit utiliser des suffixes d'unité binaire.** |

> **Avertissement :** `quota_memory_requests` et `quota_memory_limits` doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'ils sont définis. Les entiers nus (par exemple, `"4"`) sont traités comme des octets par Kubernetes et bloqueront toute planification de pod avec une erreur de dépassement de quota.

---

## Cache Redis {#redis-cache}

Umami n'utilise pas Redis — il stocke toutes les données d'analyse directement dans PostgreSQL sans couche de mise en cache. La variable `enable_redis` est déclarée dans `Umami_GKE` uniquement pour satisfaire la mise en miroir des variables de la Fondation ; elle n'est **pas transmise** à l'appel `App_GKE`, donc la modifier n'a aucun effet.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Déclaration inerte (mise en miroir de la Fondation uniquement) — non transmise à `App_GKE`, donc aucune variable d'environnement Redis n'est injectée quelle que soit la valeur. |

Si vous avez besoin de Redis pour une intégration personnalisée ou un service adjacent, utilisez `additional_services` pour déployer un sidecar Redis, ou configurez Memorystore indépendamment.

---

## Groupe 22 : Contrôles de service VPC {#group-22-vpc-service-controls}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique les périmètres des contrôles de service VPC autour des API GCP. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | `true` | Enregistre les violations sans les bloquer. |
| `organization_id` | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement si vide. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud détaillés. |

---

## Exploration avec la console GCP {#exploring-with-the-gcp-console}

Après un déploiement réussi, explorez l'installation d'Umami dans la console GCP :

**Charge de travail GKE :**
Accédez à **Kubernetes Engine → Workloads**. Trouvez le déploiement nommé d'après votre `application_name` et `tenant_id`. Cliquez pour afficher :
- L'état du pod, le nombre de redémarrages et l'âge.
- L'onglet **Logs** — diffuse les journaux des conteneurs des pods Umami en cours d'exécution.
- L'onglet **Details** — affiche la spécification du déploiement, les limites de ressources, la configuration de la sonde et les variables d'environnement (non sensibles).
- L'**historique des révisions** — liste les ReplicaSets précédents.

**Services et Ingress GKE :**
Accédez à **Kubernetes Engine → Services & Ingress**. Trouvez le service pour votre déploiement Umami. Affichez :
- L'adresse IP externe (si `service_type = "LoadBalancer"` ou `reserve_static_ip = true`).
- Les mappages de ports.
- L'état de la vérification de l'état de l'équilibreur de charge.

**Instance Cloud SQL :**
Accédez à **SQL**. Trouvez l'instance nommée `app-sql-<deployment_id>`. Explorez :
- **Overview** — nom de la connexion, version de PostgreSQL, utilisation du stockage.
- **Databases** — la base de données `umami` avec toutes les tables d'analyse.
- **Users** — l'utilisateur de l'application `umami`.
- **Operations** — historique des maintenances, des basculements et des sauvegardes.

**Secret Manager :**
Accédez à **Security → Secret Manager**. Trouvez le secret `secret-<tenant_resource_prefix>-<application_name>-app-secret` (injecté comme `APP_SECRET`) pour ce déploiement. Cliquez pour afficher :
- Les versions du secret et les horodatages de création.
- Le journal d'accès montrant quand les pods GKE ont lu le secret.
- La configuration de la rotation.

**Artifact Registry :**
Accédez à **Artifact Registry**. Trouvez le dépôt pour ce déploiement. Affichez les images Umami mises en miroir depuis GitHub Container Registry, leurs tags et la politique de rétention.

**Cloud Monitoring :**
Si `uptime_check_config.enabled = true` a été défini, accédez à **Monitoring → Uptime checks** pour afficher les résultats de la vérification de disponibilité `/api/heartbeat` dans les régions GCP. Accédez à **Monitoring → Dashboards** pour trouver le tableau de bord GKE auto-provisionné avec les métriques CPU, mémoire et requêtes.

---

## Exploration avec gcloud et kubectl {#exploring-with-gcloud-and-kubectl}

Utilisez ces commandes pour inspecter le déploiement Umami GKE. Remplacez `PROJECT_ID`, `CLUSTER_NAME`, `REGION`, `NAMESPACE` et `DEPLOYMENT_NAME` par vos valeurs.

```bash
# Get GKE cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List pods in the Umami namespace
kubectl get pods -n NAMESPACE

# Describe the Umami deployment
kubectl describe deployment DEPLOYMENT_NAME -n NAMESPACE

# View Umami pod logs
kubectl logs -n NAMESPACE -l app=DEPLOYMENT_NAME --tail=100

# Follow live logs from all Umami pods
kubectl logs -n NAMESPACE -l app=DEPLOYMENT_NAME -f

# Check resource usage across Umami pods
kubectl top pods -n NAMESPACE

# Check HPA status (horizontal pod autoscaling)
kubectl get hpa -n NAMESPACE

# Describe the Kubernetes Service
kubectl get service -n NAMESPACE
kubectl describe service SERVICE_NAME -n NAMESPACE

# Check pod environment variables (non-sensitive)
kubectl exec -n NAMESPACE POD_NAME -- env | grep -v PASSWORD | grep -v SECRET

# Test health endpoint from inside a pod
kubectl exec -n NAMESPACE POD_NAME -- \
  wget -qO- http://localhost:3000/api/heartbeat

# Check Cloud SQL instance
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.tier)"

# List databases
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# Check Secret Manager secrets
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime)"

# List Artifact Registry images
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Check Kubernetes namespace resource quota (if enabled)
kubectl describe resourcequota -n NAMESPACE

# View PodDisruptionBudget
kubectl get pdb -n NAMESPACE

# Check recent Kubernetes events for the namespace
kubectl get events -n NAMESPACE --sort-by='.metadata.creationTimestamp' | tail -20

# Check Cloud Monitoring uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"
```

---

## Sorties du module {#module-outputs}

`Umami GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `service_url` | URL externe de l'équilibreur de charge GKE. |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement. |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (vide pour Umami). |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — réexécutez apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES"` | **Critique** | Umami nécessite PostgreSQL. Le fait de le définir sur MySQL ou NONE entraîne l'échec de l'assemblage de DATABASE_URL et Umami ne peut pas se connecter à la base de données. |
| `application_database_name` | `"umami"` | **Critique** | Changer cela après le déploiement initial détruit toutes les données d'analyse collectées. La base de données est recréée vide tandis que les anciennes données restent orphelines dans Cloud SQL. |
| `application_database_user` | `"umami"` | **Critique** | Changer cela après le déploiement initial recrée l'utilisateur Cloud SQL, invalidant les identifiants et rompant toute connectivité à la base de données. |
| `container_port` | `3000` | **Critique** | Umami écoute sur 3000. Une non-concordance entraîne l'échec de toutes les sondes de santé et Kubernetes redémarre continuellement le pod. |
| `container_image_source` | `"custom"` | **Élevé** | L'image officielle d'Umami n'accepte pas les variables DB_* individuelles — elle nécessite un `DATABASE_URL` entièrement formé. L'utilisation de `"prebuilt"` sans définir manuellement `DATABASE_URL` dans `environment_variables` entraînera l'échec d'Umami au démarrage avec une erreur de connexion à la base de données manquante. |
| `application_version` | `"postgresql-latest"` | **Élevé** | Doit utiliser un tag préfixé par `postgresql-`. Les tags simples (par exemple, `latest`) n'existent pas pour la variante PostgreSQL d'Umami. Un tag invalide entraîne l'échec du pull du conteneur. |
| `admin_password` | _(à changer lors de la première connexion)_ | **Critique** | Les identifiants par défaut (`admin` / `umami`) sont publiquement connus. Les laisser inchangés expose le tableau de bord d'analyse et toutes les données suivies à quiconque connaît l'URL du service. |
| `container_resources.memory_limit` | `"512Mi"` | **Moyen** | 512 Mio sont suffisants pour un trafic léger à modéré. En cas d'utilisation intensive et concurrente du tableau de bord ou de requêtes d'analyse complexes, Umami peut manquer de mémoire. Augmentez à `1Gi` si une pression mémoire est observée. |
| `enable_cloudsql_volume` | `true` | **Critique** | Umami se connecte à Cloud SQL via le socket Unix du proxy d'authentification. La désactivation de cette option supprime le socket, entraînant l'échec de toutes les connexions à la base de données. |
| `startup_probe_config.failure_threshold` | `30` | **Élevé** | Avec `period_seconds = 10`, un `failure_threshold` de 30 donne à Umami jusqu'à 5 minutes pour démarrer et exécuter les migrations Prisma. Réduire cela en dessous de 10 peut entraîner le redémarrage du pod par Kubernetes avant la fin des migrations, créant une boucle de redémarrage sur les nouveaux déploiements. |
| `session_affinity` | `"None"` | **Faible** | Umami est entièrement sans état — aucune affinité de session n'est requise. Toutes les requêtes peuvent être traitées par n'importe quel pod sans problèmes de cohérence. |
| `min_instance_count` | `1` | **Moyen** | Au moins un pod Umami doit toujours être en cours d'exécution pour que les données d'analyse soient collectées. La mise à l'échelle à zéro entraînerait des lacunes de données pendant les périodes sans trafic de tableau de bord. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers bruts sont traités comme des octets, bloquant toute planification de pod avec une erreur de dépassement de quota. |
| `enable_pod_disruption_budget` | `true` | **Moyen** | Déjà activé par défaut. La désactivation permet de terminer tous les pods simultanément pendant les mises à niveau des nœuds GKE Autopilot, entraînant de brèves interruptions de service. |
| `backup_retention_days` | `7` | **Moyen** | La perte de données d'analyse est difficile à récupérer. Augmentez à 30 jours et plus pour les déploiements de production où les données d'analyse historiques ont une valeur commerciale. |
| `enable_backup_import` | `false` | **Élevé** | Définir cela sur `true` déclenche une restauration de base de données à chaque apply. N'activez cette option que pour la migration initiale à partir d'une instance Umami existante ; remettez-la immédiatement à `false`. |
| `enable_vpc_sc` | `false` | **Moyen** | Le périmètre VPC-SC n'est actif que lorsque `organization_id` est également défini. Sans les deux, `enable_vpc_sc = true` n'a aucun effet d'application. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Umami sur GKE Autopilot](../labs/Umami_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Umami sur Google Cloud Run](Umami_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Umami](Umami_Common.md) — la configuration partagée par les deux cibles de déploiement.
