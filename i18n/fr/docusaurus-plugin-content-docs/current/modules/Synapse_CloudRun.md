---
title: "Synapse sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Synapse sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Synapse_CloudRun.md @ e69407af sha256:2ee150396096 -->

# Synapse sur Google Cloud Run {#synapse-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Synapse_CloudRun.png" alt="Synapse sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Synapse est le serveur domestique [Matrix](https://matrix.org/) de référence — le
serveur Python open-source sous licence Apache 2.0 pour le protocole Matrix, une norme
ouverte pour la communication décentralisée et fédérée en temps réel (chat sécurisé et
VoIP). Ce module déploie Synapse sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée. Les utilisateurs se connectent au serveur domestique avec un client Matrix tel
que l'application web [Element](https://element.io/).

Ce guide se concentre sur les services cloud utilisés par Synapse et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application Cloud Run — identité de service,
ingestion et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte Synapse sur RAD, et comment cela se compare {#what-synapse-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Synapse sur RAD coûte environ 180,87 $ US par mois dans un projet Google Cloud que vous possédez, avec des frais de module uniques de 300 crédits (30 $ US, ou 270 crédits dans un projet géré par RAD, soit 10 % de moins).** Cette configuration maintient le service en fonctionnement continu plutôt que de le mettre à l'échelle à zéro, car un serveur domestique de chat fédéré doit rester joignable pour le trafic de fédération entrant à tout moment — ce qui explique en grande partie pourquoi il s'agit du module de messagerie le plus cher de RAD. GKE Autopilot est l'option la moins chère ; voir le [guide GKE](Synapse_GKE.md), à environ 149,81 $ US par mois avec des frais de module proportionnellement inférieurs. Si vous n'avez besoin d'un serveur domestique qu'occasionnellement — une communauté éphémère, une fédération de test — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **180,87 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **83 crédits par jour**, soit environ 2 490 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **180,87 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre hébergée d'Element pour Matrix (Element Server Suite) ne publie pas de prix — les niveaux Enterprise et Sovereign sont sur devis uniquement — donc aucun chiffre vérifié n'est mentionné ici.
- Une comparaison autogérée, dimensionnée pour un serveur de chat fédéré toujours actif : un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois, tandis qu'une machine 2 vCPU/4 Go de Hetzner ou DigitalOcean coûte environ 24 $/mois — avant d'ajouter une base de données gérée, des sauvegardes, TLS et le travail continu de maintien d'un service orienté fédération patché et surveillé 24h/24, ce que Cloud SQL, Secret Manager et la surveillance de RAD couvrent pour vous.
- Synapse est le module le plus lourd de cette famille car il doit rester joignable en permanence pour la fédération — contrairement à un tableau de bord ou un CMS qui peut se mettre à l'échelle à zéro entre les visites, un serveur domestique doit répondre à toute heure, ce qui se reflète dans le coût de fonctionnement alwaysOn ci-dessus plutôt que dans les frais de module.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Synapse s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM NFS ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vos salons et l'historique de vos messages sont importants pour vous, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Synapse purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 305 crédits (environ 30,50 $ US) dans votre propre projet, ou 275 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Synapse resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement quotidien — par rapport au total du projet ci-dessus (environ 6,03 $ US par jour), cela représente environ 6 jours ou plus, ou environ 4 jours ou plus dans un projet géré par RAD (83 crédits par jour). La majeure partie du coût de fonctionnement ici est l'instance Cloud Run toujours active, plus la base de données et le serveur de fichiers NFS ; ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Synapse pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. La page de tarification d'Element Server Suite liste les niveaux mais ne publie aucun chiffre, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

Synapse s'exécute en tant que conteneur Python sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur domestique Python, 2 vCPU / 4 GiB par défaut, maintenu chaud (`min_instance_count = 1`) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Synapse ne prend pas en charge MySQL ; la base de données **doit** utiliser la collation `C` |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Fichiers persistants | NFS (Filestore) | Clé de signature + dépôt de médias sous le répertoire de données ; activé par défaut |
| Secrets | Secret Manager | Secret partagé d'enregistrement auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire, avec la collation `C`.** Le moteur de base de
  données est fixé par la couche d'application partagée, et le job `db-init` du premier
  déploiement crée la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` — Synapse refuse de démarrer
  avec toute autre collation.
- **Synapse gère son propre schéma.** Il n'y a pas de job de migration séparé ; Synapse
  crée et met à jour son propre schéma automatiquement à chaque démarrage.
- **`homeserver.yaml` et la clé de signature sont générés au premier démarrage.** Le point
  d'entrée cloud génère la configuration plus une clé de signature persistante dans le
  répertoire de données et connecte la plateforme PostgreSQL avant de démarrer Synapse.
- **La clé de signature doit persister.** La régénérer rompt la fédération et invalide
  toutes les sessions d'appareil, de sorte que le répertoire de données est sauvegardé
  par un stockage NFS persistant (`enable_nfs = true` par défaut).
- **`server_name` est fixé à `matrix.local`.** C'est le domaine intégré à chaque ID
  utilisateur (`@user:server_name`) et à la fédération. `Synapse_CloudRun` n'expose pas
  d'entrée `server_name` — la valeur provient toujours de la valeur par défaut de
  `Synapse_Common`, de sorte qu'un déploiement de production nécessitant un domaine réel
  nécessite actuellement de remplacer directement le module Common.
- **Écoute sur le port 8008.** L'écouteur HTTP client + fédération est défini dans la
  configuration générée ; la santé est servie sans authentification à `/health`.
- **Maintenu chaud, non mis à l'échelle à zéro.** Un serveur domestique maintient la
  fédération, la rétention en arrière-plan et la présence entre les requêtes, donc
  `min_instance_count = 1` et `cpu_always_allocated = true` sont les valeurs par défaut. La mise à
  l'échelle à zéro est mal adaptée à un serveur domestique fédérateur (une instance
  froide manque le trafic de fédération entrant).
- **Redis n'est pas utilisé.** Synapse exécute un seul processus principal entièrement
  soutenu par PostgreSQL.
- **Les utilisateurs administrateurs sont créés hors bande.** L'enregistrement en
  libre-service est désactivé par défaut ; créez des utilisateurs avec `register_new_matrix_user` et
  le secret partagé d'enregistrement dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Synapse {#a-cloud-run--the-synapse-service}

Synapse s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Synapse stocke tout l'état du serveur domestique (comptes, salons, événements, clés
d'appareil, état de fédération) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le
service se connecte en privé via le **proxy d'authentification Cloud SQL** via un socket
Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job `db-init`
crée la base de données de l'application **avec la collation `C`** et l'utilisateur
de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et le répertoire de données persistant {#c-cloud-storage--the-persistent-data-directory}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement. L'état
d'exécution propre à Synapse — `homeserver.yaml`, les remplacements `conf.d`, la
**clé de signature** et le dépôt de médias — se trouve sous le répertoire de données
(`SYNAPSE_DATA_DIR = /data`), qui est sauvegardé par le volume NFS (Filestore) monté au chemin de
montage configuré.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse, NFS et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Un **secret partagé d'enregistrement** est généré automatiquement et stocké dans Secret
Manager ; il prend en charge `register_new_matrix_user` pour la création de comptes hors bande. Le mot
de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Le trafic client Matrix et
de fédération nécessite une accessibilité publique, donc `ingress_settings = "all"` est la valeur par
défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé (recommandé
pour la production), Cloud CDN pour les médias et Cloud Armor peuvent être ajoutés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Synapse {#3-synapse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init`
  exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le proxy
  d'authentification Cloud SQL et crée de manière idempotente le rôle d'application et la
  base de données **avec la collation `C`** (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`), recréant
  une base de données vide avec une mauvaise collation si la fondation en a créé une en
  premier. Le job peut être réexécuté en toute sécurité.
- **Pas de job de migration — schéma autogéré.** Synapse crée et met à jour son schéma
  à chaque démarrage, de sorte que la mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte.
- **Configuration + clé de signature générées au premier démarrage.** Le point d'entrée
  cloud génère `homeserver.yaml` et une clé de signature persistante dans `/data`,
  écrit un extrait `conf.d` connectant PostgreSQL et l'écouteur `0.0.0.0:8008`,
  puis exécute Synapse. La clé de signature n'est générée qu'une seule fois — conservez
  `/data` sur un stockage persistant.
- **`server_name` est fixé à `matrix.local`.** `Synapse_CloudRun` n'expose pas d'entrée
  `server_name` (il utilise toujours la valeur par défaut `Synapse_Common`) ; la
  modification de la valeur sous-jacente après le premier démarrage invalide chaque ID
  utilisateur, session d'appareil et relation de fédération.
- **Chemin de santé.** La cible par défaut `startup_probe`/`liveness_probe` est
  `/` (racine). Synapse sert également un point de terminaison
  `/health` non authentifié (`OK`) qui peut être utilisé en
  remplaçant ces chemins de sonde. Confirmez que l'API client est en service avec
  `GET /_matrix/client/versions` :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/_matrix/client/versions"
  ```
- **Le job `create-admin` s'auto-ignore ici.** `Synapse_Common` fournit également un job
  `create-admin` qui enregistre le superutilisateur initial via `register_new_matrix_user`,
  mais il se termine avec le code 0 sans rien faire lorsque `internal_service_url` est vide — et
  seul `Synapse_GKE` connecte cette valeur, donc sur Cloud Run, le compte
  administrateur est toujours à vous de créer.
- **Créez le premier utilisateur administrateur** avec l'outil d'enregistrement Matrix,
  en utilisant le secret partagé de Secret Manager :
  ```bash
  register_new_matrix_user -c homeserver.yaml -u admin -a https://<your-domain>
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Synapse sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `synapse` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Synapse Helpdesk` | Nom lisible par l'homme affiché dans la console. La valeur par défaut fournie est un modèle standard hérité d'un modèle d'application de support technique — remplacez-la. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image Synapse ; épingler à une version spécifique (par exemple `v1.119.0`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; **minimum 2 GiB** pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Maintient le serveur domestique chaud pour la fédération et les tâches en arrière-plan. Ne **pas** définir `0` pour un serveur fédérateur. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `cpu_always_allocated` | `true` | CPU toujours alloué pour que la fédération/rétention en arrière-plan continue de fonctionner entre les requêtes. |
| `container_port` | `8008` | Écouteur HTTP client + fédération de Synapse. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base Synapse dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingestion {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour le client Matrix public et le trafic de fédération. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la fédération et les clients externes** — utiliser uniquement pour les serveurs domestiques réservés aux administrateurs/privés. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base `SYNAPSE_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend HTTPS LB (utile pour les médias). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket de données GCS. |
| `enable_nfs` | `true` | NFS persistant pour le répertoire de données (clé de signature + médias). |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `synapse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `synapse` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés : `db-init` (base de données + rôle avec collation C) et `create-admin` (s'auto-ignore sur Cloud Run — voir §3). |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs planifiés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai 60s | Sonde de démarrage. Synapse sert également un point de terminaison `/health` non authentifié qui peut être utilisé en remplaçant `path`. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse utilise une file d'attente/cache basée sur PostgreSQL — laisser `false` sauf si externalisé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis (uniquement en cas d'externalisation). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en lecture
> sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des
> montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une
> configuration invalide échoue la **planification** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `server_name` (fixé `matrix.local`) | Non exposé comme entrée `Synapse_CloudRun` | Critique | La fédération réelle et les ID utilisateur durables nécessitent un domaine personnalisé ; ce module n'a pas de variable `server_name`, de sorte que l'utilisation en production nécessite actuellement de remplacer directement `Synapse_Common`. La modification de la valeur sous-jacente après le premier démarrage invalide chaque ID utilisateur, session d'appareil et relation de fédération. |
| Persistance de la clé de signature (`enable_nfs`) | `true` | Critique | Si le répertoire de données n'est pas persistant, un redémarrage régénère la clé de signature, rompant la fédération et invalidant toutes les sessions d'appareil. |
| Collation de la base de données (`db-init`) | `C` (automatique) | Critique | Synapse refuse de démarrer avec toute collation non-`C` ; ne contournez pas le job `db-init`. |
| `db_name` / `db_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro laisse un serveur domestique fédérateur froid — il manque le trafic de fédération entrant et les tâches en arrière-plan sont bloquées. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes limite le CPU à ~0 entre les requêtes, bloquant la rétention en arrière-plan et les tentatives de fédération. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous de 2 GiB, Synapse manque de mémoire sous une charge réelle de salon/fédération. |
| `ingress_settings` | `all` | Élevé | `internal` bloque les clients Matrix et toute la fédération. |
| `enable_iap` | uniquement pour les serveurs privés | Élevé | IAP bloque la fédération et les clients externes ; utiliser uniquement pour les déploiements réservés aux administrateurs. |
| `container_port` | `8008` | Élevé | Synapse écoute sur le port 8008 ; un port non concordant fait que la sonde atteint un port mort et la révision ne devient jamais prête. |
| Chemin de sonde | `/` (par défaut) ou `/health` | Élevé | Pointer `startup_probe`/`liveness_probe` vers un chemin d'API Matrix authentifié renvoie 401/403 et la révision ne devient jamais prête. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cdn` | activer pour les serveurs à forte teneur en médias | Moyen | Les téléchargements de médias sont servis directement depuis l'instance sans déchargement CDN. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingestion et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Synapse
partagée avec la variante GKE est décrite dans **[Synapse_Common](Synapse_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Synapse sur Cloud Run](../labs/Synapse_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Synapse sur GKE Autopilot](Synapse_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Synapse Common — Configuration d'application partagée](Synapse_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Element sur Google Cloud Run](Element_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md), [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Communications d'équipe sécurisées**.
