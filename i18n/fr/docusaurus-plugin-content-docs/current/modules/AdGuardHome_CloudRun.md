---
title: "AdGuard Home sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'AdGuard Home sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/AdGuardHome_CloudRun.md @ e69407af sha256:8b9a01ea1842 -->

# AdGuard Home sur Google Cloud Run {#adguard-home-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AdGuardHome_CloudRun.png" alt="AdGuard Home sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **CRITIQUE — à lire avant le déploiement.** La valeur fondamentale d'AdGuard Home est le
> blocage des publicités et des traqueurs DNS à l'échelle du réseau, ce qui exige des clients
> qu'ils l'interrogent via DNS sur le port 53 (TCP+UDP). **Cloud Run n'autorise que l'entrée
> HTTP(S) et ne peut pas exposer le port 53 brut, quelle que soit la configuration.** Ce module
> déploie **uniquement la console d'administration web** d'AdGuard Home (port 3000) pour la
> gestion des listes de filtres, des règles personnalisées et des paramètres client. **L'instance
> déployée n'est PAS accessible en tant que résolveur DNS public sur Cloud Run.** Si vous avez
> besoin qu'AdGuard Home résolve réellement les requêtes DNS pour de vrais clients, ce module
> (tel qu'il est actuellement défini) ne peut pas le faire — voir la [§6 Pièges de configuration](#6-configuration-pitfalls--sensible-defaults)
> pour l'explication complète et la solution de contournement (hors du champ d'application) que
> ce module n'implémente pas.

AdGuard Home est un serveur DNS open-source, sous licence GPL-3.0, qui bloque les publicités
et les traqueurs au niveau DNS et inclut des contrôles parentaux. C'est un binaire statique Go
sans base de données externe — toute la configuration se trouve dans un fichier YAML plat écrit
par son propre assistant de configuration initial. Ce module déploie la console d'administration
web d'AdGuard Home sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'AdGuard Home utilise et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécaniques communes à chaque application Cloud Run — identité de service, entrée et équilibrage
de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls et le cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte AdGuard Home sur RAD, et comment cela se compare {#what-adguard-home-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'AdGuard Home sur RAD coûte environ 17 US$ par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 40 crédits (4 US$ au prix de la recharge) dans un projet que vous possédez, et 36 crédits (10 % de moins) dans un projet géré par RAD. Si AdGuard Home doit fonctionner en continu sur plusieurs pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](AdGuardHome_GKE.md). Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 17 US$ par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ 17 US$ par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **3 crédits par jour**, soit environ 90 par mois (environ 9 US$ au prix de la recharge, 7 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins avec un plan mensuel.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 17 US$** |

### Comment cela se compare {#how-it-compares}

- Le plan Pro de NextDNS — requêtes et appareils illimités, résolvant réellement le DNS pour votre réseau, ce que le déploiement uniquement de la console web de ce module ne fait pas — coûte **1,79 £/mois** (environ 2,30 $). Cela achète un service de résolution clé en main ; cela n'achète pas la console de gestion des listes de filtres et des paramètres client auto-hébergée que ce module exécute.
- **RAD exécute le projet open-source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sous votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** C'est une charge de travail plus petite qu'un VPS standard de 2 vCPU, donc l'exécuter vous-même sur une classe moins chère et plus petite qu'un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go Droplet (tous deux environ 24 $/mois) ferait l'affaire, pour nettement moins que cela. RAD n'est pas moins cher que cela en termes d'argent — la différence est la base de données gérée, Secret Manager et la surveillance qui accompagnent le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AdGuard Home fonctionne dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà
de la mise à l'échelle à zéro : **supprimez l'ensemble du projet, et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin
saisonnier — que de faire fonctionner AdGuard Home en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer purement et simplement le projet. Google ne le supprime pas immédiatement : il conserve le projet,
  récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
  attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la
  ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet
  peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela
  ne coûte qu'une poignée de crédits au total (moins de 1 US$), contre le paiement des frais de module et d'un
  build complet à nouveau.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous
  devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et
  la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit
  toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  correspondent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'AdGuard Home écrit dans un bucket de sauvegarde à l'intérieur du
  projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même
  est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée.
  Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une
  sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est
passée : **supprimez le déploiement, et redéployez-le la prochaine fois que vous en aurez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ
  45 crédits (environ 4,50 US$) dans votre propre projet, ou
  41 crédits dans un projet géré par RAD, car RAD reconstruit les ressources
  à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'AdGuard Home resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ 8 jours ou plus dans votre propre projet (0,56 US$/jour) ou 14 jours ou plus dans un projet géré par RAD (3 crédits/jour).
- **Conservez d'abord vos données.** Tout ce qu'AdGuard Home écrit dans un bucket de sauvegarde à l'intérieur du déploiement est
  supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant
  de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque
  vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  d'AdGuard Home dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute AdGuard Home pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoive de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarifs NextDNS](https://nextdns.io/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

AdGuard Home s'exécute en tant que conteneur binaire statique Go unique sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 1 vCPU / 512 Mio par défaut, mise à l'échelle automatique sans serveur ; mise à l'échelle à zéro par défaut |
| Base de données | Aucune | AdGuard Home n'a pas de base de données externe — la configuration est un fichier YAML plat |
| Stockage d'objets | Cloud Storage (×2, GCS Fuse) | Bucket `conf` (config) et bucket `work` (journal des requêtes/statistiques), tous deux montés en tant que volumes de système de fichiers |
| Secrets | Secret Manager | Aucun généré — l'identifiant administrateur est défini via l'assistant web de première exécution d'AdGuard Home |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` (console d'administration web **uniquement** — voir la note CRITIQUE ci-dessus) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ce déploiement est une console de gestion de configuration, pas un résolveur DNS.** Cloud Run ne peut pas exposer le DNS brut (port 53 TCP/UDP). Ne dirigez pas de vrais clients DNS vers l'URL ou l'IP de ce déploiement.
- **Pas de base de données externe.** `database_type = "NONE"` et ne doit pas être modifié.
- **Deux volumes GCS Fuse sont pré-câblés et provisionnés automatiquement** —
  `conf` à `/opt/adguardhome/conf` et `work` à `/opt/adguardhome/work` —
  afin que la configuration et le journal/statistiques des requêtes persistent après les redémarrages et les démarrages à froid. Vous n'avez pas besoin de définir `gcs_volumes` vous-même.
- **`container_port = 3000`** — L'assistant de configuration d'AdGuard Home est codé en dur pour
  écouter sur le port 3000 jusqu'à ce que `AdGuardHome.yaml` existe. Si vous modifiez le port
  de l'interface web pendant l'assistant de configuration, maintenez-le à 3000 ou la
  sonde de santé de la plateforme et l'URL publique ne correspondront plus à ce que le conteneur
  écoute.
- **Mise à l'échelle à zéro par défaut** (`cpu_always_allocated = false`,
  `min_instance_count = 0`). Il s'agit d'une simple console d'administration requête/réponse dans
  cette forme de déploiement, de sorte que le coût d'inactivité est minimal.
- **Aucun identifiant administrateur pré-rempli.** L'assistant de configuration initial d'AdGuard Home,
  servi à l'URL de déploiement, est l'endroit où vous définissez le nom d'utilisateur/mot de passe
  administrateur — rien n'est injecté par la plateforme.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources
sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — la console d'administration web d'AdGuard Home {#a-cloud-run--the-adguard-home-web-admin-console}

AdGuard Home s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes
entre le nombre minimal et maximal d'instances.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage (GCS Fuse) — configuration et journal/statistiques des requêtes {#b-cloud-storage-gcs-fuse--config-and-query-logstats}

AdGuard Home stocke l'intégralité de sa configuration dans un fichier YAML plat
(`AdGuardHome.yaml`) et sa base de données de journal/statistiques des requêtes dans un répertoire
séparé. Les deux sont sauvegardés par des buckets Cloud Storage dédiés montés en tant que volumes de
système de fichiers GCS Fuse — `conf` et `work` — provisionnés automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
  gcloud storage ls gs://<conf-bucket>/          # bucket names are in the Outputs
  gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml   # inspect the live config
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Réseau et entrée {#c-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. **Ceci est l'URL de la console d'administration web uniquement — ce n'est pas une adresse de serveur DNS.** Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés pour la console d'administration.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

Le point d'entrée enregistre une bannière de rappel de portée DNS à chaque démarrage — visible dans les
premières lignes du journal d'une nouvelle révision.

---

## 3. Comportement de l'application AdGuard Home {#3-adguard-home-application-behaviour}

- **Pas de bootstrap de base de données.** AdGuard Home n'a pas de base de données externe, il n'y a donc
  pas de valeur par défaut `initialization_jobs` — la liste est disponible uniquement pour
  les jobs personnalisés fournis par l'opérateur.
- **Assistant de configuration initial.** Lors de la première visite à l'URL du service (avant
  que `AdGuardHome.yaml` n'existe), AdGuard Home sert son propre assistant de configuration sur le port
  3000 : choisissez le port de l'interface web d'administration (maintenez-le à 3000), définissez le nom d'utilisateur/mot de passe
  administrateur et sélectionnez les serveurs DNS en amont. Rien n'est pré-rempli par la plateforme.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — il n'y a pas
  de point de terminaison de santé dédié ; la racine renvoie `200` avant et après
  la configuration initiale.
- **La résolution DNS n'est pas accessible.** Le propre écouteur DNS interne du conteneur peut démarrer,
  mais rien en dehors de la révision ne peut atteindre le port 53 sur Cloud Run. Seule la console
  d'administration web (le port HTTP exposé du conteneur) est accessible.
- **Inspecter l'exécution des jobs** (si des jobs d'initialisation personnalisés ont été ajoutés) :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour AdGuard Home sont listés ; toutes les autres entrées
sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `adguardhome` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `AdGuard Home` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Balise de suivi du déploiement. Correspond à l'ARG de build `ADGUARDHOME_VERSION` spécifique à l'application dans le Dockerfile (pas au générique `APP_VERSION`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | `1` | Instance unique — AdGuard Home n'a pas de problème de coordination multi-instances pour sa propre console d'administration, mais ne dépassez pas 1 sauf si vous comprenez votre modèle d'écriture GCS Fuse. |
| `container_port` | `3000` | Le port fixe de l'assistant de configuration. **Pas le port DNS 53.** |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — une simple application de console d'administration n'a pas besoin de CPU en arrière-plan. |
| `enable_cloudsql_volume` | `false` | Non utilisé — pas de base de données. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut ; la console d'administration a sa propre connexion. |
| `enable_iap` | `false` | Recommandé d'activer — met l'authentification d'identité Google devant la console de politique de filtrage DNS. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Rarement nécessaire — AdGuard Home lit la configuration à partir de son propre fichier YAML. |
| `secret_environment_variables` | `{}` | Aucun secret de plateforme n'existe pour cette application. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets `conf`/`work` toujours provisionnés ainsi que ceux de `storage_buckets`. |
| `gcs_volumes` | `[]` | Laissez vide pour utiliser les propres montages `conf`/`work` du module. |
| `enable_nfs` | `false` | Non utilisé — la persistance se fait via GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — ne doit pas être modifié. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job par défaut — AdGuard Home n'a pas besoin de bootstrap de base de données. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Pas de point de terminaison de santé dédié ; la racine renvoie 200 avant et après la configuration. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

Non applicable — AdGuard Home n'utilise pas Redis. `enable_redis` par défaut `false`.

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut de la console d'administration web (**pas** une adresse de résolveur DNS). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`conf`, `work`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs et les combinaisons au moment de la planification. Une configuration invalide
> échoue la **planification** avec une erreur claire et nommée avant que toute ressource ne soit créée.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Attendre une résolution DNS réelle de ce déploiement | Ne pas s'y fier | **Critique** | Cloud Run ne peut pas exposer le port 53 TCP/UDP brut, quelle que soit la configuration — les clients dirigés vers l'IP/le nom d'hôte de ce déploiement pour le DNS n'obtiendront aucune réponse. Ce module est conçu comme une console de gestion de configuration uniquement. |
| `container_port` modifié sans modifier également le port de l'interface web de l'assistant de configuration | Maintenez les deux à `3000` | Critique | Le port de l'interface web d'exécution d'AdGuard Home provient de `AdGuardHome.yaml` (défini lors de la configuration) — s'il diverge de `container_port`, la sonde de santé de la plateforme et l'URL publique ne correspondent plus à ce que le conteneur écoute réellement, et la révision ne devient jamais prête après le premier redémarrage. |
| `database_type` | `NONE` (ne pas modifier) | Critique | AdGuard Home n'a pas d'intégration de base de données ; la définition d'un moteur réel ici n'a aucun effet mais signale une incompréhension du module. |
| `gcs_volumes` | Laisser vide (valeur par défaut du module) | Critique | Le fait de le remplacer sans monter également `conf`/`work` entraîne la perte de la configuration et de l'historique des requêtes d'AdGuard Home à chaque démarrage à froid / redémarrage. |
| Console d'administration laissée sans IAP / équivalent d'inscription ouverte | Activer `enable_iap` ou restreindre `ingress_settings` | Élevé | La console d'administration contrôle la politique de filtrage DNS ; une console ouverte et non authentifiée permet à quiconque de reconfigurer le filtrage ou de lire les journaux de requêtes. |
| `min_instance_count = 0` (mise à l'échelle à zéro) | Valeur par défaut acceptable | Faible | Les démarrages à froid ajoutent quelques secondes de latence à la première requête après l'inactivité — ce qui est acceptable pour une console d'administration, contrairement à un résolveur DNS en temps réel. |
| `memory_limit` en dessous de `512Mi` | Maintenez à `512Mi` (seuil gen2) | Moyen | L'environnement d'exécution gen2 de Cloud Run rejette `memory_limit < 512Mi` purement et simplement au moment de la planification. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à AdGuard Home
partagée avec la variante GKE est décrite dans
**[AdGuardHome_Common](AdGuardHome_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : AdGuardHome sur Cloud Run](../labs/AdGuardHome_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [AdGuardHome Common — Configuration d'application partagée](AdGuardHome_Common.md) — la configuration partagée par les deux cibles de déploiement.
