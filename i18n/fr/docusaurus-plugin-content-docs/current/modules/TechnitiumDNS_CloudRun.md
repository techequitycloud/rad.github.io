---
title: "TechnitiumDNS sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de TechnitiumDNS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/TechnitiumDNS_CloudRun.md @ e69407af sha256:e61e9f963973 -->

# TechnitiumDNS sur Google Cloud Run {#technitiumdns-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_CloudRun.png" alt="TechnitiumDNS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Divulgation de la portée :** ce module déploie **uniquement la console d'administration web et l'API REST** de Technitium (port 5380/HTTP). La fonction de résolution DNS principale de Technitium (port 53/udp+tcp) **ne peut pas** être exposée via l'entrée HTTP(S) uniquement de Cloud Run. Aucun client ne peut interroger ce déploiement en tant que résolveur DNS. Voir les paragraphes 1 et 7 ci-dessous pour l'explication complète.

Technitium DNS Server est un serveur DNS autoritaire et récursif auto-hébergé, open source et multiplateforme (.NET) avec une console d'administration web complète et une API REST pour la gestion des zones, des enregistrements, du blocage des publicités/traqueurs basé sur DNS, du transfert conditionnel et du DNS-over-HTTPS/TLS. Ce module déploie l'image officielle `technitium/dns-server` sur **Cloud Run v2**, sans modification, sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par TechnitiumDNS et sur la manière de les explorer et de les exploiter à partir de la console Google Cloud et de la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte TechnitiumDNS sur RAD, et comment cela se compare {#what-technitiumdns-costs-on-rad-and-how-that-compares}

**TechnitiumDNS sur le module Cloud Run de RAD coûte environ 16,78 US$ par mois dans un projet Google Cloud que vous possédez, avec les frais de module facturés une seule fois en crédits RAD.** C'est l'un des modules les plus légers de la plateforme — pas de base de données, un petit conteneur, et (selon la divulgation de la portée ci-dessus) seulement la console d'administration web et l'API REST, pas un résolveur DNS accessible. Pour le coût de fonctionnement le plus bas, cela reste sur Cloud Run ; GKE Autopilot ne vaut la peine que s'il doit être placé à côté d'autres charges de travail Kubernetes — voir le [guide GKE](TechnitiumDNS_GKE.md) pour cette option, à environ 24,04 US$ par mois à la place. Si vous n'en avez besoin qu'occasionnellement — test de configuration de zone, évaluation de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **16,78 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, soit environ 90 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un forfait mensuel. Dans un projet géré par RAD, le réseau est partagé par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de celui-ci.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **16,78 US$** |

### Comment cela se compare {#how-it-compares}

- TechnitiumDNS n'a pas de SaaS hébergé commercial propre pour cette console d'administration/API — il est distribué uniquement en tant que logiciel open source auto-hébergé, Docker-first, pour qu'un administrateur puisse l'exécuter lui-même.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — tous considérablement plus puissants que les 1 vCPU / 0,5 GiB nécessaires à ce module ; une micro-instance à vCPU partagé à 5-6 $/mois l'exécuterait confortablement, plus le temps de l'administrateur pour les correctifs et le TLS que le Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- Sans base de données et sans état persistant au-delà de sa propre configuration, c'est proche du plancher de ce que coûte tout déploiement Cloud Run sur RAD — presque toute la facture est le conteneur lui-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si TechnitiumDNS s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne supprime pas les ressources de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez une configuration de zone personnalisée que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer TechnitiumDNS purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 45 crédits (environ 4,50 US$) dans votre propre projet, ou 41 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si TechnitiumDNS resterait inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement quotidien — par rapport au total du projet ci-dessus (environ 0,56 US$ par jour), cela représente environ 9 jours ou plus, ou environ 14 jours ou plus dans un projet géré par RAD (3 crédits par jour). Il n'y a pas de base de données ici, donc la suppression de cette application libère son coût de fonctionnement total plutôt qu'une simple part de celui-ci.

Gardez les données en premier : tout ce que TechnitiumDNS écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui, alors copiez tout ce que vous voulez conserver avant de le supprimer.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Aucun SaaS commercial hébergé actuellement vérifié n'existe pour cette surface TechnitiumDNS, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

TechnitiumDNS s'exécute comme un seul conteneur pré-construit sur Cloud Run v2. Le déploiement connecte un ensemble délibérément restreint de services Google Cloud — TechnitiumDNS n'a pas de dépendance de base de données ou de cache propre :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur pré-construit unique, 500m vCPU / 512 MiB par défaut ; facturation basée sur les requêtes, mise à l'échelle à zéro |
| Base de données | **Aucune** | `database_type = "NONE"` ; les zones/paramètres/journaux sont des fichiers plats locaux, aucune provision Cloud SQL |
| Persistance | Cloud Storage (GCS FUSE) | Bucket de configuration monté à `/etc/dns` ; survit aux redémarrages et aux redéploiements |
| Stockage d'objets | Cloud Storage | Un bucket "config" auto-créé (également la couche de persistance ci-dessus) |
| Cache / file d'attente | **Aucun** | Pas de Redis ; TechnitiumDNS n'a pas besoin de cache externe |
| Secrets | Secret Manager | Un secret auto-généré : `DNS_SERVER_ADMIN_PASSWORD` |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` pour la **console web uniquement** — le port 53 n'est jamais exposé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — TechnitiumDNS conserve les zones, les paramètres et les journaux sous forme de fichiers plats locaux sous `/etc/dns`. Les variables liées à la base de données existent pour être complètes mais sont inertes.
- **Persistant par défaut.** Un volume GCS FUSE est monté automatiquement à `/etc/dns` — la configuration, les zones et les journaux survivent aux redémarrages et aux redéploiements sans configuration supplémentaire.
- **Image pré-construite, pas de Dockerfile personnalisé.** `container_image_source = "prebuilt"` déploie `technitium/dns-server` tel quel — vérifié localement pour démarrer proprement et honorer `DNS_SERVER_ADMIN_PASSWORD` / `DNS_SERVER_DOMAIN` au premier démarrage.
- **Mise à l'échelle à zéro par défaut** (`min_instance_count = 0`, `cpu_always_allocated = false`) — la console d'administration est une application simple de requête/réponse sans planificateur d'arrière-plan ni flux WebSocket.
- **Le point de terminaison de santé est `/`**, la page racine non authentifiée de la console, qui renvoie HTTP 200 avec le HTML complet de la console dès que le serveur lie son port.
- **Un secret auto-généré.** `DNS_SERVER_ADMIN_PASSWORD` amorce le compte `admin` initial uniquement au tout premier démarrage ; les redémarrages ultérieurs l'ignorent (le `auth.config` persistant l'emporte).
- **Pas de résolveur DNS.** Voir le §7 ci-dessous — c'est la chose la plus importante à comprendre avant de déployer ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service de console TechnitiumDNS {#a-cloud-run--the-technitiumdns-console-service}

TechnitiumDNS s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la
répartition du trafic.

### B. Persistance — le bucket Cloud Storage de configuration {#b-persistence--the-config-cloud-storage-bucket}

TechnitiumDNS n'a **pas d'instance Cloud SQL**. Toutes les zones, les paramètres, la base de données d'authentification et les journaux se trouvent sous
`/etc/dns`, sauvegardés par un bucket Cloud Storage monté en GCS FUSE créé pour ce déploiement.

- **Console :** Cloud Storage → Buckets → trouvez le bucket nommé `gcs-<service-name>-config`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-config"
  gcloud storage ls "gs://<bucket-name>/"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de montage de volume GCS FUSE.

### C. Secret Manager {#c-secret-manager}

TechnitiumDNS génère exactement un secret au moment du déploiement : le mot de passe administrateur initial.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut — il s'agit de l'**URL de la console web**, pas d'un point de terminaison DNS. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés pour la console ; rien de tout cela n'expose la résolution DNS (port 53).

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application TechnitiumDNS {#3-technitiumdns-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** TechnitiumDNS n'a pas de base de données externe et pas d'étape de migration. Il lit/écrit des fichiers plats locaux sous `/etc/dns` dès son démarrage.
- **Amorçage de l'administrateur au premier démarrage.** `DNS_SERVER_ADMIN_PASSWORD` est appliqué uniquement lorsque `/etc/dns/auth.config` n'existe pas encore (un déploiement véritablement neuf). À chaque redémarrage ou redéploiement ultérieur, le `auth.config` persistant sur le volume monté GCS l'emporte et le mot de passe injecté est ignoré.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui renvoie HTTP 200 avec le HTML complet de la console dès que le serveur lie le port 5380. Vérifier :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"   # expect 200 and a large body
  ```
- **Connexion.** Ouvrez `$SERVICE_URL` dans un navigateur, connectez-vous en tant que `admin` avec le mot de passe stocké dans Secret Manager, et changez-le immédiatement depuis la page de gestion des utilisateurs de la console (Technitium ne relit pas `DNS_SERVER_ADMIN_PASSWORD` après le premier démarrage, donc le changer là est le seul moyen de le faire tourner à l'avenir).
- **API REST.** Toutes les actions de la console sont également disponibles via l'API REST (`$SERVICE_URL/api/...`) en utilisant un jeton de session obtenu via `/api/user/login`. Voir la [documentation de l'API de Technitium](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **Pas de résolution DNS à partir de ce déploiement.** Voir le §7 ci-dessous.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour TechnitiumDNS sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `application_name` | `technitiumdns` | Nom de base pour le service, le dépôt de registre et les secrets. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `TechnitiumDNS` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image TechnitiumDNS (par exemple `latest`, `13.5.1`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle telle quelle ; `custom` accepté pour la compatibilité ascendante mais aucun Dockerfile n'est fourni. |
| `cpu_limit` | `"1000m"` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512 Mo). |
| `min_instance_count` | `0` | Mise à l'échelle à zéro en cas d'inactivité. |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `container_port` | `5380` | Port par défaut de la console web. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — pas de travail en arrière-plan à maintenir au chaud. |
| `enable_cloudsql_volume` | `false` | Désactivé — TechnitiumDNS n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mise en miroir de l'image TechnitiumDNS dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à la console par défaut. |
| `enable_iap` | `false` | Exiger la connexion Google. **Fortement recommandé** — la console ne dépendrait autrement que de son propre mot de passe administrateur. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `DNS_SERVER_*` supplémentaires (par exemple `DNS_SERVER_FORWARDERS`, `DNS_SERVER_DOMAIN`). |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager (secrets supplémentaires ; `DNS_SERVER_ADMIN_PASSWORD` est déjà câblé). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires à monter ; le bucket de configuration à `/etc/dns` est ajouté automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de configuration auto-créé. |
| `enable_nfs` | `false` | Non nécessaire par défaut — le volume GCS à `/etc/dns` persiste déjà l'état. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | TechnitiumDNS n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `technitiumdns` | Inerte — aucune base de données n'est provisionnée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | TechnitiumDNS n'a pas besoin de job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 20s de délai | Sonde de démarrage ciblant la page racine publique de la console. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — TechnitiumDNS n'a pas de dépendance Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut de la console web (pas un point de terminaison DNS). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de configuration). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le
> moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification.
> Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit
> créée.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à ce que ce soit un résolveur DNS | Ne pas pointer les paramètres DNS du client vers ce déploiement | **Critique** | Le port 53/udp+tcp n'est jamais exposé par l'entrée HTTP(S) uniquement de Cloud Run — les requêtes DNS vers ce déploiement échouent simplement ; seule la console web/API est accessible. |
| `enable_iap` | `true` pour tout ce qui dépasse un test rapide | Critique | Sans IAP, la console n'est protégée que par son propre mot de passe administrateur sur l'internet public — une seule information d'identification divulguée/faible donne un accès complet à la gestion DNS. |
| Rotation de `DNS_SERVER_ADMIN_PASSWORD` | Changer le mot de passe depuis la console après la première connexion | Élevé | Technitium ne relit jamais la variable d'environnement après le premier démarrage — la rotation de la valeur Secret Manager seule NE change PAS le mot de passe effectif de la console. |
| Volume GCS à `/etc/dns` | Laisser `enable_gcs_storage_volume` activé (par défaut) | Critique | Sans volume persistant monté, le système de fichiers racine en lecture seule de Cloud Run empêcherait toute modification de configuration/zone de survivre à un redémarrage ou à un redéploiement. |
| `ingress_settings` | `all` pour l'accès à la console, `internal` derrière IAP/VPN uniquement si telle est l'intention | Moyen | `internal` bloque tout accès externe à la console, y compris l'opérateur, à moins qu'un chemin VPN/bastion n'existe. |
| `min_instance_count` | `0` (par défaut) est suffisant pour une utilisation administrative occasionnelle | Faible | Les démarrages à froid ajoutent quelques secondes de latence à la première requête après l'inactivité ; n'augmentez à `1` que si cela est important. |
| `application_version` | Épingler une version explicite en production | Faible | `latest` suit les versions en amont ; épingler explicitement pour contrôler le moment de la mise à niveau. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée
et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images —
voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à TechnitiumDNS partagée avec la
variante GKE est décrite dans **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : TechnitiumDNS sur Cloud Run](../labs/TechnitiumDNS_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [TechnitiumDNS Common — Configuration d'application partagée](TechnitiumDNS_Common.md) — la configuration partagée par les deux cibles de déploiement.
