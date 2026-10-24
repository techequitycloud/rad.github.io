---
title: "Uptime Kuma sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Uptime Kuma sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/UptimeKuma_CloudRun.md @ 1665a43e sha256:e9baf1b6f409 -->

# Uptime Kuma sur Google Cloud Run {#uptime-kuma-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_CloudRun.png" alt="Uptime Kuma sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma est un outil de surveillance sophistiqué et auto-hébergé pour suivre la disponibilité des sites web, des API, des ports TCP, des enregistrements DNS, et plus encore, avec un tableau de bord clair, des pages d'état et plus de 90 canaux de notification. Ce module déploie Uptime Kuma sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Uptime Kuma et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Uptime Kuma sur RAD, et comment cela se compare {#what-uptime-kuma-costs-on-rad-and-how-that-compares}

**L'exécution d'Uptime Kuma sur Cloud Run dans votre propre projet Google Cloud coûte environ 64,16 $ US/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 40 crédits (4 $ US) facturé une fois au moment du déploiement. Uptime Kuma conserve tout son état dans une base de données SQLite embarquée sur un volume NFS partagé, il n'a donc pas besoin de base de données gérée — mais il fonctionne `alwaysOn` par défaut (les moniteurs de disponibilité doivent continuer à vérifier même si personne ne regarde le tableau de bord), ce qui représente la majeure partie de son coût de fonctionnement. Dans un projet géré par RAD, les frais de module tombent à 36 crédits (10 % de moins) — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous — ou voir le [guide GKE](UptimeKuma_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût de fonctionnement Google Cloud | 64,16 $ US/mois, facturé par Google au prix catalogue | ~31 crédits/jour (environ 930/mois, 93 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel.

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (alwaysOn) | 44,72 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **64,16 $ US** |

### Comment cela se compare {#how-it-compares}

- Uptime Kuma n'a pas de version cloud hébergée officielle — il est distribué uniquement en tant que logiciel auto-hébergé, il n'y a donc pas de plan SaaS de fournisseur à comparer pour ce projet exact.
- Une comparaison VPS auto-gérée, dimensionnée aux 1 vCPU / 0,5 GiB par défaut d'Uptime Kuma : un Hetzner CPX11 ou DigitalOcean 1 vCPU/2 Go Droplet coûte environ 6-12 $ US/mois, moins cher en termes de trésorerie que les deux options RAD ici — plus votre propre temps pour les sauvegardes, le patching du système d'exploitation et le renouvellement TLS, que le Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- Parce qu'Uptime Kuma n'a pas besoin de base de données gérée, presque tout son coût de fonctionnement ici est le calcul toujours actif lui-même, ce qui en fait également un bon candidat à mettre en pause lorsqu'un environnement surveillé n'est lui-même utilisé qu'occasionnellement (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Uptime Kuma et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et le retour d'Uptime Kuma signifie un redéploiement
à partir de zéro. Cela coûte environ 43-46 crédits dans votre propre projet, ou environ
39-42 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Uptime Kuma reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût de fonctionnement — environ 2 jours ou plus dans votre propre projet
(environ 2,14 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(31 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance chaque place, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Uptime Kuma s'exécute en tant que conteneur Node.js sur Cloud Run v2. C'est l'un des modules les plus simples du catalogue — il n'y a pas de base de données externe, pas de cache et pas de secret d'application. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 Mio par défaut, **CPU toujours alloué** |
| État persistant | Filestore (NFS) | Base de données SQLite embarquée et téléchargements sous `/app/data` (gen2 requis) |
| Image conteneur | Artifact Registry | Cloud Build personnalisé (`container_image_source = "custom"`) — une fine couche `FROM louislam/uptime-kuma` qui corrige le mode journal SQLite pour la sécurité NFS (voir ci-dessous) |
| Base de données | — | Aucune — Uptime Kuma v1 utilise SQLite embarqué ; `database_type = "NONE"` |
| Cache | — | Aucun — Redis n'est pas requis (`enable_redis = false`) |
| Secrets | Secret Manager | Pas de secrets d'application (`secret_ids = {}`) ; les identifiants d'administrateur résident dans SQLite |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **`cpu_always_allocated = true` est la valeur par défaut et est délibérée — la boucle de surveillance EST le produit.** Uptime Kuma interroge ses moniteurs à partir d'un ordonnanceur intégré avec **aucune requête entrante**. Sous la facturation basée sur les requêtes de Cloud Run, le CPU est limité à près de zéro entre les requêtes, de sorte que les vérifications seraient bloquées ou déclenchées en retard. Le CPU basé sur l'instance (toujours alloué) maintient l'ordonnanceur en fonctionnement à pleine vitesse tant qu'une instance est active. Ne définissez pas cela sur `false`.
- **`min_instance_count` est par défaut `1`, pas `0`** — à `0`, Cloud Run récupère l'instance environ 15 minutes après la dernière requête, et la **surveillance s'arrête lorsqu'elle est mise à l'échelle à zéro**. `cpu_always_allocated` ne couvre pas cela : il régit le CPU tant qu'une instance est active, pas si une existe. Conservez `1` pour une surveillance 24h/24 et 7j/7.
- **Pas de base de données externe.** `database_type = "NONE"`, `enable_cloudsql_volume = false`, et il n'y a pas de job `db-init`. Uptime Kuma crée son schéma SQLite embarqué automatiquement au premier démarrage.
- **La persistance NFS est obligatoire.** `enable_nfs = true` avec `nfs_mount_path = "/app/data"` monte un volume Filestore (NFS) contenant la base de données SQLite et les téléchargements, de sorte que les moniteurs et l'historique survivent aux redémarrages et aux révisions. Nécessite l'environnement d'exécution gen2.
- **SQLite à écrivain unique.** SQLite sur NFS repose sur le verrouillage de fichiers ; exécutez une **instance unique** en production (`max_instance_count = 1`). La valeur par défaut du module est `max_instance_count = 3` pour la marge de manœuvre du tableau de bord — abaissez-la pour la production.
- **Le build personnalisé corrige SQLite pour la sécurité NFS.** `container_image_source = "custom"` est la valeur par défaut — ne la changez pas en `"prebuilt"`. Uptime Kuma définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans `server/database.js`, non configurable via une variable d'environnement) ; WAL repose sur le verrouillage de plage d'octets en mémoire partagée entre le fichier DB et son sidecar `-wal`, que le volume `/app/data` basé sur NFS ne fournit pas de manière fiable et a produit des erreurs `SQLITE_CORRUPT` observées. L'étape Cloud Build (`UptimeKuma_Common/scripts/Dockerfile`) corrige cette PRAGMA en mode `DELETE`, qui ne nécessite que le verrouillage de fichier entier standard que NFS gère correctement. `enable_image_mirroring = true` pousse en outre l'image construite via Artifact Registry pour éviter les limites de débit de Docker Hub.
- **Pas de secrets d'application** — il n'y a rien à injecter depuis Secret Manager. Le compte administrateur est créé interactivement lors du premier accès.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Uptime Kuma {#a-cloud-run--the-uptime-kuma-service}

Uptime Kuma s'exécute en tant que service Cloud Run v2 avec un CPU toujours alloué afin que son ordonnanceur de vérification en arrière-plan continue de sonder entre les requêtes. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Filestore (NFS) — le volume de données persistant {#b-filestore-nfs--the-persistent-data-volume}

Tout l'état d'Uptime Kuma — la base de données SQLite embarquée, l'historique des moniteurs, les téléchargements et les paramètres (y compris l'utilisateur administrateur) — réside sous `/app/data`, que le module monte à partir d'un partage **Filestore (NFS)**. Sans cela, tout est perdu au redémarrage. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de montage NFS et CMEK.

### C. Artifact Registry — l'image mise en miroir {#c-artifact-registry--the-mirrored-image}

Avec `container_image_source = "custom"` (par défaut), une étape Cloud Build construit une image personnalisée mince `FROM louislam/uptime-kuma`, appliquant un correctif source qui modifie le `journal_mode` SQLite codé en dur de `WAL` à `DELETE` — le verrouillage en mémoire partagée de WAL est dangereux sur le volume `/app/data` basé sur NFS (voir [Vue d'ensemble](#1-overview)). Avec `enable_image_mirroring = true` (par défaut), l'image construite est ensuite poussée vers l'Artifact Registry du projet, isolant les déploiements des limites de débit et des pannes de Docker Hub.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo>
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et de sortie VPC contrôlent la connectivité. Notez qu'Uptime Kuma établit également des connexions **sortantes** — chaque vérification de moniteur est un appel de sortie du conteneur.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives. Oui — vous pouvez pointer une vérification de disponibilité Google Cloud vers votre instance Uptime Kuma pour surveiller le moniteur.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Uptime Kuma {#3-uptime-kuma-application-behaviour}

- **Pas de jobs d'initialisation.** Uptime Kuma crée son schéma SQLite embarqué automatiquement au premier démarrage ; il n'y a pas de job `db-init` ou de migration, et `initialization_jobs` est par défaut `[]`.
- **Configuration initiale.** Lors du premier accès, Uptime Kuma présente une page de configuration vous demandant de créer le compte administrateur — il n'y a pas d'identifiants par défaut intégrés à l'image. Le compte est stocké dans SQLite sur le volume NFS, il persiste donc entre les révisions.
- **L'ordonnanceur de vérification s'exécute en interne.** L'interrogation des moniteurs, les tentatives et l'envoi des notifications s'exécutent tous dans le processus Node.js, pilotés par des temporisateurs — et non par des requêtes HTTP entrantes. C'est pourquoi `cpu_always_allocated = true` est la valeur par défaut et pourquoi la surveillance continue nécessite en outre qu'une instance soit en cours d'exécution (`min_instance_count = 1`).
- **La mise à l'échelle à zéro interrompt la surveillance.** Si vous abaissez `min_instance_count` à `0`, Cloud Run arrête la dernière instance lorsqu'elle devient inactive. Lorsqu'elle est mise à l'échelle à zéro, aucune vérification n'est exécutée et aucune alerte n'est déclenchée ; l'interrogation reprend lorsque la prochaine requête (par exemple, l'ouverture du tableau de bord) démarre à froid une instance. C'est sûr pour une utilisation occasionnelle/en laboratoire mais incorrect pour la surveillance de production.
- **SQLite à écrivain unique.** SQLite est une base de données à écrivain unique. Plusieurs instances concurrentes écrivant le même fichier SQLite sur NFS risquent des conflits de verrouillage ou une corruption — conservez `max_instance_count = 1` en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` sur le port `3001`, qui renvoie HTTP 200 une fois l'application démarrée. La sonde de démarrage autorise jusqu'à 30 s de délai initial plus 30 échecs à des intervalles de 10 s.
- **Vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~uptimekuma" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Uptime Kuma sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `1` | Tag d'image Uptime Kuma — la ligne stable v1 (SQLite embarqué). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une image personnalisée mince via Cloud Build qui corrige le `journal_mode` SQLite codé en dur de `WAL` à `DELETE` pour la sécurité NFS (voir Vue d'ensemble). Conservez `custom`. |
| `container_image` | `louislam/uptime-kuma` | Image officielle en amont, mise en miroir dans Artifact Registry. |
| `enable_image_mirroring` | `true` | Copiez l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Amplement suffisant pour des dizaines de moniteurs ; augmentez la mémoire pour un très grand nombre de moniteurs. |
| `min_instance_count` | `1` | **Conservez `1` pour une surveillance 24h/24 et 7j/7** — lorsqu'il est mis à l'échelle à zéro, aucune vérification n'est exécutée. |
| `max_instance_count` | `1` | **Conservez à `1`** — SQLite est à écrivain unique, donc une deuxième instance corrompt la base de données (voir Pièges). |
| `cpu_always_allocated` | `true` | **Conservez `true`.** L'ordonnanceur de vérification intégré a besoin de CPU entre les requêtes ; la facturation basée sur les requêtes le limite à ~0 et les vérifications sont bloquées. |
| `container_port` | `3001` | Port natif d'Uptime Kuma. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_cloudsql_volume` | `false` | Inutilisé — pas de base de données externe. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Les pages d'état publiques nécessitent un ingress public ; utilisez IAP/`internal` pour les tableaux de bord privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminent le trafic de plage privée via le VPC (nécessaire pour surveiller les cibles internes). Définissez `ALL_TRAFFIC` pour acheminer toutes les sondes de moniteur via le VPC (par exemple, pour une IP de sortie NAT stable ou si les sondes publiques échouent). |
| `enable_iap` | `false` | Placez le tableau de bord derrière l'identité Google s'il ne doit pas être public. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Obligatoire.** Provisionne le partage Filestore contenant tout l'état d'Uptime Kuma. |
| `nfs_mount_path` | `/app/data` | **Doit rester `/app/data`** — le répertoire de données inscriptible d'Uptime Kuma. |
| `storage_buckets` / `gcs_volumes` | `[]` | Non nécessaire — aucun stockage GCS n'est utilisé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixé par conception** — Uptime Kuma v1 utilise SQLite embarqué ; aucun Cloud SQL n'est provisionné. |
| `application_database_name` / `application_database_user` | `uptimekuma` | Déclaré pour la mise en miroir de convention ; inutilisé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun nécessaire — le schéma SQLite est créé au premier démarrage. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 30 s de délai, 30 échecs | Transmis via `UptimeKuma_Common`. |
| `liveness_probe` | HTTP `/`, 30 s de délai, 3 échecs | Transmis via `UptimeKuma_Common`. |
| `uptime_check_config` | `enabled = false` | Vérification de disponibilité Cloud Monitoring facultative contre `/` — surveillance pour le moniteur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Uptime Kuma n'utilise pas Redis ; laissez désactivé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Vide/non défini — aucun Cloud SQL n'est provisionné (`database_type = "NONE"`). |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vides par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` / `artifact_registry_repository` | État CI/CD, déclencheur de build et détails du registre. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `cpu_always_allocated` | `true` (par défaut) | Critique | La facturation basée sur les requêtes limite le CPU à ~0 entre les requêtes — l'ordonnanceur de vérification intégré est bloqué, les vérifications sont déclenchées en retard ou pas du tout, et les alertes sont manquées. La boucle de surveillance EST le produit. |
| `enable_nfs` | `true` (par défaut) | Critique | Sans le volume NFS, la base de données SQLite (moniteurs, historique, compte administrateur) réside sur un disque éphémère et est effacée à chaque redémarrage ou nouvelle révision. |
| `nfs_mount_path` | `/app/data` (par défaut) | Critique | Tout autre chemin laisse Uptime Kuma écrire sur un stockage éphémère — perte totale de données silencieuse au redémarrage. |
| `min_instance_count` | `1` (par défaut) | Critique | À `0`, le service se met à l'échelle à zéro lorsqu'il est inactif et **aucune vérification n'est exécutée pendant qu'il est arrêté** — les pannes des systèmes surveillés passent inaperçues. |
| `max_instance_count` | `1` pour la production | Élevé | SQLite est à écrivain unique ; plusieurs instances écrivant sur NFS risquent des conflits de verrouillage ou une corruption de la base de données. |
| `container_port` | `3001` (par défaut) | Critique | Un port natif d'Uptime Kuma non concordant entraîne l'échec de toutes les sondes de santé et la révision ne devient jamais prête. |
| `database_type` | `NONE` (par défaut) | Élevé | Le provisionnement de Cloud SQL gaspille de l'argent — Uptime Kuma v1 ne peut pas l'utiliser. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `vpc_egress_setting` | par portée cible | Moyen | `PRIVATE_RANGES_ONLY` achemine uniquement les sondes de plage privée via le VPC ; définissez `ALL_TRAFFIC` si les sondes de moniteur vers des cibles externes nécessitent une sortie VPC/NAT. |
| `enable_iap` / `ingress_settings` | IAP ou `internal` pour les tableaux de bord privés | Moyen | Le tableau de bord (et la page de configuration, lors du premier déploiement) est autrement accessible publiquement à l'URL `run.app`. Terminez la configuration d'administration initiale immédiatement après le déploiement. |
| `enable_image_mirroring` | `true` (par défaut) | Faible | Les pulls directs de Docker Hub peuvent atteindre les limites de débit et interrompre les déploiements. |
| `container_image_source` | `custom` (par défaut) | Critique | La définition de `"prebuilt"` ignore l'étape Cloud Build et déploie l'image amont non corrigée — Uptime Kuma écrit alors SQLite en mode WAL sur NFS, ce qui a produit des corruptions de base de données `SQLITE_CORRUPT` observées. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Uptime Kuma partagée avec la variante GKE est décrite dans **[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Uptime Kuma sur Cloud Run](../labs/UptimeKuma_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Uptime Kuma sur GKE Autopilot](UptimeKuma_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Uptime Kuma Common — Configuration d'application partagée](UptimeKuma_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observabilité et astreinte**.
