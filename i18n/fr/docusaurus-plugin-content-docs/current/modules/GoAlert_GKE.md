---
title: "GoAlert sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de GoAlert sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GoAlert_GKE.md @ 1665a43e sha256:e97dd3d45d9c -->

# GoAlert sur GKE Autopilot {#goalert-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_GKE.png" alt="GoAlert sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert est une plateforme open-source, sous licence Apache 2.0, de planification
des astreintes et d'escalade des alertes d'incidents, initialement développée
par Target et utilisée en production à grande échelle. Elle permet aux équipes
de définir des politiques d'escalade, des rotations et des plannings d'astreinte,
et d'envoyer des notifications sortantes par e-mail, webhook ou (en option)
Twilio SMS/voix. Ce module déploie GoAlert sur **GKE Autopilot** en s'appuyant
sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par GoAlert et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte GoAlert sur RAD, et comment cela se compare {#what-goalert-costs-on-rad-and-how-that-compares}

**L'exécution de GoAlert dans votre propre projet Google Cloud coûte environ
91,31 $ US/mois en frais Google Cloud, en plus d'un coût unique de 110 crédits
pour le module RAD** (99 crédits — 10 % de moins — dans un projet géré par RAD).
GoAlert est une plateforme open-source de planification des astreintes et
d'escalade des alertes, développée par Target et utilisée en production à grande
échelle. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre
en pause gratuitement et le reprendre plus tard — voir "Mettre en pause
gratuitement" ci-dessous.

*GoAlert est également disponible sur Cloud Run — voir le [guide Cloud Run](GoAlert_CloudRun.md)
pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une seule fois) | **99 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~91,31 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~91 crédits/jour (~9,10 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 0,5 GiB | 34,29 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **91,31 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officiellement hébergée/cloud de GoAlert à
  comparer, donc la comparaison honnête se fait avec une infrastructure
  auto-gérée, et non avec un SaaS concurrent.
- Un VPS nu d'environ 1 vCPU / 0,5 GiB — un Hetzner CPX22 (2 vCPU/4 Go, ~24 $ US/mois),
  un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou le propre Compute Engine
  e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois) — est généralement moins cher
  que le prix affiché par RAD ; un VPS d'une ou deux tailles inférieures serait
  encore moins cher.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de base de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL,
  Secret Manager et la surveillance gérés par RAD le font pour vous, ce qui est
  le véritable compromis, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est
  généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si GoAlert est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le
payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa
facturation, puis demande à Google de supprimer le projet purement et simplement
— la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression du module GoAlert seul, cela ne supprime pas Cloud SQL, aucune VM ou
la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et
rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une
chaîne de déploiement typique de 2 à 3. Les frais de module de 99 crédits ne
sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD
gère uniquement pour la facturation), vous devez le restaurer vous-même dans les
30 jours — après cela, Google le supprime définitivement — et la restauration
est admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services sont de nouveau entièrement fonctionnels
dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé GoAlert et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si GoAlert se trouve dans votre propre projet (ou si plus de 30 jours se sont
écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ
**110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou **99 + ~3–6
crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si GoAlert devait rester
inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à
son propre coût d'exécution : environ **4 jours ou plus** d'inactivité dans
votre propre projet (par rapport à sa facture Google Cloud d'environ 91,31 $
US/mois), ou **environ 2 jours ou plus** d'inactivité dans un projet géré par
RAD (par rapport à ses ~91 crédits/jour).

La majeure partie du coût d'exécution de GoAlert est la base de données et la
VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le
projet ne les utilise, donc la suppression de cette application alors que
quelque chose d'autre partage le projet n'économise que la part de calcul de
cette application sur le total ci-dessus.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant reçoit l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire gère
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ; [documentation de Google sur la
suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

GoAlert s'exécute comme un seul pod binaire Go sur GKE Autopilot. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod binaire Go, 1 vCPU / 512 Mio par défaut, `min_instance_count = 1`, `max_instance_count = 1` |
| Base de données | Cloud SQL pour PostgreSQL (`POSTGRES_17`) | Requis — GoAlert ne prend pas en charge MySQL ou d'autres moteurs ; l'extension `pgcrypto` est installée automatiquement |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré et clé de chiffrement des données ; mot de passe de la base de données géré par la fondation |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut, domaine personnalisé optionnel + certificat géré |

Il n'y a **pas de ligne de stockage d'objets** dans ce tableau — la sortie
`storage_buckets` de `GoAlert_Common` est toujours `[]`. GoAlert n'a pas de
fonctionnalité de téléchargement de fichiers/pièces jointes ; chaque élément
d'état de l'application (politiques d'escalade, plannings, alertes, historique
des notifications, utilisateurs) réside dans PostgreSQL.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES_17"` est fixé par `GoAlert_Common` ;
  la sélection de tout autre moteur interrompt le démarrage.
- **`application_database_name` / `application_database_user` par défaut à `"admin"`, pas `"goalert"`.**
  Cette variante connecte `db_name`/`db_user` dans `GoAlert_Common` à partir
  des variables génériques `application_database_name` / `application_database_user` au niveau App_GKE,
  dont les valeurs par défaut au niveau du module sont `"admin"` —
  incohérentes avec les variables `db_name`/`db_user` de la variante Cloud Run
  (valeur par défaut `"goalert"`). Cosmétique, mais bon à savoir avant de chercher
  dans Cloud SQL une base de données nommée `goalert`.
- **Un seul pod, toujours actif.** `min_instance_count = 1`, `max_instance_count = 1` — GoAlert
  exécute une boucle continue de "moteur" en cours de processus qui évalue le
  timing des politiques d'escalade, l'état de rotation et l'envoi des
  notifications sortantes ; il n'y a pas de concept de mise à l'échelle à zéro
  sur GKE dans ce module, et une seule instance correspond à la propre
  recommandation de GoAlert de ne pas exécuter plusieurs instances de moteur en
  mode par défaut sans une topologie `--api-only` que ce module ne connecte pas.
- **Pas de Redis, pas de stockage d'objets.** L'état de GoAlert réside
  entièrement dans PostgreSQL ; il n'a pas besoin de cache externe, de file
  d'attente ou de stockage de fichiers.
- **`GOALERT_DB_URL` est assemblé au démarrage du conteneur, pas au moment de la
  planification.** GoAlert n'accepte qu'une seule variable d'environnement de
  chaîne de connexion Postgres, et le `DB_PASSWORD` provenant de Secret Manager
  au moment de l'exécution ne peut pas être encodé en URL tant que le conteneur
  n'a pas réellement démarré — `entrypoint.sh` (et chaque script de job
  d'initialisation) le construit à partir des valeurs discrètes `DB_*` que la
  Fondation injecte, en se basant sur le fait que l'hôte résolu est la boucle
  locale du proxy Cloud SQL (`127.0.0.1`, pas de TLS) ou un socket/IP réel.
- **`public_url` est résolu au démarrage lorsqu'il est laissé vide.** Ce module
  transmet `public_url = var.public_url` directement sans aucun mécanisme de secours côté Terraform ;
  lorsqu'il est vide, le point d'entrée définit `GOALERT_PUBLIC_URL` à partir de la valeur
  `GKE_SERVICE_URL` injectée par la plateforme. Cette valeur pilote la validation
  OIDC/CSRF-referer et les URL de clé d'intégration que GoAlert transmet à vos
  systèmes de surveillance, donc ne définissez `public_url` explicitement que
  lorsque les utilisateurs accèdent à GoAlert à une adresse différente (par
  exemple, un domaine personnalisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail GoAlert {#a-gke-autopilot--the-goalert-workload}

GoAlert s'exécute comme un seul pod toujours actif sur Autopilot (`min = max = 1`),
qui facture le CPU/la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail GoAlert pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot et du type de charge de
travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

GoAlert stocke toutes les données de l'application — politiques d'escalade,
plannings, rotations, alertes, historique des notifications et utilisateurs —
dans une instance PostgreSQL Cloud SQL gérée. Les pods y accèdent
privativement via le sidecar **Cloud SQL Auth Proxy** sur une connexion TCP en
boucle locale (`127.0.0.1`) ; `entrypoint.sh` détecte cela et ignore la branche de
socket Unix utilisée sur Cloud Run.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont générés automatiquement par `GoAlert_Common` et stockés dans Secret
Manager : le **mot de passe administrateur** (consommé par le job
d'initialisation `admin-bootstrap`) et une **clé de chiffrement des données**
(recommandée par la documentation GoAlert en amont). Le mot de passe de la base
de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une adresse IP statique peut être réservée afin que
l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et les adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GoAlert {#3-goalert-application-behaviour}

- **La chaîne de jobs d'initialisation en 3 étapes est porteuse de charge.**
  `GoAlert_Common` définit trois Jobs Kubernetes ordonnés, chacun dépendant du
  précédent, tous avec `execute_on_apply = true` :
  1. **`db-init`** (`postgres:15-alpine`) — crée le rôle et la base de données
     PostgreSQL.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`) — exécute `goalert migrate --db-url=...`,
     appliquant le propre schéma de GoAlert. Cela **doit** s'exécuter avant
     `admin-bootstrap` : `goalert add-user` n'a pas de logique de migration propre, et
     sur une base de données fraîche, il échoue avec `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — exécute `goalert add-user --admin`
     directement contre Postgres pour créer la première connexion
     administrateur.

  Sur GKE, `execute_on_apply = false` empêche seulement Terraform d'**attendre** qu'un job
  se termine — le Job/pod Kubernetes sous-jacent est toujours créé et planifié
  immédiatement de toute façon. La correction ici repose sur `depends_on_jobs` (le
  système de dépendance de job à 3 niveaux d'App_GKE), et non sur le
  séquencement au moment de l'application. Les trois scripts réessayent
  également en interne (jusqu'à 10 tentatives, espacées de 5 secondes) pour
  absorber la latence de Cloud SQL/planification.

- **Pas d'assistant de configuration lors de la première visite.** GoAlert n'a
  pas de flux d'administration initial basé sur le web — le job `admin-bootstrap` est
  le seul moyen de créer un compte administrateur. Récupérez le mot de passe
  généré :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Point de terminaison de santé.** `/health` est le point de terminaison
  public, non authentifié et documenté de GoAlert (200 une fois que le cycle de
  vie de l'application quitte l'état "Démarrage"). Les sondes de démarrage et de
  vivacité de ce module utilisent par défaut une vérification de port **TCP**
  plutôt qu'une vérification de chemin HTTP — Kubernetes prend en charge
  `tcpSocket` pour les deux types de sondes (contrairement à Cloud Run, qui
  interdit une sonde de vivacité TCP) — et les deux se sont avérées correctes
  lors de la vérification en direct (HTTP 200 sur `/health` avec de vraies
  lignes de journal "écoute et sert HTTP").

- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
GoAlert sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md)
avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `gke`) de tout `GoAlert_CloudRun` (`cr`) co-déployé pour éviter une collision de noms. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `goalert` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `GoAlert` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image. `"latest"` correspond à un argument de build Dockerfile épinglé (`GOALERT_VERSION = v0.34.1`). |
| `admin_username` | `admin` | Nom d'utilisateur créé par le job d'initialisation `admin-bootstrap`. |
| `admin_email` | `admin@techequity.cloud` | E-mail pour le compte administrateur initial. |
| `public_url` | `""` | Laissé vide, résolu au démarrage à partir de `GKE_SERVICE_URL` injecté par la plateforme. Définir explicitement uniquement si les utilisateurs accèdent à GoAlert à une autre adresse (par exemple, un domaine personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Requêtes et limites CPU/mémoire. |
| `container_port` | `8081` | Port HTTP natif de GoAlert. |
| `min_instance_count` | `1` | Réplicas de pod minimum. |
| `max_instance_count` | `1` | Instance de moteur unique en mode par défaut ; multi-instance nécessite une topologie `--api-only` que ce module ne connecte pas. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base GoAlert dans Artifact Registry. |

### Groupe 9 — Configuration du backend GKE {#group-9--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (résout en `Deployment`) | `"Deployment"` ou `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Affinité de session pour le service Kubernetes. |
| `namespace_name` | `""` (auto-généré) | Espace de noms Kubernetes. |

### Groupe 16/17 — Configuration de la base de données {#group-1617--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Moteur Cloud SQL. GoAlert nécessite PostgreSQL. |
| `application_database_name` | `admin` | Nom de la base de données PostgreSQL — voir la note d'incohérence de nommage dans la vue d'ensemble. |
| `application_database_user` | `admin` | Utilisateur de l'application PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11/12 — Automatisation de la charge de travail {#group-1112--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour la chaîne de 3 jobs par défaut de `GoAlert_Common` (`db-init` → `db-migrate` → `admin-bootstrap`). |
| `cron_jobs` | `[]` | GoAlert n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, 30s de délai, 30 tentatives | Prend en charge la latence de migration au premier démarrage (`db-migrate`). |
| `health_check_config` | TCP, 30s de délai, 3 tentatives | Sonde de vivacité Kubernetes. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Vérification de disponibilité Cloud Monitoring. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis par GoAlert ; présent pour la compatibilité de la plateforme. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés. |
| `reserve_static_ip` | `true` | Réserver une adresse IP statique globale stable pour l'équilibreur de charge — recommandé pour que `public_url` n'ait pas besoin de changer après chaque redéploiement. |

Toute autre entrée (Métadonnées du module, Variables d'environnement et secrets,
Intégration CI/CD et GitHub, SQL personnalisé, Stockage et système de fichiers,
IAP et Cloud Armor, Configuration StatefulSet, Contrôles de service VPC,
Politiques de fiabilité) est héritée de `App_GKE` avec son comportement
standard — voir [App_GKE](App_GKE.md) pour la liste complète, organisée par
groupe.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP intra-cluster / IP externe du LoadBalancer. |
| `service_url` | URL pour atteindre GoAlert. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Toujours `[]` — GoAlert ne provisionne pas de buckets de stockage. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources de la charge de travail sont déployées. `false` lors de la première application d'un nouveau cluster en ligne — une nouvelle exécution complète le déploiement. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs et les combinaisons au moment de la planification. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critique | Tout autre moteur rompt entièrement le schéma et le démarrage de GoAlert — `pgcrypto` et l'ensemble du flux `goalert migrate` sont spécifiques à Postgres. |
| Ordre `initialization_jobs` (`db-init` → `db-migrate` → `admin-bootstrap`) | Laisser `[]` sauf si vous comprenez parfaitement la chaîne de dépendances | Critique | L'exécution de `admin-bootstrap` avant `db-migrate` échoue avec `relation "auth_basic_users" does not exist` sur une base de données fraîche — `goalert add-user` n'a pas de logique de migration propre. Sur GKE, `execute_on_apply=false` NE retarde PAS la planification des pods, seulement l'attente de Terraform — la garantie d'ordre provient entièrement de `depends_on_jobs`. |
| `public_url` | Laisser `""` (résolu au démarrage à partir de `GKE_SERVICE_URL`) ou définir la véritable URL externe | Élevé | Un `GOALERT_PUBLIC_URL` erroné rompt les rappels d'authentification OIDC, chaque lien dans les notifications sortantes et les URL de clé d'intégration vers lesquelles vos systèmes de surveillance publient des alertes. |
| `min_instance_count` | `1` | Élevé | Le moteur de synchronisation d'escalade de GoAlert est une boucle continue en cours de processus — à zéro réplica, les escalades pour les alertes réelles sont entièrement manquées en silence. |
| `application_database_name` / `application_database_user` | Confirmer les valeurs réelles (`admin`/`admin` par défaut, pas `goalert`) | Moyen | La recherche d'une base de données littéralement nommée `goalert` dans Cloud SQL ne la trouvera pas avec les valeurs par défaut de cette variante. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `reserve_static_ip` | `true` | Moyen | Sans adresse IP statique réservée, l'adresse externe du LoadBalancer peut changer lors des redéploiements, rompant tout `public_url` que vous avez configuré. |
| `admin_username` / `admin_email` | Définir une fois, récupérer le mot de passe de Secret Manager | Moyen | GoAlert n'a pas de flux de réinitialisation de mot de passe en libre-service visible depuis Terraform ; perdre la trace des identifiants administrateur amorcés signifie utiliser la CLI `goalert` directement contre la base de données pour en créer un nouveau. |
| `max_instance_count` | `1` sauf si vous connectez une topologie `--api-only` | Moyen | GoAlert prend en charge plusieurs instances de moteur en toute sécurité (pas de bug de double déclenchement selon la documentation en amont), mais ce module n'a pas de mécanisme intégré pour désigner les réplicas `--api-only`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à GoAlert
partagée avec la variante Cloud Run est décrite dans
**[GoAlert_Common](GoAlert_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoAlert sur GKE Autopilot](../labs/GoAlert_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoAlert Common — Configuration d'application partagée](GoAlert_Common.md) — la configuration partagée par les deux cibles de déploiement.
