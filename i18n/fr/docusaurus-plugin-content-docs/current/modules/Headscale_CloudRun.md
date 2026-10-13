---
title: "Headscale sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Headscale sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Headscale_CloudRun.md @ e69407af sha256:697d05414c4c -->

# Headscale sur Google Cloud Run {#headscale-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_CloudRun.png" alt="Headscale sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Headscale est une implémentation open-source et auto-hébergée du serveur de
coordination Tailscale — un plan de contrôle pour un VPN maillé WireGuard
privé, compatible avec les clients Tailscale officiels. Headscale n'est **pas**
une passerelle ou un relais VPN en soi : il authentifie les nœuds, distribue
la clé publique et l'allocation IP de chaque pair, et maintient la carte
réseau du maillage synchronisée. Le trafic chiffré réel entre les appareils
circule directement, de pair à pair, via WireGuard (ou via l'infrastructure
de relais DERP publique de Tailscale lorsqu'une connexion directe n'est pas
possible) — il ne passe jamais par Headscale. Ce module déploie Headscale sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Headscale et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Headscale sur RAD, et comment cela se compare {#what-headscale-costs-on-rad-and-how-that-compares}

**L'exécution de Headscale sur Cloud Run dans votre propre projet Google Cloud coûte environ 31,01 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 40 crédits facturé une seule fois au moment du déploiement. Headscale est une réimplémentation indépendante et open-source d'un serveur de coordination WireGuard privé, compatible avec les clients Tailscale officiels — ce n'est pas une version hébergée d'un produit commercial, il n'y a donc pas de prix SaaS à citer. Dans un projet géré par RAD, les frais de module tombent à 36 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Headscale_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 31,01 $/mois, facturé par Google au prix catalogue | ~9 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **31,01 $** |

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — plus que ce dont ce serveur de coordination léger de 1 vCPU/1 GiB a besoin, mais le plus petit point de référence largement cité.
- Headscale n'a pas besoin de sa propre base de données dans ce déploiement (il utilise SQLite en interne), donc la majeure partie de son coût d'exécution en projet propre ci-dessus est le petit serveur de fichiers NFS, et non une instance Postgres gérée.
- Le compromis administratif est le même que pour chaque entrée ici : un VPS moins cher, auto-patché, contre le serveur de fichiers géré par RAD, Secret Manager et la surveillance.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne démantèle **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Headscale et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et la remise en service de Headscale signifie un redéploiement à partir de
zéro. Cela coûte environ 43-46 crédits (les 40 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Headscale devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Headscale, c'est environ 5 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagée ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de laboratoire, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Headscale s'exécute comme un seul binaire Go sur Cloud Run v2, construit à
partir d'une image amont personnalisée basée sur `ko`. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 1 GiB par défaut ; épinglé à une seule instance |
| Base de données | SQLite embarqué | Pas d'instance Cloud SQL — `database_type = "NONE"` |
| Persistance | Cloud Filestore (NFS) | Le fichier SQLite et les clés WireGuard/Noise résident à `/var/lib/headscale`, sur le partage NFS par défaut |
| Secrets | Secret Manager | Aucun — Headscale n'a pas de secrets au niveau de l'application dans ce module |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; doit rester publique pour que les clients Tailscale réels puissent s'enregistrer |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge.** Il n'y a pas
  d'instance Cloud SQL externe ; tout l'état (registre des nœuds, clés de
  pré-authentification, clé privée du protocole Noise) réside dans un seul
  fichier SQLite sous `/var/lib/headscale`.
- **`max_instance_count` est codé en dur à `1` en aval, pas seulement par
  défaut.** `Headscale_Common` définit `config.max_instance_count = 1` comme une valeur littérale —
  la variable `max_instance_count` du module d'application n'est jamais réellement
  lue. Headscale n'a pas de support actif-actif, et deux rédacteurs contre le
  même fichier SQLite le corrompraient.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
  Contrairement aux applications avec une base de données ou un index de
  recherche à réchauffer, le fichier SQLite et la clé WireGuard de Headscale
  rendent les démarrages à froid rapides.
- **Le stockage est sur NFS, et WAL est désactivé.** Cloud Run n'a pas de
  périphérique de bloc, et GCS Fuse ne peut pas héberger SQLite (pas de
  verrouillage POSIX ou de mémoire partagée), donc `/var/lib/headscale` est le chemin
  de montage NFS (`enable_nfs = true` par défaut) et le bucket GCS Fuse n'est monté
  là que si NFS est désactivé. NFS fournit le verrouillage POSIX mais pas le
  mappage de mémoire partagée dont WAL a besoin, donc cette variante exécute
  SQLite avec `write_ahead_log` désactivé. Voir [Pièges](#7-pitfalls--gotchas)
  ci-dessous.
- **L'ingress public est requis pour que les clients Tailscale puissent
  s'enregistrer.** `ingress_settings = "all"` est la valeur par défaut afin que les appareils
  partout sur Internet puissent atteindre le serveur de coordination.
  L'activation d'IAP bloquerait entièrement l'enregistrement des clients — la
  CLI `tailscale` ne peut pas présenter une identité Google.
- **MagicDNS est désactivé par défaut.** Il nécessite que `dns.base_domain` soit
  défini et réellement différent du domaine de `server_url` — une contrainte
  qu'une seule valeur par défaut ne peut pas satisfaire de manière fiable par
  déploiement.
- **Pas de job d'initialisation par défaut.** Contrairement aux applications
  soutenues par une base de données externe, le fichier SQLite de Headscale
  est créé automatiquement au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#6-outputs)
du déploiement.

### A. Cloud Run — le service Headscale {#a-cloud-run--the-headscale-service}

Headscale s'exécute comme un seul service Cloud Run v2. Parce que `max_instance_count`
est codé en dur à `1`, il n'y a pas de mise à l'échelle automatique
horizontale à observer — seulement la mise à l'échelle à zéro et les
démarrages à froid.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Le volume de stockage SQLite {#b-the-sqlite-storage-volume}

`/var/lib/headscale` contient `db.sqlite`, `noise_private.key` et la clé WireGuard
héritée. Par défaut, c'est le chemin de montage NFS. Un bucket GCS `storage`
dédié est également provisionné ; il est monté à `/var/lib/headscale` via GCS Fuse
uniquement lorsque `enable_nfs = false` — évitez cela, car une base de données SQLite
écrite via GCS Fuse est corrompue tant que `/health` passe encore.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les mécanismes de montage GCS Fuse
et les options CMEK.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible via son URL `run.app` par défaut, permettant un
accès public — requis pour que les clients Tailscale réels sur des appareils/réseaux
arbitraires puissent atteindre le serveur de coordination et s'enregistrer. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging. Au démarrage, une
instance saine enregistre la génération de la clé privée, "base de données
ouverte avec succès" et "écoute et sert HTTP". Les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Headscale {#3-headscale-application-behaviour}

- **SQLite s'initialise automatiquement au démarrage.** Il n'y a pas de job
  de configuration de base de données séparé — au premier démarrage, Headscale
  crée `db.sqlite` sous `/var/lib/headscale` et applique ses propres migrations de
  schéma internes automatiquement.
- **Génération automatique de clé privée.** Au premier démarrage, Headscale
  génère sa clé privée de protocole Noise à `noise_private.key` (le chemin configuré
  via `noise.private_key_path` dans la configuration intégrée) si elle n'existe pas déjà.
  La perte de cette clé (ou du volume de stockage) oblige chaque nœud client
  précédemment enregistré à se réenregistrer.
- **Point de terminaison de santé.** `/health` est un véritable point de
  terminaison non authentifié — confirmé en direct renvoyant HTTP 200
  parallèlement à "écoute et sert HTTP" dans les journaux de l'application.
  Les sondes de démarrage et de vivacité le ciblent par défaut.
- **La configuration de première exécution est une étape manuelle
  post-déploiement.** Headscale n'est pas livré avec un flux d'inscription
  basé sur le Web. La création du premier "utilisateur" (espace de noms) et
  l'émission d'une clé de pré-authentification pour l'enregistrement des nœuds
  clients se font via la CLI `headscale`, exécutée contre le même binaire
  `/ko-app/headscale` que le service utilise. Sur Cloud Run, la manière pratique
  d'exécuter ces commandes ponctuelles est une exécution de job Cloud Run
  contre l'image déployée :
  ```bash
  # Create the first user/namespace:
  gcloud run jobs execute <job-name> --project "$PROJECT" --region "$REGION" \
    --container <service-name> --command="/ko-app/headscale" \
    --args="users,create,myuser" --wait

  # Issue a pre-auth key for that user (valid 1 hour, reusable):
  gcloud run jobs execute <job-name> --project "$PROJECT" --region "$REGION" \
    --container <service-name> --command="/ko-app/headscale" \
    --args="preauthkeys,create,--user,myuser,--reusable,--expiration,1h" --wait
  ```
  Voir le [lab pratique](../labs/Headscale_CloudRun.md) pour la
  procédure complète et concrète — les mécanismes exacts de job/exécution
  dépendent de la façon dont la plateforme nomme ses ressources d'exécution
  ponctuelles.
- **Connexion d'un client Tailscale réel.** Une fois qu'une clé de
  pré-authentification existe :
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
  L'appareil apparaît alors comme un nœud dans le registre de Headscale.
- **Inspection des nœuds enregistrés :**
  ```bash
  # Run against the deployed binary the same way as user/key creation above:
  # headscale nodes list
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Headscale sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `headscale` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout en la version amont épinglée `HEADSCALE_VERSION=0.26.1` — un ARG de build Dockerfile, pas un passe-partout de version générique. |
| `server_url` | `""` | URL publique du plan de contrôle, intégrée à l'enregistrement de chaque client. Par défaut, l'URL Cloud Run déterministe de ce service si elle est laissée vide. La modifier ultérieurement nécessite de réenregistrer chaque nœud. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources par instance. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; les démarrages à froid sont rapides (pas de base de données/index à réchauffer). |
| `max_instance_count` | `1` | **Codé en dur à `1` en aval quelle que soit cette valeur** — voir [Pièges](#7-pitfalls--gotchas). |
| `container_port` | `8080` | Port d'écoute natif de Headscale. |
| `execution_environment` | `gen2` | Requis pour les montages de stockage NFS (et GCS Fuse). |
| `enable_cloudsql_volume` | `false` | Non applicable — pas de Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour que les clients Tailscale réels sur des réseaux arbitraires puissent atteindre et s'enregistrer. |
| `enable_iap` | `false` | **Ne jamais activer pour une utilisation normale** — IAP nécessite une identité Google, que la CLI `tailscale` ne peut pas présenter, bloquant tout enregistrement client. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` supportant `/var/lib/headscale`. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le bucket `storage` est ajouté automatiquement uniquement lorsque `enable_nfs = false`. |
| `enable_redis` | `true` (déclaré) | Non référencé — codé en dur `false` dans `main.tf` ; Headscale n'a pas besoin de Redis. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Headscale_Common` — Headscale est entièrement basé sur SQLite, il n'y a pas d'instance Cloud SQL. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job par défaut — SQLite s'initialise au premier démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai 15s, seuil 10 | Point de terminaison Headscale réel, non authentifié. |
| `liveness_probe` | HTTP `/health`, délai 30s, seuil 3 | Même point de terminaison. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative sur `/health`. |

---

## 5. Référence d'exploration des services GCP {#5-gcp-service-exploration-reference}

Voir le §2 ci-dessus — Cloud Run, Cloud Storage, réseau et journalisation/surveillance
sont l'ensemble complet des services que ce module touche directement (au-delà de
l'infrastructure partagée VPC/IAM/Artifact Registry commune à chaque déploiement
`App_CloudRun`).

---

## 6. Sorties {#6-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service — c'est ce que `server_url` prédit et ce contre quoi les clients s'enregistrent. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage` supportant `/var/lib/headscale`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 7. Pièges et astuces {#7-pitfalls--gotchas}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs et les combinaisons au moment de la planification.
> Voir [App_CloudRun](App_CloudRun.md) pour le comportement de validation
> général.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_nfs` | `true` (par défaut) | **Critique** | La désactivation de NFS déplace `/var/lib/headscale` sur GCS Fuse, qui ne peut pas héberger SQLite : la base de données est corrompue à l'arrivée alors que `/health` passe toujours. Pour un périphérique de bloc et le mode WAL, utilisez [Headscale_GKE](Headscale_GKE.md) avec `stateful_pvc_enabled = true` (sa valeur par défaut). |
| `max_instance_count` | Laisser à `1` (c'est codé en dur de toute façon) | Élevé | La variable est déclarée mais jamais réellement lue par `Headscale_Common` — `config.max_instance_count` est un littéral `1`. Le définir plus haut donne une fausse impression que la mise à l'échelle horizontale est disponible ; elle ne l'est pas, et corromprait le fichier SQLite si elle l'était. |
| `server_url` | Définir une fois, avant d'enregistrer les clients | Critique | Intégré à l'enregistrement de chaque client. Le modifier après l'enregistrement des clients nécessite de réenregistrer chaque nœud avec la nouvelle URL. |
| `ingress_settings` | `all` | Critique | La définition de `internal` rend le serveur de coordination inaccessible aux clients Tailscale réels sur l'Internet public — tout l'intérêt du déploiement est rompu. |
| `enable_iap` | `false` | Critique | IAP nécessite une identité Google pour chaque requête. La CLI `tailscale` ne peut pas en présenter une, donc l'activation d'IAP bloque tout enregistrement client et tout trafic de synchronisation de maillage. |
| Perte du volume/bucket de stockage | Ne jamais supprimer manuellement le bucket `storage` tant que des nœuds sont enregistrés | Critique | La clé privée du protocole Noise et l'ensemble du registre des nœuds y résident. Sa perte oblige chaque client à se réenregistrer à partir de zéro. |
| MagicDNS (`dns.magic_dns`) | Laisser `false` à moins que vous ne définissiez également un véritable `dns.base_domain` | Moyen | L'activation de MagicDNS sans un `base_domain` valide et distinct du domaine de `server_url` produit une résolution DNS cassée pour les clients ; le module le désactive par conception. |
| `-debug` image assumption | Ne pas supposer qu'un shell est disponible | Faible (temps de build) | Le tag `-debug` inclut busybox mais n'a pas de `/bin/sh` sur `PATH` — une modification naïve du Dockerfile utilisant les étapes de shell `#!/bin/sh` ou `RUN` contre cette base échouera. Déjà géré correctement dans le Dockerfile/point d'entrée fourni ; pertinent si vous le forkez. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à Headscale partagée avec la variante
GKE est décrite dans **[Headscale_Common](Headscale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Headscale sur Cloud Run](../labs/Headscale_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Headscale sur GKE Autopilot](Headscale_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Headscale Common — Configuration d'application partagée](Headscale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Communications d'équipe sécurisées**.
