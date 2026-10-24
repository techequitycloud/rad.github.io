---
title: "Kavita sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Kavita sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kavita_CloudRun.md @ e69407af sha256:e026d4c3c720 -->

# Kavita sur Google Cloud Run {#kavita-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kavita_CloudRun.png" alt="Kavita sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kavita est un serveur de bibliothèque numérique et de lecture rapide, auto-hébergé, pour les bandes dessinées, les mangas et les livres électroniques — une interface utilisateur de lecture web épurée, des flux OPDS, des collections, des listes de lecture et une recherche en texte intégral dans votre bibliothèque, construit sur .NET avec une base de données SQLite interne. Ce module déploie Kavita sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Kavita et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Kavita sur RAD, et comment cela se compare {#what-kavita-costs-on-rad-and-how-that-compares}

**Kavita sur le module Cloud Run de RAD coûte environ 19 $ US par mois dans votre propre projet, plus des frais de module de 40 crédits (4 $ US) une fois par déploiement.** Si vous ne lisez que par intermittence plutôt que de manière continue, consultez la section "Mettre en pause gratuitement" ci-dessous pour arrêter de payer sans perdre votre progression de lecture. Kavita est également livré sous forme de module GKE, qui coûte plus cher ici (environ 42 $ US/mois) en raison des frais de gestion du cluster — Cloud Run est le choix le moins coûteux, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **19,14 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (chaud) | 13,14 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 19,14 $ US** |

### Comment cela se compare {#how-it-compares}

- Kavita n'a pas de plan SaaS hébergé officiel avec lequel comparer — il est livré purement comme un serveur de lecture auto-hébergé avec une base de données SQLite interne — donc la comparaison honnête est un serveur nu.
- L'empreinte de Kavita est légère (1 vCPU, 1 Gio), de sorte qu'un niveau de VPS moins cher/plus petit que ceux ci-dessous ferait fonctionner confortablement une bibliothèque personnelle ; à titre de référence, un Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go coûte environ 24 $/mois, et un GCP Compute Engine e2-standard-2 environ 49 $/mois.
- Ce que RAD ajoute par rapport à un VPS nu : persistance basée sur Cloud Storage, gestion du réseau et surveillance — Kavita n'a pas besoin de service de base de données séparé, donc la majeure partie de la valeur ici est opérationnelle plutôt que d'administration de base de données.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kavita s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou simplement ne sachant pas encore si vous en aurez besoin le mois prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression de Kavita en tant que module unique, cela ne démantèle pas le service Cloud Run/GKE et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google d'annuler la suppression du projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de Kavita couvre sa base de données SQLite (progression de lecture, collections, listes de lecture) ; pour une installation par défaut, c'est la seule copie qui vaille la peine d'être conservée, car les fichiers source de votre bibliothèque proviennent généralement d'ailleurs.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de 30 jours ci-dessus passée, la solution de repli est de supprimer Kavita purement et simplement et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Kavita devait rester inutilisé pendant environ 7 jours ou plus dans votre propre projet (environ 5 jours ou plus dans un projet géré par RAD). Kavita n'a pas de base de données ou de VM partagée propre, donc sa suppression supprime à elle seule l'intégralité de ses coûts d'exécution.
- **Conserver les données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Kavita s'exécute comme un conteneur .NET unique sur Cloud Run v2 sans **base de données externe ni cache** — tout ce dont il a besoin (paramètres, sa base de données SQLite interne et l'index de la bibliothèque) se trouve sur le disque sous `/kavita/config`.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur web .NET sur le port 5000, `1000m` CPU / `1Gi` mémoire par défaut ; `min=1`/`max=1` |
| Base de données | **Aucune** — SQLite interne | `database_type` est fixé à `NONE` par `Kavita_Common` ; aucune instance Cloud SQL n'est créée |
| Persistance d'état | Bucket Cloud Storage monté via **GCS Fuse** | `/kavita/config` contient la base de données SQLite (`kavita.db`), les paramètres, les couvertures et les journaux — c'est la **seule** option de persistance de Cloud Run (pas de PVC de bloc) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est auto-provisionné et monté à `/kavita/config` |
| Secrets | Secret Manager | **Aucun généré** — l'assistant de configuration de première exécution crée le compte administrateur ; `secret_ids`/`secret_values` sont vides |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite n'a d'autre choix que de vivre sur GCS Fuse ici.** Cloud Run n'a pas d'option de volume persistant de bloc, donc `/kavita/config` (la base de données SQLite et les paramètres de Kavita) est toujours monté via gcsfuse. C'est le seul endroit dans ce module où la mise en garde habituelle du dépôt "gcsfuse corrompt SQLite" est inévitable plutôt qu'une mauvaise configuration — la description du module elle-même recommande [Kavita_GKE](Kavita_GKE.md) pour les bibliothèques de production, où les mêmes données vivent plutôt sur un véritable PVC de bloc. Considérez `Kavita_CloudRun` comme le mieux adapté aux bibliothèques légères à moyennes.
- **`min_instance_count` est par défaut à `1`, pas à `0`.** Contrairement à la plupart des modules d'application Cloud Run (qui par défaut sont à l'échelle zéro), Kavita maintient une instance toujours chaude par défaut, évitant les retards de démarrage à froid pendant qu'il recharge son index de bibliothèque et remonte le volume gcsfuse.
- **`max_instance_count` est épinglé à `1`.** Kavita n'a pas de clustering ni de coordination d'écriture partagée ; une deuxième instance écrivant dans le même fichier SQLite monté sur gcsfuse risque de corrompre l'index de la bibliothèque.
- **Pas de base de données, pas de Redis.** `database_type` est fixé à `NONE`, et Redis est désactivé de force : `main.tf` code en dur `enable_redis = false` quelle que soit la valeur par défaut héritée de la fondation (`true`) — Kavita n'a aucune utilité pour une file d'attente ou un cache.
- **Pas de secrets auto-générés.** Il n'y a pas de mot de passe administrateur, de clé API ou de clé de signature créé dans Secret Manager. Le compte administrateur est créé de manière interactive via l'assistant de configuration de première exécution de Kavita la première fois que vous ouvrez l'URL du service.
- **Image personnalisée, balise de version épinglée.** Le Dockerfile enveloppe finement `jvmilazz0/kavita:${KAVITA_VERSION}`. `application_version = "latest"` se résout en un argument de build `KAVITA_VERSION = 0.8.7` épinglé dans `Kavita_Common` (pas le générique `APP_VERSION` que la Fondation injecte) — la mise à jour de la version nécessite de modifier cette valeur épinglée et de reconstruire, pas seulement de redéployer.
- **Le chemin de santé est `/api/health`, non authentifié, pour les deux sondes.** La sonde de démarrage permet un budget d'échec généreux pour tolérer l'indexation de la bibliothèque au premier démarrage.
- **Seul le répertoire d'état de Kavita est persisté par ce module.** Le contenu réel de la bibliothèque (bandes dessinées, mangas, livres électroniques) n'est pas provisionné ici — ajoutez votre propre `gcs_volumes` (ou NFS) pour le contenu et enregistrez-le comme bibliothèque dans l'interface utilisateur de Kavita après le déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Kavita {#a-cloud-run--the-kavita-service}

Kavita s'exécute comme un service Cloud Run v2 unique. Comme il s'agit d'une application SQLite à écrivain unique, sauvegardée par un volume monté sur gcsfuse, n'augmentez pas `max_instance_count` au-dessus de 1.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le bucket de configuration/état de la bibliothèque monté sur GCS Fuse {#b-cloud-storage--the-gcs-fusemounted-configlibrary-state-bucket}

`Kavita_Common` provisionne un seul bucket Cloud Storage (suffixe `storage`) et ce module le monte à `/kavita/config` via GCS Fuse. Il contient la base de données SQLite de Kavita (`kavita.db`), les images de couverture, les signets, les sauvegardes et les journaux — en fait, tout l'état durable de Kavita. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`, et des montages de contenu en lecture seule supplémentaires via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~kavita"
  gcloud storage ls gs://<config-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Kavita n'a **aucun secret généré** — aucun mot de passe administrateur, clé API ou clé de signature n'est créé par ce module. La propre clé de signature JWT de Kavita (`TokenKey`) est auto-générée par l'application au premier démarrage et persistée sur le volume `/kavita/config` monté sur gcsfuse, et non dans Secret Manager. Tous les secrets que vous ajoutez vous-même via `secret_environment_variables` transitent par Secret Manager comme tout autre module d'application.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kavita"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings =
"all"`), ce qui permet aux navigateurs, aux applications de lecture mobile et aux clients OPDS de l'atteindre directement. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

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

## 3. Comportement de l'application Kavita {#3-kavita-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Kavita n'a pas de job `db-init` — il n'y a pas de base de données externe à amorcer. `initialization_jobs` est par défaut une liste vide ; seuls les jobs personnalisés que vous fournissez sont exécutés.
- **Pas d'étape de migration.** Kavita crée et migre son propre schéma SQLite interne au premier démarrage ; la mise à niveau de `application_version` (et la reconstruction) applique automatiquement les modifications de schéma sans job de migration séparé.
- **Pas de secrets immuables et auto-générés.** Contrairement à la plupart des modules d'application, il n'y a pas de clé de chiffrement, de jeton administrateur ou de secret JWT créé dans Secret Manager. Le JWT `TokenKey` de Kavita est généré en interne au premier démarrage et persisté sur le volume `/kavita/config` — rien à faire pivoter ou à perdre la trace au niveau de Terraform.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux le point de terminaison public, non authentifié **`/api/health`**. La sonde de démarrage utilise un budget d'échec plus long (`initial_delay_seconds = 15`, `period_seconds = 10`, `failure_threshold = 10`) pour tolérer une indexation de bibliothèque plus lente au premier démarrage avant que la sonde de vivacité (`initial_delay_seconds = 30`, `period_seconds = 30`, `failure_threshold = 3`) ne prenne le relais.
- **Comportement d'inscription / de première exécution.** Il n'y a pas de compte administrateur pré-rempli ni de justificatif généré. Ouvrez l'URL du service — l'assistant de configuration de première exécution de Kavita vous guide pour créer le compte administrateur initial et ajouter votre première bibliothèque. Terminez cette étape rapidement après le déploiement : tant qu'il n'est pas exécuté, le service est accessible mais non réclamé.
- **Redis est désactivé de force.** `main.tf` définit `enable_redis = false` inconditionnellement lors de l'appel de `App_CloudRun`, remplaçant la valeur par défaut `enable_redis = true` de la fondation — aucun `REDIS_HOST`/`REDIS_PORT` n'est jamais injecté, et les variables `redis_host`/`redis_port`/`redis_auth` n'ont aucun effet.
- **`enable_cloudsql_volume` est désactivé de manière fixe.** `main.tf` transmet `enable_cloudsql_volume = false` directement à la fondation quelle que soit la variable (dont la valeur par défaut est également `false`) — Kavita n'a pas de side-car Cloud SQL Auth Proxy.
- **Build d'image personnalisée.** Le conteneur est construit à partir d'un Dockerfile léger (`FROM jvmilazz0/kavita:${KAVITA_VERSION}`) ; `application_version = "latest"` se résout en l'argument de build `KAVITA_VERSION = 0.8.7` épinglé (une mise à jour de version nécessite de modifier la valeur épinglée dans `Kavita_Common`, puis une reconstruction — voir la convention "latest-tag base images" du dépôt).
- **Inspecter le service et son état monté :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Kavita sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kavita` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Kavita` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Kavita — self-hosted comics, manga and ebook server (.NET, SQLite)` | Description du service. |
| `application_version` | `latest` | Balise d'image Kavita ; `latest` se résout en l'argument de build `KAVITA_VERSION = 0.8.7` épinglé dans `Kavita_Common`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; Kavita est un serveur .NET léger. |
| `memory_limit` | `1Gi` | Mémoire par instance ; confortable pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenu à 1 par défaut pour éviter les démarrages à froid pendant le chargement de l'index de la bibliothèque — la plupart des modules Cloud Run sont par défaut à `0`. |
| `max_instance_count` | `1` | **Maintenir à 1.** Pas de clustering — une deuxième instance écrivant dans le même fichier SQLite monté sur gcsfuse risque de corrompre les données. |
| `container_port` | `5000` | Port HTTP fixe de Kavita. |
| `execution_environment` | `gen2` | Requis pour le montage GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Kavita n'a pas de Cloud SQL ; également codé en dur `false` dans `main.tf` quelle que soit cette valeur. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Kavita dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1 est suffisant ; Kavita n'a pas d'utilisation gRPC pour `h2c`. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes personnalisées sur la ressource de service Cloud Run. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public pour l'interface utilisateur de lecture, les flux OPDS et les clients d'applications de lecture. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Les clients OPDS/lecteurs mobiles ne peuvent généralement pas compléter le flux d'authentification d'IAP.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires ; Kavita n'en a pas besoin par défaut. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager — ne concerne que les secrets que vous ajoutez vous-même ; Kavita n'en crée aucun. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer `/kavita/config` à partir d'une sauvegarde lors du déploiement — Kavita n'a pas de vidage de base de données séparé ; son état est le répertoire de configuration lui-même. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et découverte d'instances NFS {#group-9--custom-sql-scripts--nfs-instance-discovery}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Non applicable — Kavita n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | — | Non applicable. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Pertinent uniquement si vous ajoutez un montage NFS pour un contenu de bibliothèque séparé ; inutilisé par défaut. |

### Groupe 10 — Cloud Armor, CDN et rétention d'images {#group-10--cloud-armor-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` auto-provisionné (monté à `/kavita/config`) plus tout `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de configuration auto-provisionné. |
| `enable_nfs` | `false` | Désactivé par défaut ; activer uniquement pour monter un contenu de bibliothèque séparé via NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage pour ce partage NFS (distinct de `/kavita/config`). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires — par exemple, un bucket en lecture seule de contenu de bibliothèque. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | inerte | Déclaré uniquement pour la mise en miroir des variables de la Fondation — `main.tf` code en dur `enable_redis = false` inconditionnellement ; Kavita n'utilise jamais Redis quelle que soit la valeur de ces variables. |

### Groupe 12 — Backend de base de données (non applicable) {#group-12--database-backend-not-applicable}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Kavita_Common` — Kavita stocke tout dans un fichier SQLite interne ; aucune instance Cloud SQL n'est créée. |
| `database_password_length` | `32` | Non référencé — Kavita n'a pas de base de données SQL. |

Toutes les autres variables liées à la base de données dans ce groupe (`sql_instance_name`, `application_database_name`/`_user`, `enable_mysql_plugins`, `enable_postgres_extensions`, l'ensemble `db_*_env_var_name`, `enable_auto_password_rotation`, etc.) sont déclarées uniquement pour la mise en miroir des variables de la Fondation et n'ont aucun effet sur un déploiement Kavita.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide — Kavita n'a pas de job `db-init`/migration ; il gère son propre schéma SQLite au premier démarrage. |
| `cron_jobs` | `[]` | Non utilisé par défaut ; ajouter des tâches planifiées personnalisées (par exemple, des instantanés de collection) si nécessaire. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 15s | Sonde de démarrage ; le budget d'échec de 10 tentatives tolère l'indexation de la bibliothèque au premier démarrage. |
| `liveness_probe` | HTTP `/api/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | désactivé alt / HTTP `/api/health` | Sondes structurées alternatives (inactives par défaut ; `startup_probe`/`liveness_probe` prennent effet). |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 15 — Réseau {#group-15--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` | Déclaré pour la mise en miroir de convention ; non transmis à `App_CloudRun` par ce module — le réseau VPC est auto-découvert à la place. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `kavita_url` | URL VPC interne pour le service Kavita (port 5000) ; uniquement accessible au sein du VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket `storage` monté à `/kavita/config`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés que vous avez fournis (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Notez qu'il n'y a pas de sorties `database_*` — Kavita ne provisionne aucune instance Cloud SQL.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec un montage GCS Fuse, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `/kavita/config` sur GCS Fuse | Accepter uniquement pour les bibliothèques légères/moyennes | Critique | GCS Fuse est la seule option de persistance de Cloud Run ; les écritures concurrentes ou les analyses de métadonnées lourdes sur un fichier SQLite sauvegardé par gcsfuse risquent de corrompre l'index de la bibliothèque. Pour les grandes bibliothèques, utilisez plutôt le PVC de bloc de [Kavita_GKE](Kavita_GKE.md). |
| `max_instance_count` | `1` | Critique | Kavita n'a pas de clustering ; une deuxième instance écrivant dans le même fichier SQLite monté sur gcsfuse corrompt l'index de la bibliothèque et les données admin/utilisateur. |
| Stockage du contenu de la bibliothèque | Ajouter `gcs_volumes` (ou NFS) séparément de `/kavita/config` | Élevé | `Kavita_Common` ne persiste que le répertoire d'état de la configuration/SQLite — sans un montage séparé pour les fichiers réels de bandes dessinées/mangas/livres électroniques, il n'y a pas d'endroit durable pour stocker le contenu de la bibliothèque lui-même. |
| `enable_iap` | `false` sauf si tous les clients le prennent en charge | Élevé | Le flux OPDS de Kavita et les clients d'applications de lecture mobile ne peuvent généralement pas compléter le flux d'authentification d'IAP de Google, donc l'activation d'IAP interrompt l'accès aux liseuses même si l'interface utilisateur du navigateur fonctionne toujours via un défi de navigateur. |
| `ingress_settings` | `all` | Élevé | `internal` empêche l'interface utilisateur de lecture et les clients OPDS d'atteindre directement le service. |
| Compte administrateur de première exécution | Compléter l'assistant de configuration immédiatement après le déploiement | Moyen | Tant que l'assistant n'est pas exécuté, le service est accessible mais non réclamé — toute personne qui atteint l'URL en premier peut créer le compte administrateur initial. |
| `application_version` / `KAVITA_VERSION` | Épingler explicitement pour la production | Moyen | `"latest"` se résout en `Kavita_Common`'s `KAVITA_VERSION = 0.8.7` épinglé ; la mise à jour nécessite de modifier cette valeur épinglée et de reconstruire, pas seulement de redéployer. |
| `min_instance_count` | `1` (par défaut) | Moyen | La définition à `0` active la mise à l'échelle à zéro mais ajoute une latence de démarrage à froid pendant que gcsfuse remonte et que Kavita recharge son index de bibliothèque. |
| `enable_redis` (inerte) | laisser tel quel | Faible | La définition de cette variable n'a aucun effet — `main.tf` code en dur `enable_redis = false` quelle que soit la valeur passée. |
| `enable_cloudsql_volume` | `false` | Faible | Kavita n'utilise jamais Cloud SQL ; la valeur est codée en dur `false` dans `main.tf` quelle que soit cette valeur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité ; l'état entier de Kavita est le répertoire `/kavita/config`, c'est donc le seul chemin de sauvegarde. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration spécifique à l'application de Kavita partagée avec la variante GKE — y compris pourquoi elle n'a pas de secrets générés, pas de base de données, et comment le répertoire d'état `/kavita/config` est monté différemment sur chaque plateforme (GCS Fuse ici vs. un PVC de bloc sur GKE) — est décrite dans **[Kavita_Common](Kavita_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Kavita sur Cloud Run](../labs/Kavita_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kavita sur GKE Autopilot](Kavita_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Kavita Common — Configuration d'application partagée](Kavita_Common.md) — la configuration partagée par les deux cibles de déploiement.
