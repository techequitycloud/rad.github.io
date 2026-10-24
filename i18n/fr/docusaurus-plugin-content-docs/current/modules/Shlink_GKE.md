---
title: "Shlink sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Shlink sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Shlink_GKE.md @ 1665a43e sha256:8ec53c259333 -->

# Shlink sur GKE Autopilot {#shlink-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Shlink_GKE.png" alt="Shlink sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Shlink est un raccourcisseur d'URL auto-hébergé et open source qui expose une
API REST, un client web, la génération de codes QR et des analyses détaillées
de suivi des visites. Ce module déploie Shlink sur **GKE Autopilot** sur la
base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Shlink et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de Shlink sur RAD et comparaison {#what-shlink-costs-on-rad-and-how-that-compares}

**L'exécution de Shlink dans votre propre projet GCP coûte environ 91,31 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option la moins chère ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~91,31 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~91 crédits/jour, mesuré à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **91,31 $** |

### Comparaison {#how-it-compares}

- L'empreinte propre de Shlink ici (1x vCPU / 0,5 GiB) est plus petite que cette classe de référence, donc un niveau de VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Un raccourcisseur d'URL répond à des redirections simples de manière continue mais à faible coût — la base de données est le principal coût permanent ici, pas le service de raccourcissement lui-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu.
Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources
déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture plus jamais les frais de module. Cela ne coûte qu'une poignée de crédits (moins
de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la création
d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des
utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau
pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et la suppression logique de Cloud Storage est explicitement
désactivée pour ce bucket, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez
une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer.
Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Shlink purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Shlink reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conservez les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Shlink s'exécute comme une seule charge de travail PHP/Swoole sans état, avec
tout l'état dans PostgreSQL — il n'y a pas de persistance de système de
fichiers à gérer.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un seul conteneur sur le port `8080`, `1000m` CPU / `512Mi` mémoire par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` |
| Stockage d'objets | Cloud Storage | Aucun provisionné — Shlink stocke tout dans PostgreSQL |
| Secrets | Secret Manager | `INITIAL_API_KEY` (première clé d'API REST) et mot de passe de la base de données auto-générés |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est fixé par le module
  Common ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur la boucle locale.**
  `enable_cloudsql_volume = true` injecte un sidecar cloud-sql-proxy ; App_GKE définit
  ensuite `DB_HOST = DB_IP = 127.0.0.1`. Shlink lit `DB_HOST`/`DB_USER`/
  `DB_NAME`/`DB_PASSWORD` directement depuis l'environnement — aucun
  remapping de point d'entrée n'est nécessaire.
- **`DB_NAME`/`DB_USER` sont intentionnellement laissés non définis par le
  module Common.** La fondation crée le rôle/la base de données Cloud SQL
  selon sa propre convention de nommage limitée au locataire et injecte les
  valeurs réelles ; les prérégler aux noms courts `shlink`/`shlink`
  s'authentifierait comme un rôle jamais créé.
- **Pas de système de fichiers persistant.** `gcs_volumes` est par défaut
  `[]` et NFS n'est pas câblé — Shlink stocke les URL courtes, les
  visites et les clés API entièrement dans PostgreSQL, il n'y a donc rien à
  persister en dehors de la base de données.
- **Les migrations de base de données s'exécutent automatiquement au démarrage du
  conteneur.** L'image officielle `shlinkio/shlink` exécute ses propres
  migrations de schéma au démarrage ; il n'y a pas de job de migration séparé
  (seulement `db-init`, qui crée le rôle/la base de données).
- **`INITIAL_API_KEY` est généré automatiquement** et stocké dans Secret
  Manager, puis injecté comme variable d'environnement secrète du conteneur
  afin que Shlink amorce sa première clé d'API REST au démarrage initial.
  Récupérez-la après le déploiement — Shlink n'a pas de connexion
  administrateur/mot de passe ; tout accès est basé sur une clé API.
- **Le Dockerfile construit toujours `FROM shlinkio/shlink:stable`** — contrairement à la
  plupart des modules de build personnalisés de ce dépôt, `application_version`
  n'est **pas** câblé dans le tag d'image via un ARG de build
  (`container_build_config` conserve `build_args = {}`). La modification de
  `application_version` n'a aucun effet sur l'image construite. {/* TODO: verify this is intentional and not a gap */} Épinglez une version
  spécifique en modifiant directement la ligne `Dockerfile` `FROM`
  du module Common.
- **Échelle 1→3 pods par défaut** (`min_instance_count = 1`, `max_instance_count = 3`).
  Shlink est sans état par requête contre PostgreSQL, donc la mise à l'échelle
  horizontale est sûre dès le départ.
- **`DEFAULT_DOMAIN` n'est pas préréglé.** Le nom d'hôte public utilisé lors de
  la génération d'URL courtes est inconnu avant le déploiement — définissez-le
  via `environment_variables` une fois que l'IP du LoadBalancer ou le domaine
  personnalisé est connu.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Shlink {#a-gke-autopilot--the-shlink-workload}

Les pods Shlink sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. La charge de travail n'a pas de stockage
persistant, elle se déploie donc comme un `Deployment` standard avec la
stratégie `RollingUpdate` par défaut.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Shlink pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Shlink stocke toutes les données de l'application (URL courtes, enregistrements
de visites, tags et clés API) dans une instance Cloud SQL pour PostgreSQL 15
gérée. Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` (utilisant `postgres:15-alpine`) crée de
manière idempotente le rôle et la base de données de l'application, accorde la
propriété et les privilèges, puis arrête son propre sidecar proxy via le
point de terminaison `quitquitquit`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets soutiennent le déploiement : `INITIAL_API_KEY` (la première clé
d'API REST de Shlink, auto-générée par `Shlink_Common` et injectée comme
variable d'environnement secrète afin que l'application l'amorce au premier
démarrage) et le mot de passe de la base de données (géré par la fondation).
Sur GKE, les secrets sont projetés dans les pods via le pilote CSI du Secret
Store / SecretSync.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~shlink"
  gcloud secrets versions access latest --secret=<initial-api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré
par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et
Cloud SQL vers Cloud Monitoring. Des vérifications de disponibilité et des
politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Shlink {#3-shlink-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il
  attend que PostgreSQL soit accessible, puis `CREATE` (ou
  `ALTER`) de manière idempotente le rôle et la base de données de
  l'application, accorde la propriété et `ALL PRIVILEGES`, et accorde
  `ALL ON SCHEMA public`. Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`). Il s'authentifie en tant que `postgres` en
  utilisant le même secret que le propre `DB_PASSWORD` de l'application
  (`ROOT_PASSWORD` et `DB_PASSWORD` font tous deux référence à
  `database_password_secret`). {/* TODO: verify ROOT_PASSWORD vs DB_PASSWORD sharing the same secret is intentional */}
- **Les migrations de base de données s'exécutent au démarrage, pas de job de
  migration séparé.** L'image officielle `shlinkio/shlink` exécute ses
  propres migrations de schéma au démarrage du conteneur sur la base de
  données vide créée par `db-init` ; il n'y a pas d'étape de
  migration `execute_on_apply` à attendre au-delà de `db-init` elle-même.
- **Pas de compte administrateur — accès basé sur une clé API.** Shlink n'a
  pas de nom d'utilisateur/mot de passe administrateur. `Shlink_Common` génère
  `INITIAL_API_KEY` et l'injecte comme variable d'environnement secrète ;
  l'image la lit au premier démarrage pour amorcer la première clé d'API REST
  valide. Récupérez-la depuis Secret Manager (voir [2.C](#c-secret-manager))
  et utilisez-la comme en-tête `X-Api-Key` contre l'API REST ou la
  connexion du client web.
- **La connectivité DB est en boucle locale via le sidecar Auth Proxy.** Avec
  `enable_cloudsql_volume = true` (par défaut), App_GKE injecte `DB_HOST = DB_IP = 127.0.0.1` ;
  Shlink lit `DB_HOST`, `DB_USER`, `DB_NAME` et
  `DB_PASSWORD` directement — aucune gestion de chemin de socket ou
  d'URL-DSN n'est nécessaire.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  **HTTP** `GET /rest/health` — un point de terminaison public non authentifié
  qui renvoie HTTP 200 avec `{"status":"pass"}` (`application/health+json`). Il n'y a
  pas de page d'accueil web à `/` (elle renvoie 404), utilisez
  donc `/rest/health` pour les vérifications manuelles également.
  `failure_threshold = 30` à `period_seconds = 10` sur la sonde de démarrage couvre
  environ 300 s pour les migrations au premier démarrage.
- **Sans état — sûr à mettre à l'échelle horizontalement.** Tout l'état
  réside dans PostgreSQL, donc les valeurs par défaut `min_instance_count = 1` /
  `max_instance_count = 3` et la stratégie de déploiement standard `RollingUpdate`
  sont toutes deux sûres sans réglage supplémentaire.
- **Définissez `DEFAULT_DOMAIN` une fois que l'IP/le domaine est connu.** Il n'est
  pas préréglé — ajoutez-le via `environment_variables` une fois que l'IP du
  LoadBalancer ou le domaine personnalisé est attribué, afin que les URL
  courtes générées utilisent l'hôte public correct :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" DEFAULT_DOMAIN=shlink.example.com
  ```
- **Géolocalisation des visites facultative.** Shlink peut résoudre la
  géolocalisation des visiteurs via une base de données MaxMind GeoLite2 si
  un `GEOLITE_LICENSE_KEY` est fourni ; il n'est pas défini par ce module —
  ajoutez-le via `environment_variables` si la géolocalisation est souhaitée. {/* TODO: verify exact env var name and download behaviour against the running image */}
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DB_
  curl -s http://<external-ip-or-domain>/rest/health
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Shlink sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `shlink` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Non câblé dans le build de l'image — le Dockerfile construit toujours `FROM shlinkio/shlink:stable`. |
| `admin_username` | `shlink` | Non utilisé par Shlink (authentification par clé API, pas de comptes administrateur). Conservé pour la parité de l'interface wrapper. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Cloud Build construit l'image wrapper légère `shlinkio/shlink:stable`. |
| `container_image` | `shlinkio/shlink:stable` | Utilisé uniquement lorsque `container_image_source = "prebuilt"`. |
| `container_port` | `8080` | Le serveur HTTP de Shlink écoute sur `8080`. |
| `container_resources.cpu_limit` | `1000m` | 1 vCPU. |
| `container_resources.memory_limit` | `512Mi` | Suffisant pour l'environnement d'exécution PHP basé sur Swoole. |
| `min_instance_count` | `1` | Réplicas de pods minimum (HPA `minReplicas`). |
| `max_instance_count` | `3` | Réplicas de pods maximum — sûr à augmenter puisque Shlink est sans état. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale) — requis sur GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de montage du socket Unix pour le sidecar proxy. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'API REST et le client web Shlink. |
| `workload_type` | `null` → `Deployment` | Déploiement (sans état, stratégie `RollingUpdate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Aucun bucket défini par le module Common — Shlink n'en a pas besoin. |
| `gcs_volumes` | `[]` | Vide par défaut — Shlink stocke toutes les données dans PostgreSQL et n'a pas besoin de système de fichiers persistant. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — le seul moteur pris en charge. |
| `application_database_name` | `shlink` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `shlink` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/rest/health`, `failure_threshold=30`, `period_seconds=10` | Public, non authentifié — couvre ~300s pour les migrations au premier démarrage. |
| `health_check_config` | HTTP `/rest/health`, `failure_threshold=3`, `period_seconds=30` | Sonde de vivacité ; même point de terminaison public. |
| `uptime_check_config` | `enabled=false`, `path=/rest/health` | Activer pour une vérification de disponibilité externe de Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL pour atteindre Shlink. |
| `health_check_url` | URL de vérification de santé prête à être utilisée avec curl (`/rest/health`) — utilisez celle-ci, pas `/`, qui renvoie 404. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Shlink). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans
> identités autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixe) | Critique | Non modifiable — Shlink ne prend en charge que PostgreSQL. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les URL courtes et l'historique des visites. |
| `environment_variables` (`DB_NAME`/`DB_USER`) | Ne pas définir manuellement | Critique | La surcharge de ces valeurs aux noms courts `shlink`/`shlink` contourne le rôle de la fondation limité au locataire, provoquant `password authentication failed`. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité DB sur GKE. |
| `INITIAL_API_KEY` (auto-généré) | Récupérer après le déploiement | Élevé | Shlink n'a pas de connexion administrateur — perdre la trace de ce secret sans le faire pivoter vous bloque l'accès à l'API REST et au client web. |
| `startup_probe_config` / `health_check_config` chemin | `/rest/health` | Élevé | Pointer les sondes vers `/` (404) ou un point de terminaison authentifié empêche le pod de devenir jamais Prêt. |
| `max_instance_count` | `3` (ou plus) | Faible | Shlink est sans état ; la mise à l'échelle au-delà de 3 est sûre si le trafic le justifie — pas de risque de stockage partagé/verrouillage. |
| `DEFAULT_DOMAIN` (définir après le déploiement) | URL externe du LoadBalancer/domaine | Moyen | Un domaine erroné ou manquant fait pointer les URL courtes générées vers le mauvais hôte. |
| `memory_limit` | `512Mi` | Moyen | Le plancher de mémoire gen2/Autopilot et les besoins d'exécution de Swoole ; augmenter si les pods OOM sous charge soutenue. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et tout `DEFAULT_DOMAIN` codé en dur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données d'URL courtes et de l'historique des visites. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Shlink
partagée avec la variante Cloud Run est décrite dans
**[Shlink_Common](Shlink_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Shlink sur GKE Autopilot](../labs/Shlink_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Shlink sur Google Cloud Run](Shlink_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Shlink Common — Configuration d'application partagée](Shlink_Common.md) — la configuration partagée par les deux cibles de déploiement.
