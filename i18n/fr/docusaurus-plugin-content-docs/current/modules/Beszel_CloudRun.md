---
title: "Beszel sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Beszel sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Beszel_CloudRun.md @ e69407af sha256:b42581ce8087 -->

# Beszel sur Google Cloud Run {#beszel-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_CloudRun.png" alt="Beszel sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel est un hub de surveillance de serveurs léger et open source — métriques
historiques des ressources, statistiques des conteneurs Docker et alertes
configurables, construit sur PocketBase (Go plus une base de données SQLite
embarquée). Ce module déploie le hub Beszel sur **Cloud Run v2** au-dessus de
la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Beszel et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Beszel sur RAD, et comment cela se compare {#what-beszel-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Beszel sur RAD coûte environ 33 $ US par mois dans
votre propre projet Google Cloud, sans frais de licence supplémentaires** —
Beszel est open source. Dans un projet géré par RAD pour vous, le même
déploiement est facturé à **15 crédits par jour** (environ 450 par mois, soit
environ 45 $ US au prix de la recharge). Ou consultez le [guide GKE](Beszel_GKE.md)
pour une capacité toujours active sur les pods. Si vous n'avez besoin de Beszel
qu'occasionnellement — études, démo, projet de courte durée — un projet géré par
RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de
sorte que ce chiffre mensuel devient quelques dollars. Voir **Mettez-le en
pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Beszel est open source, il n'y a donc pas de frais de licence. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **33 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **15 crédits par jour**, environ 450 par mois (environ 45 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins sur un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 33 $ US** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes en africa-south1
(Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **Ce module est maintenu chaud par défaut** (`min_instance_count ≥ 1`), de sorte que le chiffre
  Cloud Run ci-dessus suppose déjà qu'il ne se met jamais à l'échelle à zéro.

### Comment cela se compare, pour la surveillance d'une petite flotte de serveurs {#how-it-compares-for-monitoring-a-small-server-fleet}

Beszel n'est livré que sous forme de binaire/image Docker auto-hébergé — le
projet ne vend pas de version hébergée, donc la comparaison honnête est un
serveur nu :

- Un Hetzner CPX22 ou un droplet DigitalOcean (2 vCPU/4 Go, environ 24 $ US/mois)
  ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 $ US/mois)
  exécuterait Beszel confortablement — en fait surdimensionné, puisque l'empreinte
  de Beszel ici n'est que de 1 vCPU/1 GiB, donc une classe d'instance plus petite
  et moins chère ferait tout aussi bien l'affaire.
- La différence est ce qui est géré pour vous : sur un VPS nu, vous possédez le
  système d'exploitation, les correctifs de sécurité et votre propre discipline de
  sauvegarde. Le module de RAD vous offre le calcul, Secret Manager et Cloud
  Monitoring déjà câblés, pour les frais de module plus l'utilisation de Google
  Cloud ci-dessus.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Beszel s'exécute dans **un projet géré par RAD pour vous**, la suppression
de l'ensemble du projet — plutôt que la suppression de ce seul module —
délie d'abord sa facturation, puis demande à Google de supprimer le projet
définitivement. Google le conserve, récupérable, pendant 30 jours, et comme la
facturation est déjà déliée, rien n'est facturé pendant cette période. Contrairement
à la suppression d'un module, cela ne détruit pas Cloud SQL, une VM ou la
ressource de calcul une par une : l'ensemble du projet s'arrête simplement.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de récupérer le projet
  et de rattacher son compte de facturation, puis d'exécuter **Update** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes, et une mise à jour ne facture jamais les frais de module à nouveau.
  Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte
  qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 $ US).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD ne gère que la facturation), le restaurer vous-même dans les 30 jours —
  après cela, Google le supprime définitivement — et atteindre à nouveau le
  seuil d'admission du palier (100 crédits pour le palier sandbox, ce qui
  convient à la plupart des utilisations d'étude/démo). Google indique que la
  plupart des services fonctionnent à nouveau pleinement dans les 36 heures
  suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  a la suppression logicielle de Cloud Storage désactivée, il est donc très
  probable qu'il disparaisse dès que le projet est supprimé — même si le projet
  lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a
  quelque chose d'irremplaçable ; pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds : environ 44 crédits (environ 4,40 $ US) au prix de la recharge, et
  environ 15 à 20 minutes de temps de build (moyenne de la plateforme RAD). La
  suppression ne permet d'économiser de l'argent que si Beszel devait rester
  inutilisé pendant environ **3 jours ou plus** — dans votre propre projet,
  cela représente environ 1,09 $ US par jour, et dans un projet géré par RAD,
  c'est 15 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données
  et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de
  Beszel alors qu'une autre application partage le projet n'économise que la
  partie calcul de Beszel.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez
  la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un
chiffre.

## 1. Vue d'ensemble {#1-overview}

Beszel s'exécute comme un conteneur Go unique sur Cloud Run v2, servant son
interface utilisateur web et son API REST sur le port 8090. Il conserve tout
l'état dans une base de données SQLite embarquée sous `/beszel_data`, qui est montée
à partir du volume NFS (Filestore) partagé. Le déploiement relie un ensemble
délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Go unique, 1 vCPU / 1 GiB par défaut, port 8090 |
| Base de données | **Aucune** | Beszel intègre sa propre base de données PocketBase/SQLite — aucune base de données Cloud SQL n'est provisionnée |
| Stockage de fichiers | Cloud Filestore (NFS) | Monté à `/beszel_data` pour toute persistance ; le volume de données GCS est désactivé tant que NFS possède ce chemin |
| Cache et file d'attente | **Aucun** | Beszel n'utilise pas Redis ; `enable_redis` est désactivé de force |
| Secrets | Secret Manager | Aucun secret d'application injecté — le premier administrateur est créé dans l'interface utilisateur |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de base de données, pas de Redis.** Beszel est autonome — `database_type = "NONE"`,
  `enable_cloudsql_volume = false` et `enable_redis = false`. Tout l'état est la base de données SQLite
  embarquée sous `/beszel_data`.
- **La persistance est NFS, pas GCS FUSE.** `enable_nfs = true` monte le partage NFS à
  `/beszel_data`, de sorte que la base de données SQLite et les métriques
  historiques survivent aux remplacements de révisions et aux événements de
  mise à l'échelle. GCS FUSE ne peut pas héberger les bases de données SQLite en
  mode WAL de Beszel (il lui manque le verrouillage dont SQLite a besoin), de
  sorte que le volume de données GCS est désactivé chaque fois que NFS est monté
  à `/beszel_data`. Conservez `enable_nfs = true`.
- **L'instance unique est délibérée.** `min_instance_count = max_instance_count = 1`. Beszel est une application à
  écrivain unique (un fichier SQLite) ; l'exécution de plusieurs instances
  contre la même base de données risque des conflits de verrouillage et une
  corruption. Ne **pas** augmenter `max_instance_count`.
- **`min_instance_count = 1` (pas de mise à l'échelle à zéro).** Le hub est maintenu chaud
  afin que la base de données SQLite reste ouverte et que les agents puissent
  signaler en continu ; il s'agit d'un backend de surveillance, pas d'une
  application de requête/réponse en rafale.
- **Port 8090.** Le hub de Beszel écoute sur le port 8090 ; le port du conteneur
  et les sondes sont configurés en conséquence.
- **Ingress public par défaut.** `ingress_settings = "all"` expose l'URL `run.app` afin que
  les agents distants et les navigateurs puissent atteindre le hub. L'activation
  d'IAP bloquera le rapport des agents depuis les machines qui ne peuvent pas
  présenter une identité Google.
- **Chemin de santé `/api/health`.** Les sondes de démarrage et de vivacité
  atteignent le point de terminaison de santé public et non authentifié du hub
  (200 quand il est prêt).
- **L'administrateur initial est créé dans l'interface utilisateur.** Aucun mot
  de passe administrateur n'est stocké dans Secret Manager ; ouvrez le hub
  après le déploiement et complétez la configuration du superutilisateur de
  PocketBase lors de la première exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Beszel {#a-cloud-run--the-beszel-service}

Beszel s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable ; comme l'application est à écrivain unique, le service est
épinglé à une seule instance plutôt qu'à une mise à l'échelle automatique.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~beszel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. NFS — le volume `/beszel_data` {#b-nfs--the-beszel_data-volume}

Le volume NFS partagé (Cloud Filestore ou le serveur NFS Services_GCP) contient
tout l'état de Beszel (la base de données SQLite, la configuration et les
métriques historiques). Il est monté à `/beszel_data` (nécessite l'environnement
d'exécution `gen2`, qui est la valeur par défaut). Un bucket Cloud Storage
est toujours créé pour le déploiement, mais il n'est pas monté à `/beszel_data`
tant que NFS possède ce chemin — GCS FUSE ne peut pas fournir le verrouillage
dont le mode WAL de SQLite a besoin.

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

> **Attention :** Ce volume **est** la base de données. Ne le videz pas — cela
> effacerait tout l'historique de surveillance et le compte administrateur. Voir
> [App_CloudRun](App_CloudRun.md) pour les options NFS.

### C. Secret Manager {#c-secret-manager}

Beszel n'injecte **aucun** secret d'application — il n'y a pas de clé de
chiffrement, de secret JWT ou de mot de passe de base de données à gérer (la
base de données est SQLite embarquée, et l'administrateur est créé dans
l'interface utilisateur). Une liste de secrets ne montre que ce que la fondation
elle-même crée.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour savoir comment les variables d'environnement
secrètes seraient injectées si vous en ajoutiez via `secret_environment_variables`.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`),
ce qui permet aux agents distants de POSTer leurs métriques au hub. Un
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

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run sont acheminées vers Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives. (Notez que Beszel est
lui-même un produit de surveillance — la surveillance GCP ici observe le *hub*,
pas les machines que Beszel surveille.)

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Beszel {#3-beszel-application-behaviour}

- **Pas de job d'initialisation ; le schéma est auto-géré.** Beszel crée et
  migre sa base de données PocketBase/SQLite embarquée automatiquement au
  premier démarrage (et à chaque mise à niveau de version). Il n'y a pas de
  job `db-init` car il n'y a pas de base de données externe.
- **L'état réside sur le volume NFS.** Tout ce qui se trouve sous `/beszel_data` —
  la base de données SQLite, la configuration et les métriques historiques —
  est persisté sur le partage NFS. Les révisions et les redémarrages réutilisent
  le même partage, de sorte que l'historique survit.
- **La configuration initiale se fait dans l'interface utilisateur.** Ouvrez
  l'URL du service et complétez la création du compte superutilisateur (admin)
  de PocketBase lors de la première exécution. Il n'y a pas de
  crédentiel administrateur auto-généré dans Secret Manager. Après avoir créé
  l'administrateur, ajoutez les systèmes que vous souhaitez surveiller et
  installez l'agent Beszel sur chacun (le hub affiche la commande
  d'installation de l'agent et la clé publique).
- **Écrivain unique — ne pas mettre à l'échelle.** Avec un seul fichier SQLite
  sur un montage partagé, une seule instance peut écrire. `min = max = 1` est
  appliqué intentionnellement ; une garde au moment de la planification rejette
  également `min_instance_count > max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`,
  qui renvoie `200` une fois que le hub est prêt. Inspectez la révision
  en cours d'exécution et ses env/montages :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Maintenu chaud.** `min_instance_count = 1` évite les démarrages à froid afin que les
  agents signalent en continu et que la base de données SQLite reste ouverte.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Beszel sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `beszel` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Beszel. `latest` résout l'image de base vers le `0.9.1` épinglé ; définissez un tag explicite (par exemple `0.9.1`) pour contrôler les mises à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; Beszel est léger, 1 vCPU est amplement suffisant. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 512 Mo – 1 Go est typique (le plancher gen2 est de 512 Mo). |
| `min_instance_count` | `1` | Maintenu à 1 — un écrivain SQLite, pas de mise à l'échelle à zéro. |
| `max_instance_count` | `1` | **Ne pas augmenter.** Plus d'une instance corrompt la base de données SQLite partagée. |
| `container_port` | `8090` | Le hub de Beszel écoute sur le port 8090. |
| `execution_environment` | `gen2` | Requis pour le montage NFS `/beszel_data`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Beszel dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux agents distants d'atteindre le hub. `internal` bloque le rapport des agents hors VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les agents qui ne peuvent pas présenter une identité Google.** |

### Groupe — Stockage et système de fichiers {#group--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Maintenir activé : NFS contient `/beszel_data` (la base de données SQLite). GCS FUSE ne peut pas l'héberger. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires (nécessite gen2). Ne pas en monter un à `/beszel_data`. |
| `create_cloud_storage` | `true` | Provisionner les buckets de stockage déclarés. |

### Groupe — Backend de base de données {#group--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Beszel n'a pas de base de données externe — laisser comme `NONE`. |
| `enable_cloudsql_volume` | `false` | Pas de proxy d'authentification Cloud SQL ; Beszel utilise SQLite embarqué. |

### Groupe — Cache et file d'attente Redis {#group--redis-cache--queue}

Beszel n'utilise pas Redis. `enable_redis` n'est pas exposé comme variable sur ce module
— le `main.tf` du wrapper code en dur `enable_redis = false` dans son appel à `App_CloudRun` (dont
la valeur par défaut est `true`), il n'y a donc rien à configurer ici.

### Groupe — Observabilité et santé {#group--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s de délai | Sonde de démarrage ; fenêtre de 10 tentatives pour la création du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Vérification de disponibilité Cloud Monitoring facultative contre le hub. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `beszel_url` | URL du service pour l'interface utilisateur/API du hub Beszel. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identités autorisées, un runtime `gen1` avec des montages GCS, un
> `backup_retention_days` hors plage, `min_instance_count > max_instance_count`. Une configuration invalide fait échouer la
> **planification** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Partage NFS à `/beszel_data` | Ne jamais vider ; conserver `enable_nfs = true` | Critique | Le partage **est** la base de données SQLite — le vider efface tout l'historique de surveillance et le compte administrateur. |
| `max_instance_count` | `1` | Critique | L'exécution de plus d'une instance contre la base de données SQLite partagée provoque des conflits de verrouillage et une corruption de la base de données. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | Élevé | Beszel n'a pas de base de données externe ; l'activation de Cloud SQL provisionne une instance inutilisée et configure mal le démarrage. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter le volume NFS `/beszel_data`, de sorte que l'état n'est pas persisté. |
| `ingress_settings` | `all` | Élevé | `internal` bloque les agents en dehors du VPC pour qu'ils ne puissent pas signaler au hub. |
| `enable_iap` | uniquement pour l'interface utilisateur, jamais avec des agents hors Google | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris le rapport de métriques des agents. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) supprime l'écrivain SQLite chaud et interrompt le rapport continu des agents ; également bloquée par la garde min/max lorsqu'elle est définie au-dessus de `max`. |
| `container_port` | `8090` | Moyen | Le hub n'écoute que sur le port 8090 ; le modifier sans faire correspondre l'image rompt les sondes et l'ingress. |
| `application_version` | épingler explicitement | Moyen | `latest` résout l'image de base vers le `0.9.1` épinglé ; épinglez un vrai tag pour contrôler les mises à niveau et éviter les migrations de schéma surprises. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Beszel partagée avec la variante GKE est décrite
dans **[Beszel_Common](Beszel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Beszel sur Cloud Run](../labs/Beszel_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Beszel sur GKE Autopilot](Beszel_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Beszel Common — Configuration d'application partagée](Beszel_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Netdata sur Google Cloud Run](Netdata_CloudRun.md) dans la solution **Monitoring & NOC**.
