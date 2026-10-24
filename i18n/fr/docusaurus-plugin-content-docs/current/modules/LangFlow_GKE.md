---
title: "LangFlow sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LangFlow sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LangFlow_GKE.md @ 1665a43e sha256:28fc2744b2fb -->

# LangFlow sur GKE Autopilot {#langflow-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LangFlow_GKE.png" alt="LangFlow sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LangFlow est un constructeur visuel open-source à faible code pour les agents et les
flux de travail d'IA, basé sur LangChain — vous assemblez des chaînes de modèles de
langage, des pipelines RAG et des agents en faisant glisser et en connectant des
composants sur un canevas, puis en les exposant sous forme d'API. Ce module
déploie LangFlow sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par LangFlow et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et le cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte LangFlow sur RAD, et comment cela se compare {#what-langflow-costs-on-rad-and-how-that-compares}

**Le module LangFlow sur GKE Autopilot de RAD coûte environ 97 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11,00 $ US).** GKE convient à LangFlow exécutant des flux en continu ou à côté d'autres infrastructures d'agents ; pour le coût le plus bas, le [module Cloud Run](LangFlow_CloudRun.md) exécute le même LangFlow pour environ 84 $ US par mois. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 97 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **97 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **87 crédits par jour**, soit environ 2610 par mois (environ 261 $ US au prix de la recharge, 209 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel.
Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 97 $ US** |

### Comment cela se compare {#how-it-compares}

- **Le compte cloud LangFlow hébergé par DataStax est gratuit mais basé sur l'utilisation**, sans prix mensuel fixe publié, nous n'en citons donc pas.
- **Un e2-standard-2 Compute Engine (2 vCPU/8 Go, environ 49 $/mois)** est la comparaison autogérée de taille plus proche pour le pod GKE de 1 vCPU/2 Gio plus Postgres, moins la base de données gérée, les sauvegardes et les correctifs inclus par RAD.
- Les appels aux fournisseurs LLM sont facturés séparément de l'infrastructure dans tous les cas.
- Ou consultez le [guide Cloud Run](LangFlow_CloudRun.md) pour l'option la moins chère.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LangFlow s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela
convient bien mieux à LangFlow dont vous n'avez besoin qu'occasionnellement — un
projet de cours, une démo, une évaluation de courte durée — que de le faire
fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas
  le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant cette période. Contrairement
  à la suppression d'un module, cela ne supprime pas Cloud SQL ou le calcul propre
  de LangFlow un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête
  simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  réactiver le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une
  mise à jour ne facture jamais les frais de module à nouveau. Pour LangFlow derrière
  un petit Services_GCP et Project_GCP, cela représente **une poignée de crédits
  (moins de 1 $ US)** au total, contre les 115 crédits que coûte un redéploiement
  complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement. La
  restauration est admise comme la création d'un nouveau projet : votre solde de
  crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
  niveau sandbox qui convient à la plupart des utilisations d'étude et de démo).
  Google indique que la plupart des services sont à nouveau pleinement fonctionnels
  dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes de LangFlow sont écrites dans un bucket à l'intérieur du projet, et ce
  bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est
  donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le
  projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé
  LangFlow et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers
  Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans
  rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à
l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré
par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée,
la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer
lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 115 crédits (11,50 $ US), car RAD recrée le projet et les services
  partagés avant LangFlow. La suppression ne permet d'économiser de l'argent que si
  LangFlow resterait inutilisé pendant environ quatre jours ou plus, à la fois dans
  votre propre projet (environ 3,22 $ US par jour) et dans un projet géré par RAD
  (87 crédits par jour).
- **Supprimez tout ce que LangFlow utilise.** La majeure partie du coût d'exécution
  est généralement la base de données. Elle ne s'arrête que si rien d'autre dans le
  projet ne l'utilise, donc la suppression de LangFlow alors que quelque chose
  d'autre partage le projet n'économise que la partie calcul propre de LangFlow.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket
  à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
  dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session LangFlow
  pour une classe. Chaque participant dispose de LangFlow dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation fixée
  par le formateur. Soit le formateur finance toutes les places à l'avance, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session, et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  LangFlow pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire remet le projet, et les
  déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et l'estimation quotidienne de 87 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source
avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LangFlow s'exécute comme une seule charge de travail web Python (FastAPI + React).
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python sur le port **7860**, 1 vCPU / 2 Gio par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — LangFlow persiste tous les flux, composants et identifiants dans Postgres |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié est provisionné par défaut ; l'état de l'application LangFlow lui-même réside dans PostgreSQL |
| Cache et file d'attente | Redis (facultatif) | Non requis par LangFlow ; câblé pour la compatibilité ascendante uniquement |
| Secrets | Secret Manager | `LANGFLOW_SECRET_KEY` et `LANGFLOW_SUPERUSER_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`database_type = "POSTGRES_15"`) ; la sélection de tout autre
  moteur interrompt le démarrage.
- **`LANGFLOW_SECRET_KEY` est généré automatiquement** et stocké dans Secret Manager.
  Il chiffre toutes les informations d'identification stockées intégrées dans un
  flux. Il ne doit jamais être renouvelé après le premier démarrage — le renouveler
  rompt définitivement toutes les informations d'identification stockées, qui doivent
  alors être saisies à nouveau dans chaque flux.
- **Le compte administrateur est provisionné à partir d'un mot de passe généré.**
  `LANGFLOW_AUTO_LOGIN = "false"` active l'authentification ; LangFlow crée l'administrateur
  initial (`admin` par défaut) en utilisant le secret `LANGFLOW_SUPERUSER_PASSWORD`.
  Récupérez-le de Secret Manager pour vous connecter.
- **La base de données se connecte via le sidecar Cloud SQL Auth Proxy** sur
  `127.0.0.1` ; le point d'entrée compose `LANGFLOW_DATABASE_URL` sur TCP avec
  `sslmode=disable` (le proxy termine TLS).
- **L'affinité de session est `ClientIP` par défaut.** LangFlow conserve
  l'état de la session et de l'éditeur de flux en cours de traitement ; le routage
  persistant maintient un client sur le même pod.
- **Un seul pod par défaut** (`min_instance_count = 1`, `max_instance_count = 1`). GKE ne se met
  pas à l'échelle à zéro ; l'état en cours de traitement de LangFlow signifie qu'un
  seul réplica est la valeur par défaut sûre.
- **Les flux et les informations d'identification résident dans PostgreSQL ; les
  fichiers téléchargés résident sur un PVC de bloc.** `stateful_pvc_enabled = true` (par
  défaut) exécute LangFlow en tant que StatefulSet avec un PVC par pod à
  `/data`, que le wrapper transmet à LangFlow en tant que
  `LANGFLOW_CONFIG_DIR` — le répertoire contenant les fichiers téléchargés.
  `stateful_fs_group = 1000` rend le PVC accessible en écriture par l'utilisateur non root de
  LangFlow. NFS est désactivé par défaut. Un bucket Cloud Storage
  `data` est également provisionné (`storage_buckets`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LangFlow {#a-gke-autopilot--the-langflow-workload}

Les pods LangFlow sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  LangFlow pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le
type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LangFlow stocke toutes les données d'application (flux, composants, identifiants,
historique d'exécution, utilisateurs) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy**
sur `127.0.0.1` ; aucune IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données de l'application, le rôle et les
autorisations.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et
la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Redis (facultatif — non utilisé par LangFlow) {#c-redis-optional--not-used-by-langflow}

Redis est **désactivé par défaut** et LangFlow ne le requiert pas ; les entrées
`enable_redis` sont câblées pour la compatibilité ascendante uniquement. Laissez
`enable_redis = false` à moins qu'une fonctionnalité future ne le nécessite.

- **CLI (uniquement si activé) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`LANGFLOW_SECRET_KEY` (chiffre toutes les informations d'identification stockées) et
`LANGFLOW_SUPERUSER_PASSWORD` (le mot de passe de connexion administrateur initial). Ils sont
livrés aux pods via l'intégration Secret Store CSI. Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation
de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google
peut être activé, et une IP statique peut être réservée afin que l'adresse survive
aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN
et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL
vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte
facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LangFlow {#3-langflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il
  attend PostgreSQL, puis crée de manière idempotente le rôle et la base de données
  de l'application, définit la propriété et accorde les privilèges sur la base de
  données et le schéma `public`, puis signale au sidecar Cloud SQL Auth
  Proxy de s'arrêter (`POST /quitquitquit`) afin que le pod du job se termine
  proprement. Il peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** LangFlow exécute ses **migrations Alembic à
  chaque démarrage de conteneur**, de sorte que les tables sont créées et mises à
  jour par l'application elle-même — le job `db-init` ne gère que le
  rôle/la base de données/les autorisations. Prévoyez un temps supplémentaire au
  premier démarrage.
- **`LANGFLOW_SECRET_KEY` est immuable après le premier démarrage.** Il est généré
  une fois et écrit dans Secret Manager. Le modifier rompt définitivement toutes les
  informations d'identification stockées intégrées dans un flux ; elles ne peuvent
  plus être déchiffrées. Ne le renouvelez que pendant une fenêtre de maintenance
  planifiée avec un plan pour ressaisir les informations d'identification.
- **Compte administrateur initial.** Avec `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow crée le
  super-utilisateur (`admin` par défaut, défini via `langflow_username`)
  en utilisant le secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez le mot de passe et
  connectez-vous :
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **L'URL de la base de données est composée au moment de l'exécution.** Le point
  d'entrée construit `LANGFLOW_DATABASE_URL` à partir des variables
  `DB_*` injectées sur TCP. Sur GKE `DB_HOST = 127.0.0.1` (le sidecar Auth
  Proxy) donc `sslmode=disable` est utilisé — ne définissez pas le DSN
  manuellement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/health`**, le point de terminaison de vivacité public de LangFlow qui
  renvoie `200` une fois le serveur démarré. Prévoyez un temps au
  premier démarrage pour les migrations Alembic avant que le pod ne devienne Ready.
- **Affinité de session.** `session_affinity = ClientIP` maintient chaque client sur le même
  pod — important car LangFlow conserve l'état de l'éditeur de flux en cours de
  traitement.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour LangFlow sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langflow` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LangFlow` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image LangFlow ; épingle l'image de base `1.10.2` lorsque `latest`. Épinglez explicitement en production. |
| `langflow_username` | `admin` | Nom d'utilisateur du super-utilisateur initial (administrateur) ; le mot de passe est auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | LangFlow est construit à partir de l'image enveloppée via Cloud Build. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE ne se met pas à l'échelle à zéro. |
| `max_instance_count` | `1` | Gardez à `1` — LangFlow conserve l'état en cours de traitement. |
| `enable_vertical_pod_autoscaling` | `false` | VPA Autopilot pour un dimensionnement correct. |
| `container_port` | `7860` | LangFlow écoute sur le port 7860. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Limites et requêtes CPU/mémoire par pod. Augmenté à partir de `1Gi` après un bug confirmé OOMKilled-during-boot — ne pas dimensionner en dessous de `2Gi`. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base LangFlow dans Artifact Registry avant la build personnalisée. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés sur les valeurs par défaut de LangFlow. Ne définissez pas `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD` ou `LANGFLOW_DATABASE_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager (par exemple, clés API du fournisseur LLM). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` (auto-découvert) | Cluster Autopilot cible (de Services_GCP). |
| `namespace_name` | `""` (auto-généré) | Espace de noms Kubernetes pour la charge de travail. |
| `workload_type` | `null` | Se résout en `StatefulSet`, car `stateful_pvc_enabled` par défaut est `true`. |
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant pour l'état de l'éditeur de flux en cours de traitement. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Garder activé — le PVC à `stateful_pvc_mount_path` (`/data`) est le répertoire de configuration de LangFlow, où résident les fichiers téléchargés. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | _(défini)_ | Dimensionnement et montage du PVC par pod ; le chemin de montage (par défaut `/data`) est également passé comme `LANGFLOW_CONFIG_DIR`. |
| `stateful_headless_service` / `stateful_pod_management_policy` / `stateful_update_strategy` | _(défini)_ | Comportement du StatefulSet (uniquement si activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | _(défini)_ | Quota CPU pour l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(défini)_ | **Doit utiliser des suffixes d'unité binaire** (`4Gi`, `8192Mi`) — les entiers nus sont traités comme des octets. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Activer pour protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | _(défini)_ | Répartir les pods sur les zones/nœuds. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage. Prévoir du temps pour les migrations Alembic au premier démarrage. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé (`enabled = false`, chemin `/`) | Vérification de disponibilité facultative de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (aucun requis par LangFlow). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec LangFlow. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — CI/CD et autorisation binaire {#group-12--cicd--binary-authorization}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; les fichiers téléchargés sont sur le PVC de bloc. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur (lorsque NFS est activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée un bucket `data` dédié. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis (facultatif) {#group-15--redis-cache-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par LangFlow ; câblé pour la compatibilité ascendante uniquement. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Paramètres de connexion Redis (uniquement si activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — LangFlow nécessite PostgreSQL 15. |
| `application_database_name` | `langflowdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langflowuser` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions Postgres facultatives. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données sans interruption. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœuds/pods ; `nfsserver` requis lorsque `enable_nfs = true`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification par identité
> Google pour **toutes** les requêtes entrantes, y compris les appels à l'API
> programmatique de LangFlow.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant LangFlow. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre LangFlow. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de base [App_GKE](App_GKE.md) et une garde `validation.tf` qui vérifie les valeurs *et les combinaisons* au moment de la planification — `min_instance_count > max_instance_count`, Redis activé sans source d'hôte, IAP sans identifiants OAuth, et `enable_cloudsql_volume = true` avec `database_type = "NONE"`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rompt de manière permanente tous les identifiants stockés intégrés dans un flux — ils ne peuvent pas être déchiffrés et doivent être saisis à nouveau. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et identifiants. |
| `database_type` | `POSTGRES_15` | Critique | LangFlow nécessite PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `LANGFLOW_SUPERUSER_PASSWORD` (auto-généré) | Récupérer depuis Secret Manager | Élevé | C'est la connexion administrateur ; la perdre signifie qu'il n'y a aucun moyen de se connecter tant qu'elle n'est pas réinitialisée. |
| `max_instance_count` | `1` | Élevé | LangFlow conserve l'état de session/flux en cours de traitement ; la mise à l'échelle au-delà de 1 divise l'état entre les pods et provoque un comportement incohérent. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes sont acheminées vers différents pods, perturbant l'éditeur de flux en cours de traitement. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; la garde de validation rejette les valeurs supérieures à `max_instance_count`. |
| `enable_cloudsql_volume` | `true` | Élevé | Le proxy d'authentification sidecar est requis pour la connectivité PostgreSQL ; le désactiver avec une vraie base de données rompt toutes les connexions. |
| `container_port` | `7860` | Élevé | LangFlow écoute sur 7860 ; un port non concordant fait échouer toutes les sondes de santé. |
| `enable_iap` | uniquement lorsque l'authentification API n'est pas nécessaire en externe | Élevé | IAP place la connexion Google devant l'ensemble du service, y compris son API programmatique. |
| `container_resources.memory_limit` | ≥ `2Gi` | Élevé | OOMKilled confirmé pendant le démarrage en dessous de 2 GiB — LangFlow charge tous les composants et amorce les projets de démarrage avant que le serveur ne se lie ; `1Gi` a tué le pod juste au moment où il démarrait. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et création d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à LangFlow partagée avec la variante Cloud Run est décrite dans
**[LangFlow_Common](LangFlow_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : LangFlow sur GKE Autopilot](../labs/LangFlow_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LangFlow sur Google Cloud Run](LangFlow_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LangFlow Common — Configuration d'application partagée](LangFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
