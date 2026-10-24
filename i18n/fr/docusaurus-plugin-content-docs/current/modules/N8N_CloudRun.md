---
title: "n8n sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de n8n sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/N8N_CloudRun.md @ 1665a43e sha256:57a7243007be -->

# n8n sur Google Cloud Run {#n8n-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_CloudRun.png" alt="n8n sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme d'automatisation de flux de travail à code équitable qui
connecte les API, les bases de données et les services avec un éditeur de nœuds
visuel. Ce module déploie n8n sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par n8n et sur la façon
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à chaque application Cloud Run — identité
de service, entrée et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte N8N sur RAD, et comment cela se compare {#what-n8n-costs-on-rad-and-how-that-compares}

**L'exécution de N8N dans votre propre projet GCP coûte environ 117,79 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~117,79 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~55 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (alwaysOn) | 47,34 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **117,79 $** |

### Comment cela se compare {#how-it-compares}

- Le cloud géré officiel de n8n (n8n Cloud) commence à **20 €/mois** facturé annuellement pour le plan Starter (2 500 exécutions de flux de travail) (source : https://n8n.io/pricing), géré par le projet lui-même sans infrastructure à opérer — la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu dimensionné pour cette charge de travail (une machine plus petite suffit — Hetzner CX11-class ou un Droplet DigitalOcean 1 vCPU/1-2 Go coûte **6-12 $/mois** — mais il faut toujours quelqu'un pour le patcher, le sauvegarder et le surveiller, ce que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous) est l'option la moins chère en termes de coûts, car l'empreinte de ce module est faible — mais vous êtes de nouveau à patcher et à sauvegarder vous-même.
- Dans tous les cas, il s'agit de l'épine dorsale de l'automatisation des flux de travail d'une équipe, de sorte que le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et
simplement le projet — la suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL,
aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD
gère uniquement pour la facturation), vous devez le restaurer vous-même dans les
30 jours — après cela, Google le supprime définitivement — et la restauration
est admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google
affirme que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de la supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer N8N
purement et simplement et de le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de
temps de build.

La suppression ne permet d'économiser de l'argent que si N8N restait inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son
propre coût d'exécution quotidien — par rapport au total du projet ci-dessus,
cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution
ici est généralement la base de données et la VM de fichier/cache partagée ;
elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
suppression de cette application pendant que quelque chose d'autre partage le
projet n'économise que la partie calcul de cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://n8n.io/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

n8n s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, toujours actif (facturation basée sur l'instance, `min_instance_count = 1`) afin que les déclencheurs cron/planifiés et l'exécution de la file d'attente se déclenchent sans requête entrante |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — n8n utilise PostgreSQL pour toutes les données de flux de travail et d'informations d'identification |
| Fichiers partagés | Filestore (NFS) | Données de fichiers binaires partagées entre toutes les instances ; sert également de point de terminaison Redis par défaut |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié |
| File d'attente et coordination | Redis | Activé par défaut ; active le mode file d'attente n8n pour la mise à l'échelle horizontale |
| Secrets | Secret Manager | Clé de chiffrement auto-générée et espace réservé au mot de passe SMTP |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app`, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ; la
  sélection de tout autre moteur ou `NONE` interrompt le démarrage.
- **Redis est activé par défaut.** Le mode file d'attente permet à plusieurs
  instances n8n de distribuer l'exécution des flux de travail. Sans Redis, une
  seule instance peut s'exécuter de manière fiable.
- **La clé de chiffrement est irremplaçable.** `N8N_ENCRYPTION_KEY` est générée une
  fois et stockée dans Secret Manager. Toutes les informations d'identification
  des flux de travail sont chiffrées avec elle. Si la clé est tournée ou
  supprimée, toutes les informations d'identification enregistrées deviennent
  définitivement illisibles.
- **`min_instance_count` est par défaut `1`.** n8n maintient une instance
  chaude afin que les webhooks et le déclencheur du planificateur/de la file
  d'attente se déclenchent sans délai de démarrage à froid. Définissez-le sur
  `0` uniquement si une latence occasionnelle des webhooks au
  démarrage à froid est acceptable.
- **`WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont pré-définis** sur l'URL de service
  Cloud Run prédite afin que les webhooks se résolvent correctement dès le
  premier démarrage. Si un domaine personnalisé est ajouté ultérieurement,
  redéployez pour mettre à jour ces valeurs.
- **L'environnement d'exécution Gen2 est requis** pour les montages NFS.
  `execution_environment` est par défaut `"gen2"`.
- Le secret du **mot de passe SMTP** est initialisé avec une valeur factice ;
  mettez-le à jour dans Secret Manager avant de configurer l'envoi d'e-mails.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service n8n {#a-cloud-run--the-n8n-service}

n8n s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge de requêtes entre le nombre minimal et maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de flux de travail, l'historique d'exécution
et les informations d'identification chiffrées dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Le service se connecte en privé via le **Cloud SQL Auth
Proxy** sur un socket Unix (pas d'IP publique). Le script `entrypoint.sh` traduit les
variables `DB_*` injectées par la plateforme en variables `DB_POSTGRESDB_*` natives de n8n
lors de l'exécution. Lors du premier déploiement, un job d'initialisation crée
la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les fichiers binaires téléchargés ou produits par les flux de travail sont
écrits dans un partage **Filestore (NFS)** monté dans le service afin que
toutes les instances partagent les mêmes données (`N8N_DEFAULT_BINARY_DATA_MODE=filesystem`). L'adresse IP de
l'hôte NFS sert également de point de terminaison Redis par défaut lorsqu'aucun
`redis_host` explicite n'est configuré. Un bucket **Cloud Storage** dédié est
provisionné pour une persistance des données plus large.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. File d'attente Redis {#d-redis-queue}

Redis active le mode file d'attente de n8n, distribuant les exécutions de flux
de travail sur plusieurs instances à l'aide de Bull. En mode file d'attente, une
ou plusieurs instances "worker" récupèrent les exécutions de la file d'attente
tandis que l'instance principale gère l'éditeur et l'enregistrement des
webhooks. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est
activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison
Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

La clé de chiffrement n8n et l'espace réservé au mot de passe SMTP sont stockés
dans Secret Manager et injectés dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Update the SMTP password with the real credential:
  echo -n "my-real-smtp-password" | \
    gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
superposé ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application n8n {#3-n8n-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) utilise `postgres:15-alpine` pour créer la base de données et
  l'utilisateur n8n avant le démarrage du service. Il est idempotent.
- **Traduction des variables d'environnement.** `entrypoint.sh` mappe `DB_HOST`, `DB_NAME`,
  `DB_USER` et `DB_PASSWORD` (injectées par la plateforme) aux équivalents `DB_POSTGRESDB_*` natifs de
  n8n au démarrage du conteneur.
- **Fonctionnement en mode file d'attente.** Avec `enable_redis = true` (par défaut), n8n
  démarre en mode file d'attente. L'instance principale gère l'enregistrement
  des webhooks, l'interface utilisateur de l'éditeur et la coordination de
  l'exécution ; les instances supplémentaires agissent comme des workers.
- **Stabilité de l'URL du webhook.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis sur l'URL de
  service Cloud Run prédite avant le déploiement. L'ajout ultérieur d'un
  domaine personnalisé nécessite un redéploiement pour mettre à jour ces
  valeurs.
- **Mise à l'échelle à zéro et webhooks.** `min_instance_count` est par défaut `1`,
  maintenant une instance chaude pour les charges de travail de webhook.
  Définir `0` signifie qu'aucune instance n'est en cours d'exécution
  lorsqu'elle est inactive — les services externes appelant des webhooks
  subiront une latence de démarrage à froid et des délais d'attente si le
  service appelant a un délai d'attente court.
- **Stockage de données binaires.** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` indique à n8n d'écrire les fichiers
  binaires dans le système de fichiers monté NFS plutôt que dans la base de
  données, ce qui est requis pour les déploiements multi-instances.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine
  n8n (`/`), qui renvoie HTTP 200 uniquement une fois l'application
  entièrement initialisée. La sonde de démarrage utilise un délai initial de
  120 secondes pour la configuration du premier démarrage.
- **Critique de la clé de chiffrement.** `N8N_ENCRYPTION_KEY` chiffre toutes les informations
  d'identification des flux de travail. Si elle change, toutes les informations
  d'identification enregistrées deviennent définitivement illisibles.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour n8n
sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8n` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `N8N Workflow Automation` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service Cloud Run. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner l'infrastructure uniquement sans déployer le conteneur. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Instances minimales. Maintient une instance chaude pour les charges de travail de webhook par défaut ; définir `0` pour une mise à l'échelle à zéro. |
| `cpu_always_allocated` | `true` | CPU alloué en permanence (facturation basée sur l'instance) — les déclencheurs cron/planifiés de n8n et l'exécution de la file d'attente se déclenchent sans requête entrante. |
| `max_instance_count` | `1` | Instances maximales (plafond de coût). |
| `container_port` | `5678` | n8n écoute sur le port 5678. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run. Gen2 requise pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image n8n dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions Cloud Run à conserver. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Valeurs par défaut de l'espace réservé SMTP | Paramètres supplémentaires non secrets. Les valeurs principales `N8N_*` et `DB_TYPE` sont définies automatiquement. La carte par défaut inclut `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` et `EMAIL_FROM` prêts à être remplacés. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données de fichiers binaires. Nécessite `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. |
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `n8n_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. Le planificateur intégré de n8n gère les déclencheurs de flux de travail ; utilisez-les pour les opérations externes. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `GET /`, délai initial de 120s | La sonde de démarrage cible la racine n8n. |
| `liveness_probe` / `health_check_config` | HTTP `GET /`, délai initial de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — File d'attente Redis {#group-21--redis-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour l'exécution de flux de travail en mode file d'attente. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'adresse IP de l'hôte NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` | _(auto-généré, ne jamais faire pivoter)_ | Critique | La rotation ou la suppression de cette clé détruit définitivement toutes les informations d'identification de flux de travail enregistrées. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de flux de travail. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les fichiers binaires ne sont pas partagés entre les instances et le mode binaire `filesystem` échoue. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` | `true` | Élevé | Sans le mode file d'attente Redis, l'exécution de plus d'une instance provoque des conflits d'exécution de flux de travail. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `min_instance_count` | `1` (par défaut) pour les charges de travail de webhook | Élevé | La définition de `0` provoque des délais d'attente de démarrage à froid sur les appels de webhook provenant de services avec des délais d'attente courts. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Les montages NFS nécessitent Gen2 ; les instances Gen1 ne peuvent pas monter de volumes NFS. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des erreurs OOM lors de grands lots d'exécution de flux de travail. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | L'éditeur n8n est autrement publiquement accessible et expose toutes les informations d'identification enregistrées. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à n8n partagée avec la variante GKE est décrite dans
**[N8N_Common](N8N_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : N8N sur Cloud Run](../labs/N8N_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [n8n sur GKE Autopilot](N8N_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [N8N Common — Configuration d'application partagée](N8N_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution **Marketing Automation Suite**.
