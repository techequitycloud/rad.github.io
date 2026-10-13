---
title: "Gatus sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Gatus sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gatus_CloudRun.md @ e69407af sha256:a9d93ac7bc3f -->

# Gatus sur Google Cloud Run {#gatus-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gatus_CloudRun.png" alt="Gatus sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gatus est une page d'état et un moniteur de vérification de l'état open-source, sous
licence Apache 2.0, orienté développeur, écrit en Go. Il interroge les points de terminaison
HTTP, TCP, DNS, ICMP et autres configurés selon des plannings indépendants par point
de terminaison, évalue des conditions de résultat simples (code d'état, temps de
réponse, contenu du corps de la réponse, expiration du certificat TLS) et fournit
une page d'état publique en direct ainsi que des alertes — aucune base de données
externe n'est requise. Ce module déploie Gatus sur **Cloud Run v2** sur la base de
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud que Gatus utilise et sur la façon de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que Gatus coûte sur RAD et comment cela se compare {#what-gatus-costs-on-rad-and-how-that-compares}

**L'exécution de Gatus dans votre propre projet Google Cloud coûte environ 50,72 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 40 crédits** (36 crédits — 10 % de moins — dans un projet géré par RAD). Gatus est une page d'état auto-hébergée et un moniteur de vérification de l'état orienté développeur (Go). Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Gatus est également disponible sur GKE — voir le [guide GKE](Gatus_GKE.md) si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre l'option Cloud Run moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **40 crédits** (une fois) | **36 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~50,72 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~25 crédits/jour (~2,50 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (alwaysOn) | 44,72 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **50,72 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officiellement hébergée/cloud de Gatus à comparer, donc la comparaison honnête se fait avec une infrastructure auto-gérée, et non avec un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 0,5 GiB — un Hetzner CPX22 (2 vCPU/4 Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois) — est généralement moins cher que le prix affiché par RAD ; un VPS d'une ou deux tailles plus petites le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le système d'exploitation, faire tourner les sauvegardes de base de données, renouveler les certificats TLS et surveiller les temps d'arrêt. Le Cloud SQL géré par RAD, Secret Manager et la surveillance le font pour vous, ce qui est le véritable compromis, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Gatus est exécuté dans un **projet géré par RAD**, vous pouvez cesser de le payer entièrement sans le détruire.
La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet —
la propre suppression logicielle récupérable de Google de 30 jours. Contrairement à la suppression du module Gatus seul, cela ne
détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est
facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher
son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que
rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits de temps de build au
total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de module de 36 crédits
ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau
projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si
le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Gatus et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut
sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Gatus se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter
de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **40 + ~3–6 crédits** (~4,45 $ US)
dans votre propre projet, ou **36 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Gatus reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement
par rapport à son propre coût d'exécution : environ **3 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa
facture Google Cloud d'environ 50,72 $ US/mois), ou **environ 2 jours ou plus** d'inactivité dans un projet géré par RAD
(par rapport à ses ~25 crédits/jour).

Préservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son
  propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur
  finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements
  deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire
  ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Gatus s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie un
ensemble délibérément restreint de services Google Cloud — Gatus n'a pas de base de données, de cache ou
de dépendance de stockage d'objets propre :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go unique, 1 vCPU / 512 MiB par défaut ; CPU toujours alloué afin que la boucle de surveillance ne soit jamais limitée |
| Base de données | **Aucune** | `database_type = "NONE"` ; le magasin d'historique optionnel est un fichier SQLite local, aucune base de données Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut) ou NFS (optionnel, avec une mise en garde) | Historique SQLite à `/data/data.db` ; voir la mise en garde sur le journal WAL ci-dessous avant d'activer NFS |
| Stockage d'objets | **Aucun** | Gatus ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; Gatus n'a pas de dépendance de cache ou de file d'attente |
| Secrets | Secret Manager | Pas de secrets auto-générés ; seulement `secret_environment_variables` fournis par l'utilisateur |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — le magasin
  d'historique optionnel de Gatus est un fichier SQLite local. Les variables liées
  à la base de données existent pour des raisons d'exhaustivité mais sont inertes
  sauf si vous optez délibérément pour une base de données externe.
- **La configuration est entièrement basée sur des fichiers.** Chaque point de terminaison
  surveillé, intégration d'alerte et paramètre de stockage se trouve dans un fichier YAML
  intégré à l'image au moment de la construction — il n'y a pas de convention de variable
  d'environnement par paramètre et pas d'API de rechargement de configuration à l'exécution.
  Modifiez les points de terminaison surveillés en éditant
  `modules/Gatus_Common/scripts/config.yaml` et en redéployant.
- **Le magasin d'historique est éphémère par défaut, délibérément.** Gatus code en dur
  le mode journal WAL de SQLite (confirmé en direct : aucune option de configuration ou
  paramètre de chaîne de connexion ne le désactive), et la propre documentation de SQLite
  indique que WAL n'est pas pris en charge sur les systèmes de fichiers réseau. Cloud Run
  n'offre que du stockage éphémère ou NFS pour cela — aucun des deux n'est un emplacement
  véritablement sûr pour un fichier SQLite en mode WAL, de sorte que le module utilise
  par défaut l'éphémère plutôt que de risquer une corruption silencieuse. Déployez `Gatus_GKE`
  avec `stateful_pvc_enabled = true` (un véritable périphérique de bloc) si l'historique
  persistant est important.
- **Le CPU est toujours alloué (`cpu_always_allocated = true`).** La goroutine de surveillance de Gatus
  interroge chaque point de terminaison configuré selon son propre calendrier,
  indépendamment des requêtes HTTP entrantes. La facturation basée sur les requêtes
  limiterait le CPU entre les vues de page et bloquerait ou ignorerait silencieusement
  les vérifications planifiées — la boucle de surveillance **est** le produit, la même
  logique que pour UptimeKuma.
- **Instance unique par défaut** (`min_instance_count = 1`, `max_instance_count =
  1`). Plusieurs instances interrogeraient
  chacune indépendamment chaque point de terminaison et dupliqueraient les alertes —
  il n'y a pas de coordination partagée entre les instances Gatus.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin que la page d'état
  soit publiquement accessible. L'activation de l'IAP nécessite une connexion Google
  et bloque la visualisation non authentifiée.
- **Le point de terminaison de santé est `/health`**, qui renvoie HTTP 200 dès que le
  serveur lie son port.
- **Le contrôle d'accès, le cas échéant, est configuré dans `config.yaml`.** Gatus est livré
  avec une page d'état ouverte par défaut ; une protection optionnelle par authentification
  de base ou OIDC est configurée dans le bloc `security` de `config.yaml` et nécessite une reconstruction.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Gatus {#a-cloud-run--the-gatus-service}

Gatus s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs. Comme le CPU est toujours
alloué, la boucle de surveillance continue de fonctionner entre les requêtes entrantes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution
et la répartition du trafic.

### B. Persistance — le magasin d'historique SQLite {#b-persistence--the-sqlite-history-store}

Gatus n'a **pas d'instance Cloud SQL**. Son magasin d'historique optionnel est un fichier SQLite local
à `/data/data.db`, intégré à la structure de répertoires de l'image au moment de la construction. Sur
la configuration par défaut de Cloud Run, ce répertoire est **éphémère** — l'historique ne
survit pas à un redémarrage ou à un redéploiement.

- **Console :** Filestore → Instances (lorsque `enable_nfs = true`).
- **CLI :**
  ```bash
  # Confirm the injected environment on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Avant d'activer NFS pour un historique durable, lisez la mise en garde sur le journal WAL dans
[§1 Vue d'ensemble](#1-overview) et dans [Gatus_Common](Gatus_Common.md) — Cloud Run n'a pas
d'option PVC de bloc, donc NFS est le seul mécanisme de persistance optionnel ici et il
comporte un risque réel de corruption pour un fichier SQLite en mode WAL. Voir [App_CloudRun](App_CloudRun.md)
pour le modèle général de montage NFS (Filestore).

### C. Secret Manager {#c-secret-manager}

Gatus ne génère **aucun** secret au moment du déploiement — il n'y a pas de mot de passe de base de données ou
de clé de chiffrement à gérer. Secret Manager n'est utilisé que si vous fournissez le vôtre via
`secret_environment_variables` (par exemple, un `${VAR}` référencé dans
la configuration d'alerte de `config.yaml`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet au public
d'accéder à une page d'état, ce qui est généralement nécessaire. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring,
avec des vérifications de disponibilité et des politiques d'alerte optionnelles. Gatus enregistre le résultat de chaque vérification de point de terminaison
(succès/échec, durée) au fur et à mesure de son exécution.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gatus {#3-gatus-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Gatus n'a pas de base de données externe et pas
  d'étape de migration. Il lit `config.yaml`, initialise son magasin d'historique SQLite (si
  configuré) et commence à servir immédiatement. Il n'y a pas de job d'initialisation par défaut.
- **Magasin d'historique éphémère par défaut.** `/data/data.db` réside sur le système de fichiers
  local inscriptible du conteneur sans rien de monté, sauf si vous optez pour NFS. Chaque
  redémarrage ou redéploiement réinitialise l'historique des vérifications (la page d'état elle-même et toutes
  les vérifications actuellement configurées ne sont pas affectées — seuls les résultats historiques/pourcentages
  de disponibilité sont réinitialisés).
- **La boucle de surveillance nécessite un CPU alloué.** Chaque point de terminaison configuré est
  vérifié à son propre intervalle indépendant par une goroutine interne ;
  `cpu_always_allocated = true` garantit que cela continue de fonctionner entre les vues de page
  entrantes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health`, qui renvoie HTTP
  200 dès que le serveur lie le port 8080. Vérifier :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health"      # -> 200
  ```
- **Afficher la page d'état.**
  ```bash
  curl -s "$SERVICE_URL/" | head -20     # rendered HTML status page
  ```
- **Les modifications de configuration nécessitent une reconstruction.** Gatus n'a pas d'interface utilisateur ou d'API d'administration pour
  modifier les points de terminaison surveillés. Modifiez `modules/Gatus_Common/scripts/config.yaml` (ajoutez,
  supprimez ou modifiez les entrées `endpoints`) et redéployez pour appliquer les modifications.
- **L'accès est ouvert jusqu'à ce que vous le configuriez.** Par défaut, la page d'état n'a pas
  d'authentification. Configurez l'authentification de base ou OIDC dans le bloc `config.yaml` de `security`
  et redéployez pour restreindre la visualisation.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Gatus sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `application_name` | `gatus` | Nom de base pour le service, le dépôt de registre et les secrets. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Gatus` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base `v5.36.0` épinglée. Épinglez un `v5.x.y` explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | `custom` construit l'image du wrapper via Cloud Build ; `prebuilt` déploie une image directement. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512 Mi). |
| `min_instance_count` | `1` | Instances minimales. |
| `max_instance_count` | `1` | **Gardez à 1** — chaque réplique interrogerait indépendamment chaque point de terminaison et dupliquerait les alertes. |
| `container_port` | `8080` | Gatus écoute sur le port 8080. |
| `container_protocol` | `http1` | HTTP/1.1 par défaut. |
| `cpu_always_allocated` | `true` | Requis pour que la boucle de surveillance ne soit jamais limitée entre les requêtes. |
| `enable_cloudsql_volume` | `false` | Désactivé — Gatus n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Gatus dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour une page d'état publique. |
| `enable_iap` | `false` | Exiger une connexion Google. **Bloque la visualisation non authentifiée.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Substitutions pour les références de style `${VAR}` dans `config.yaml` (par exemple, un jeton de webhook d'alerte), pas des remplacements par paramètre. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager (facultatif ; aucun requis). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Montage d'historique durable optionnel. **Attention :** comporte un risque de WAL sur système de fichiers réseau — voir §1. |
| `nfs_mount_path` | `/data` | Chemin de montage NFS ; correspond au `storage.path` intégré dans `config.yaml`. |
| `storage_buckets` | `[]` | Non requis — Gatus n'utilise pas de stockage d'objets. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Gatus n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `gatus` | Inerte à moins qu'une base de données externe ne soit délibérément activée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Gatus n'a pas besoin de job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés optionnels. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 10s de délai | Sonde de démarrage. Gatus devient sain en quelques secondes. |
| `liveness_probe` | HTTP `/health` 15s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Vérification de disponibilité Cloud Monitoring optionnelle. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — Gatus n'a pas de dépendance Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `container_port`/`timeout_seconds` hors de portée, une valeur de mémoire inférieure au plancher gen2. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour l'historique durable) | Laissez `false` ; utilisez `Gatus_GKE` avec `stateful_pvc_enabled` à la place | Critique | Gatus code en dur le mode journal WAL de SQLite, que la propre documentation de SQLite déclare non pris en charge sur les systèmes de fichiers réseau — l'historique sauvegardé par NFS risque une corruption silencieuse au fil du temps. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 fait que chaque réplique interroge indépendamment chaque point de terminaison, dupliquant les notifications d'alerte sans coordination entre les instances. |
| `cpu_always_allocated` | `true` | Élevé | La définition de `false` permet à Cloud Run de limiter le CPU entre les requêtes, bloquant ou ignorant silencieusement les vérifications de points de terminaison planifiées par le chien de garde. |
| `ingress_settings` | `all` | Élevé | `internal` rend une page d'état publique inaccessible depuis l'extérieur du VPC. |
| `enable_iap` | uniquement lorsque l'authentification est activée | Élevé | L'IAP nécessite une connexion Google pour chaque requête, bloquant la visualisation non authentifiée de la page d'état — ce n'est généralement pas ce que souhaite une page d'état publique. |
| Bloc `security` de Gatus dans `config.yaml` | Configurer si la page contient des noms de points de terminaison sensibles | Moyen | Par défaut, la page d'état (y compris tous les noms de points de terminaison configurés et leur historique de disponibilité/indisponibilité) est publiquement visible par toute personne disposant de l'URL. |
| `container_port` | `8080` | Moyen | La surcharge d'une valeur sur laquelle Gatus n'écoute pas entraîne l'échec de toutes les sondes de santé. |
| `memory_limit` | `512Mi` | Faible | L'environnement d'exécution gen2 rejette les valeurs inférieures à 512 Mi au moment de l'application. |
| `application_version` | Épinglez `v5.x.y` en production | Faible | `latest` correspond à une base épinglée (`v5.36.0`) ; épinglez explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Gatus partagée
avec la variante GKE est décrite dans **[Gatus_Common](Gatus_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Gatus sur Cloud Run](../labs/Gatus_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gatus sur GKE Autopilot](Gatus_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gatus Common — Configuration d'application partagée](Gatus_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Beszel sur Google Cloud Run](Beszel_CloudRun.md), [Netdata sur Google Cloud Run](Netdata_CloudRun.md) dans la solution **Surveillance et NOC**.
