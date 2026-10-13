---
title: "N8N AI sur Cloud Run"
description: "Référence de configuration pour le déploiement de N8N AI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/N8N_AI_CloudRun.md @ e69407af sha256:be2031c737c0 -->

# N8N AI sur Cloud Run {#n8n-ai-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_AI_CloudRun.png" alt="N8N AI sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme d'automatisation de flux de travail open source avec une interface
visuelle basée sur des nœuds pour connecter des services, exécuter de la logique et
construire des pipelines basés sur l'IA. Ce module déploie n8n sur **Cloud Run v2**
ainsi que deux services d'IA compagnons — **Qdrant** (base de données vectorielle pour
RAG et recherche sémantique) et **Ollama** (inférence LLM locale pour une IA axée sur la
confidentialité) — sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par n8n AI et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécaniques communes à chaque application Cloud Run — identité de service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, contrôles de service VPC, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte N8N_AI sur RAD, et comparaison {#what-n8n_ai-costs-on-rad-and-how-that-compares}

**L'exécution de N8N_AI dans votre propre projet GCP coûte environ 101,98 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits uniques (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez mettre en pause l'ensemble gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~101,98 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, mesuré à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | 31,53 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **101,98 $** |

### Comparaison {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour N8N_AI à comparer, donc la base de référence honnête est un VPS nu : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un Compute Engine e2-standard-2 (2 vCPU/8 Go) de GCP est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est généralement pas — pour une pile d'automatisation IA axée sur la confidentialité (flux de travail + recherche vectorielle + service LLM local), le véritable argument est ce que RAD gère pour vous (sauvegardes, correctifs, secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit d'une pile d'automatisation IA axée sur la confidentialité (flux de travail + recherche vectorielle + service LLM local), de sorte que le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu.
Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources
déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la création
d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations
d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau
entièrement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous
avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez une
sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer.
Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de
30 jours ci-dessus), l'alternative est de supprimer N8N_AI purement et simplement et de le
redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les
builds — environ 175 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si N8N_AI reste inutilisé
suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente
environ 5 jours ou plus. La majeure partie du coût d'exécution ici est généralement la
base de données et la VM de fichier/cache partagée ; elles ne s'arrêtent que lorsque rien
d'autre dans le projet ne les utilise, donc la suppression de cette application pendant
que quelque chose d'autre partage le projet n'économise que la partie calcul de cette
application.

**Conservez les données en premier :** les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe.
  Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  interrompue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

n8n AI s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — n8n nécessite PostgreSQL ; le moteur est fixe |
| Fichiers partagés | Filestore (NFS) | Volume persistant partagé pour les données de flux de travail ; découverte d'hôte Redis par défaut |
| Stockage d'objets | Cloud Storage (GCS Fuse) | Bucket de données AI partagé monté à `/mnt/gcs` |
| Cache et file d'attente | Redis | Activé par défaut ; requis pour le mode file d'attente n8n (multi-instance) |
| Base de données vectorielle | Qdrant (service Cloud Run compagnon) | Service Cloud Run interne uniquement ; non accessible publiquement |
| Inférence LLM | Ollama (service Cloud Run compagnon) | Service Cloud Run interne uniquement ; non accessible publiquement |
| Secrets | Secret Manager | `N8N_ENCRYPTION_KEY` et `N8N_SMTP_PASS` auto-générés |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS optionnel + domaine personnalisé via Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  configuration commune ; `database_type` par défaut à `POSTGRES_15`. Le modifier en MySQL
  interrompt le démarrage de n8n.
- **`N8N_ENCRYPTION_KEY` est auto-généré** et stocké dans Secret Manager. Sauvegardez-le avant de
  détruire le module — les identifiants chiffrés avec une clé ne peuvent pas être
  déchiffrés avec une clé différente.
- **Qdrant et Ollama sont des services Cloud Run distincts**, déployés dans le même
  projet et accessibles uniquement depuis le VPC. Ils ne sont pas accessibles
  publiquement.
- **La persistance GCS Fuse** maintient l'index vectoriel de Qdrant et les poids de modèle
  d'Ollama durables à travers les redémarrages de conteneurs et les nouvelles révisions.
- **`min_instance_count` par défaut à `0`** (mise à l'échelle à zéro). Définissez sur
  `1` pour une disponibilité fiable des webhooks et pour éviter la latence de
  démarrage à froid pour les flux de travail d'inférence IA.
- **Redis est activé par défaut.** Une seule instance n8n peut fonctionner sans, mais
  plusieurs instances nécessitent Redis pour une exécution distribuée sécurisée.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service n8n AI et les compagnons AI {#a-cloud-run--the-n8n-ai-service-and-ai-companions}

n8n s'exécute en tant que service Cloud Run v2. Qdrant et Ollama s'exécutent chacun en
tant que services Cloud Run compagnons distincts dans le même projet, accessibles
uniquement en interne via VPC.

- **Console :** Cloud Run → sélectionnez chaque service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service n8nai-<tenant-id> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de flux de travail, l'historique d'exécution et les
identifiants dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix. Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
voir [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage (GCS Fuse) {#c-filestore-nfs-and-cloud-storage-gcs-fuse}

**Filestore (NFS)** fournit un volume persistant partagé monté dans le service n8n pour
les données de flux de travail et la persistance des identifiants entre les instances. Il
sert également d'hôte de découverte Redis par défaut lorsque `redis_host` est vide.

**Cloud Storage** est monté via GCS Fuse dans les trois services (n8n, Qdrant, Ollama)
pour la persistance des données spécifiques à l'IA :

- Index vectoriel de Qdrant à `/mnt/gcs/qdrant`
- Poids de modèle d'Ollama à `/mnt/gcs/ollama/models`
- Données de flux de travail n8n à `/home/node/.n8n`

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<ai-data-bucket>/   # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages NFS, GCS Fuse et les options CMEK.

### D. Backend de file d'attente Redis {#d-redis-queue-backend}

Redis prend en charge le mode file d'attente de n8n, permettant une exécution fiable des
flux de travail multi-instances. Lorsqu'aucun `redis_host` n'est configuré et que NFS est
activé, l'adresse IP du serveur NFS est utilisée. Pour la production avec haute
disponibilité, pointez vers une instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  gcloud run services describe n8nai-<tenant-id> \
    --project "$PROJECT" --region "$REGION" \
    --format='yaml(spec.template.spec.containers[0].env)'
  redis-cli -h <redis-host> ping
  ```

### E. Qdrant — base de données vectorielle {#e-qdrant--vector-database}

Qdrant fournit une recherche de similarité vectorielle haute performance pour les pipelines
RAG, les intégrations de documents et la mémoire IA dans les flux de travail n8n. Il
s'exécute en tant que service Cloud Run compagnon interne uniquement, accessible depuis n8n
via la variable d'environnement `QDRANT_URL`.

- **Console :** Cloud Run → sélectionnez le service Qdrant.
- **CLI :**
  ```bash
  gcloud run services describe qdrant-<tenant-id> --project "$PROJECT" --region "$REGION"
  # Confirm QDRANT_URL in the n8n service
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Ollama — serveur LLM local {#f-ollama--local-llm-server}

Ollama exécute des modèles de langage open source (Llama 3, Mistral, Gemma) sur votre
infrastructure, permettant une inférence IA axée sur la confidentialité sans dépendances
d'API externes. C'est un service Cloud Run interne uniquement ; `OLLAMA_HOST` est injecté
dans n8n.

- **Console :** Cloud Run → sélectionnez le service Ollama.
- **CLI :**
  ```bash
  gcloud run services describe ollama-<tenant-id> --project "$PROJECT" --region "$REGION"
  # Confirm OLLAMA_HOST in the n8n service
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### G. Secret Manager {#g-secret-manager}

La clé de chiffrement n8n et le mot de passe SMTP sont générés automatiquement et stockés
dans Secret Manager, puis injectés dans la révision Cloud Run au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour les détails
d'injection et de rotation.

### H. Réseau et entrée {#h-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé (utilisant Cloud Armor), Cloud CDN et des contrôles
VPC d'entrée/sortie peuvent être superposés. Pour les webhooks publics, `ingress_settings` doit
rester `"all"`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe n8nai-<tenant-id> \
    --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés et les adresses IP
statiques.

### I. Cloud Logging et Monitoring {#i-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des
stratégies d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read n8nai-<tenant-id> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application N8N AI {#3-n8n-ai-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation se connecte à Cloud SQL via le socket Unix du proxy d'authentification
  et crée la base de données PostgreSQL `n8n_db` et l'utilisateur `n8n_user`,
  accorde tous les privilèges, puis arrête proprement le proxy. Le job est idempotent et
  peut être réexécuté en toute sécurité.
- **Clé de chiffrement.** `N8N_ENCRYPTION_KEY` est auto-générée lors du premier déploiement et
  stockée dans Secret Manager. **Sauvegardez ce secret avant de détruire le module.**
  Tous les identifiants n8n (clés API, jetons OAuth, mots de passe de flux de travail) sont
  chiffrés avec cette clé ; ils ne peuvent pas être déchiffrés après un redéploiement avec
  une clé différente.
- **Sondes de santé.** La sonde de démarrage cible `GET /` sur le port 5678 avec un
  délai initial de 120 secondes, donnant à n8n le temps de se connecter à PostgreSQL et de
  charger l'état du flux de travail. Cloud Run ne routra pas le trafic tant que la sonde de
  démarrage n'aura pas réussi.
- **URL de webhook et d'éditeur.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis sur
  l'URL de service prédite avant le déploiement de la révision afin que les webhooks
  fonctionnent sans réapplication post-déploiement.
- **Mode file d'attente.** Lorsque Redis est activé, n8n fonctionne en mode file d'attente
  pour une exécution fiable des flux de travail sur plusieurs instances. Avec une seule
  instance (`max_instance_count = 1`), le mode file d'attente est facultatif.
- **Mise à l'échelle à zéro et démarrages à froid.** Avec `min_instance_count = 0`, les instances
  s'arrêtent lorsqu'elles sont inactives. La première requête après la mise à l'échelle
  déclenche un démarrage à froid qui inclut l'initialisation de n8n par rapport à la base
  de données — cela peut prendre 30 à 60 secondes. Définissez `min_instance_count = 1` pour éliminer
  ce délai.
- **Mot de passe SMTP.** `N8N_SMTP_PASS` est auto-généré comme espace réservé. Remplacez la
  valeur secrète dans Secret Manager par de véritables identifiants SMTP avant d'activer
  l'envoi d'e-mails.
- **Inspecter les jobs Cloud Run :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour n8n AI sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8nai` | Nom de base pour les ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `N8N AI Starter Kit` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de service. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance n8n. 2 vCPU recommandés pour les flux de travail IA. |
| `memory_limit` | `4Gi` | Mémoire par instance n8n. 4 GiB minimum pour les flux de travail IA. |
| `min_instance_count` | `0` | Définissez sur `1` pour une disponibilité continue des webhooks. `0` active la mise à l'échelle à zéro. |
| `cpu_always_allocated` | `true` | Facturation basée sur l'instance (CPU toujours activé). Requis — les déclencheurs cron/planifiés et l'exécution de la file d'attente se déclenchent sans requête entrante. |
| `max_instance_count` | `1` | Nombre maximal d'instances. N'augmentez qu'avec Redis activé. |
| `container_port` | `5678` | n8n écoute sur le port 5678. Ne pas modifier. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. Garder comme `gen2`. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour les flux de travail d'inférence IA longs. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du système de fichiers où le socket Unix du Cloud SQL Auth Proxy est monté. Utilisé uniquement lorsque `enable_cloudsql_volume = true`. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements sécurisés. |
| `max_revisions_to_retain` | `7` | Anciennes révisions à conserver dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. **Doit être `all` pour les webhooks publics.** |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Remarque :** l'activation d'IAP bloque les webhooks publics. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Espaces réservés SMTP | Paramètres non sensibles. Les variables n8n principales sont auto-injectées ; ne pas définir `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `QDRANT_URL`, ou `OLLAMA_HOST`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Utilisez-les pour les clés API des fournisseurs d'IA externes. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant le déploiement. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation (30 jours). |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — NFS et SQL personnalisé {#group-9--nfs--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher un équilibreur de charge HTTPS Cloud Armor + politique WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés ; nécessite `enable_cloud_armor`. |
| `admin_ip_ranges` | `[]` | CIDR avec accès privilégié. |
| `enable_cdn` | `false` | Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` | `7` | Nombre maximal d'images conteneurs conservées par révision. |
| `delete_untagged_images` | `true` | Purger les images orphelines/non taguées d'Artifact Registry. |
| `image_retention_days` | `30` | Seuil de suppression d'images basé sur l'âge. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données de flux de travail et la découverte d'hôte Redis. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` | `true` | Provisionner des buckets GCS. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de données AI auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. n8n nécessite PostgreSQL. |
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `n8n_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes après la rotation pour redémarrer les instances. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Alias pour les détails de connexion injectés en tant que variables d'environnement supplémentaires. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés pour les exportations de flux de travail ou la maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` — délai de 120s | Sonde de démarrage n8n ; permet la connexion à la base de données + le chargement du flux de travail. |
| `liveness_probe` | HTTP `/` — délai de 30s | Sonde de vivacité n8n. |
| `startup_probe_config` | TCP — activé | Sonde de démarrage standard App_CloudRun. |
| `health_check_config` | HTTP — activé | Sonde de vivacité standard App_CloudRun. |
| `uptime_check_config` | désactivé — `/` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut — activez-la une fois le point de terminaison accessible publiquement. |
| `alert_policies` | `[]` | Politiques d'alerte métriques optionnelles. |

### Groupe 21 — Backend de file d'attente Redis {#group-21--redis-queue-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le mode file d'attente n8n. **Requis lorsque `max_instance_count > 1`.** |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP du serveur NFS ; définir explicitement pour une instance Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — Composants IA {#group-22--ai-components}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_ai_components` | `true` | Commutateur principal. Définissez `false` pour déployer n8n sans Qdrant ni Ollama. |
| `enable_qdrant` | `true` | Déployer Qdrant en tant que service Cloud Run interne. |
| `qdrant_version` | `latest` | Tag d'image Qdrant. Épingler à une version spécifique pour la stabilité en production. |
| `enable_ollama` | `true` | Déployer Ollama en tant que service Cloud Run interne. |
| `ollama_version` | `latest` | Tag d'image Ollama. Épingler à une version spécifique pour la stabilité en production. |
| `ollama_model` | `llama3.2` | Modèle par défaut déclaré. Remarque : cette variable n'est actuellement pas transmise au service Ollama — les modèles doivent être extraits séparément au niveau de l'API Ollama. |

### Groupe 23 — Contrôles de service VPC et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `organization_id` | `""` | Requis lorsque `enable_vpc_sc = true`. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run pour n8n. |
| `service_url` | URL `run.app` par défaut du service n8n. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsque Cloud Armor est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de données AI). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` (auto-généré) | Sauvegarder immédiatement | Critique | La modification après la première exécution détruit définitivement tous les identifiants n8n enregistrés. |
| `application_name` | `n8nai` — défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée toutes les ressources GCP avec perte de données. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage pointe n8n vers une nouvelle base de données vide, perdant tous les flux de travail. |
| `database_type` | `POSTGRES_15` | Critique | n8n nécessite PostgreSQL ; le passage à MySQL ou NONE interrompt le démarrage. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation et bloque le démarrage. |
| `enable_qdrant` | `true` | Élevé | Les flux de travail RAG actifs échouent à l'exécution avec des erreurs de connexion si Qdrant est supprimé. |
| `enable_ollama` | `true` | Élevé | Les flux de travail utilisant le nœud LLM local échouent ; ne désactiver que lors de l'utilisation exclusive de fournisseurs d'IA externes. |
| `enable_redis` | `true` | Élevé | Sans Redis, plusieurs instances entrent en conflit sur l'état du flux de travail ; l'exécution en mode split-brain corrompt les exécutions. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que `redis_host` et NFS sont tous deux non définis, n8n ne démarre pas. |
| `memory_limit` | `4Gi` | Élevé | Les flux de travail IA (intégration, recherche vectorielle, chaînage LLM) provoquent des OOM kills en dessous de 4 GiB. |
| `ingress_settings` | `all` pour les webhooks publics | Élevé | `internal` ou `internal-and-cloud-load-balancing` bloquent la livraison des webhooks externes. |
| `max_instance_count` | `1` sauf si Redis configuré | Élevé | La mise à l'échelle au-dessus de 1 sans Redis provoque un split-brain ; l'augmentation avec Redis est sûre. |
| `min_instance_count` | `1` pour les webhooks | Moyen | `0` provoque des retards de démarrage à froid (30–60s) ; les webhooks manquent le premier événement pendant le réchauffement. |
| `enable_nfs` | `true` | Élevé | Sans NFS, les données de flux de travail ne sont pas partagées entre les instances et la découverte d'hôte Redis échoue. |
| `enable_iap` | uniquement avec des identifiants OAuth valides | Élevé | L'activation sans `iap_authorized_users` / `iap_authorized_groups` bloque tout accès. IAP bloque également les webhooks publics. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne prend pas en charge les montages NFS ; l'intégration Filestore nécessite `gen2`. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, autorisation
binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**.
La configuration d'application spécifique à n8n AI partagée avec la variante GKE est décrite
dans **[N8N_AI_Common](N8N_AI_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : N8N_AI sur Cloud Run](../labs/N8N_AI_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [N8N AI sur GKE Autopilot](N8N_AI_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [N8N AI Common — Configuration d'application partagée](N8N_AI_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) dans la solution **AI Automation Starter**.
