---
title: "Unleash sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Unleash sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Unleash_GKE.md @ e69407af sha256:34cb3021fabd -->

# Unleash sur GKE Autopilot {#unleash-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Unleash_GKE.png" alt="Unleash sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Unleash est une plateforme open-source, sous licence Apache-2.0, de gestion de
fonctionnalités (feature-flag) et de bascules (toggle) pour la livraison
progressive, les tests A/B et les déploiements progressifs. Ce module déploie
Unleash sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Unleash et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Unleash sur RAD, et comment cela se compare {#what-unleash-costs-on-rad-and-how-that-compares}

**L'exécution d'Unleash sur GKE Autopilot dans votre propre projet Google Cloud
coûte environ 104,74 US$/mois en frais Google Cloud** (environ 177,74 US$ si ce
n'est pas votre seul cluster Autopilot), en plus de frais de module RAD uniques
de 110 crédits (11 US$) — plus élevés que les frais du module Cloud Run car
cette variante exécute également un volume NFS partagé sur GKE. GKE Autopilot
convient à Unleash qui doit rester actif ou s'adapter à travers les pods ; pour
le coût le plus bas, consultez plutôt le [guide Cloud Run](Unleash_CloudRun.md).
Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de
moins) — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 104,74 US$/mois, facturé par Google au prix catalogue | ~92 crédits/jour (environ 2760/mois, 276 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un abonnement mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 Gio | 34,29 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **104,74 US$** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont
partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule,
sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Le cloud hébergé d'Unleash est tarifé par siège : le paiement à l'usage est de
  75 $/siège/mois avec un minimum de 5 sièges (plancher de 375 $/mois) — vérifié
  sur la page de tarification d'Unleash, le 8 octobre 2026. Le coût du projet
  propre de RAD ici (environ 105 $/mois, fixe) reste inférieur à ce plancher.
- Une comparaison avec un VPS autogéré, dimensionné selon la configuration par
  défaut d'Unleash de 1 vCPU / 0,5 Gio : un Hetzner CPX11 ou un DigitalOcean
  1 vCPU/2 Go Droplet coûte environ 6-12 $/mois — plus votre propre temps pour
  les sauvegardes et les correctifs, et sans plan de contrôle Kubernetes à
  exécuter.
- La majeure partie du coût de ce module, au-delà de la variante Cloud Run,
  provient du pod GKE et du volume NFS ; le [module Cloud Run](Unleash_CloudRun.md)
  n'a besoin ni de l'un ni de l'autre et est le choix par défaut le moins cher
  pour Unleash.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le
projet — une suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression d'un module, cela ne supprime **pas** Cloud SQL, aucune VM, ni
la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3
déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services sont de nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé Unleash et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources définitivement, et ramener Unleash signifie redéployer à partir de
zéro. Cela coûte environ 113-116 crédits dans votre propre projet, ou environ
102-105 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Unleash devait rester
inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à
son propre coût d'exécution — environ 3 jours ou plus dans votre propre projet
(environ 3,49 US$ par jour), ou environ 1 jour ou plus dans un projet géré par
RAD (92 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes sont stockées dans un
bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc
copiez la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, de sorte que personne
ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et
les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ; [tarification Unleash](https://www.getunleash.io/pricing).

## 1. Vue d'ensemble {#1-overview}

Unleash fonctionne comme une charge de travail web Node.js. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 512 Mio par défaut, auto-scalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — Unleash ne prend pas en charge MySQL ou d'autres moteurs |
| Secrets | Secret Manager | Jeton d'API administrateur bootstrap auto-généré (`INIT_ADMIN_API_TOKENS`) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur empêche
  le démarrage.
- **Unleash est sans état.** Toutes les données de drapeaux, de bascules, de
  stratégies, de segments et d'audit résident dans PostgreSQL, de sorte que
  `workload_type = Deployment`, `session_affinity = None`, et tout pod peuvent
  servir n'importe quelle requête. NFS et le stockage d'objets sont désactivés.
- **Pas de backend Redis ou de file d'attente.** Unleash n'a pas besoin de
  cache ou de file d'attente ; il s'adapte horizontalement en pointant plus de
  pods vers la même base de données.
- **`INIT_ADMIN_API_TOKENS` est généré automatiquement** et stocké dans Secret Manager,
  matérialisé dans l'espace de noms via le pilote CSI Secret Store. Unleash
  injecte ce jeton d'API administrateur à accès complet (`*:*`) dans sa base de
  données au premier démarrage.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1` ; GKE ne prend pas en charge
  la mise à l'échelle à zéro) afin que l'API Unleash reste accessible aux
  clients SDK.
- **`DATABASE_URL` est assemblé au démarrage du pod** à partir des variables `DB_*`
  injectées par la plateforme. Sur GKE, le sidecar cloud-sql-proxy écoute sur
  `127.0.0.1` avec TLS déjà terminé, de sorte que le point d'entrée utilise le chemin
  de bouclage (SSL désactivé vers le bouclage).
- **Le point de terminaison de santé est `/health`** — un point de terminaison
  public, non authentifié, qui renvoie 200. L'API d'administration sous `/api/admin/*`
  nécessite un jeton.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION`, et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Unleash {#a-gke-autopilot--the-unleash-workload}

Les pods Unleash sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Unleash pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Unleash stocke toutes les données d'application (projets, drapeaux de
fonctionnalités, stratégies, segments, jetons d'API, utilisateurs et journal de
modifications/audit) dans une instance gérée de Cloud SQL pour PostgreSQL 15.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** ; aucune
adresse IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application, et
Unleash applique ses propres migrations de schéma au démarrage.

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
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Un jeton d'API administrateur bootstrap est généré automatiquement et stocké
dans Secret Manager, matérialisé dans l'espace de noms sous le nom `INIT_ADMIN_API_TOKENS` via le
pilote CSI Secret Store. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Unleash {#3-unleash-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh`
  en utilisant `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de
  manière idempotente la base de données et l'utilisateur de l'application, et
  accorde les privilèges. Le job peut être réexécuté en toute sécurité ; il ne
  crée **pas** de tables.
- **Migrations de schéma au démarrage.** Unleash applique ses propres
  migrations de schéma automatiquement à chaque démarrage, de sorte que la mise
  à niveau de la version de l'application applique les modifications de schéma
  sans étape de migration distincte.
- **`DATABASE_URL` est composé à l'exécution.** Le point d'entrée de l'image
  personnalisée assemble la chaîne de connexion à partir des variables `DB_*`
  injectées et utilise le chemin de bouclage cloud-sql-proxy sur GKE.
  Inspectez les variables injectées lors du débogage :
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
  kubectl get pod "$POD" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep -iE 'DB_|DATABASE'
  ```
- **Jeton d'API administrateur bootstrap.** `INIT_ADMIN_API_TOKENS` injecte un jeton d'API
  administrateur à accès complet (`*:*`) au premier démarrage afin que CI,
  l'interface CLI Unleash et les backends SDK puissent appeler l'API
  d'administration sans connexion à l'interface utilisateur.
- **Identifiants d'interface utilisateur par défaut.** L'interface
  d'administration fournit un compte de première exécution bien connu —
  `admin` / `unleash4all`. Changez le mot de passe immédiatement après la première
  connexion.
- **Accessibilité du webhook / SDK.** Le `service_type = LoadBalancer` par défaut expose une adresse IP
  externe pour les clients SDK et CI. Définissez un domaine personnalisé via
  `application_domains` et réservez une adresse IP statique afin que l'adresse survive aux
  redéploiements.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` —
  un point de terminaison public, non authentifié, qui répond 200 uniquement
  lorsque le serveur est initialisé et connecté à PostgreSQL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Unleash sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `unleash` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Unleash` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `5.7.0` | Tag d'image `unleashorg/unleash-server` ; `latest` est remappé sur un tag épinglé au moment du build. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Cloud Build enveloppe `unleashorg/unleash-server` avec le point d'entrée DATABASE_URL. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod ; empreinte légère d'Unleash. |
| `container_port` | `4242` | Unleash écoute sur le port 4242. |
| `min_instance_count` | `1` | HPA minReplicas ; maintenir ≥ 1 (GKE n'a pas de mise à l'échelle à zéro). |
| `max_instance_count` | `10` | HPA maxReplicas. |
| `workload_type` | `Deployment` | Sans état — pas de StatefulSet nécessaire. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `DATABASE_URL` est assemblé à l'exécution — ne le définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `None` | Sans état — tout pod sert toute requête ; aucune persistance n'est nécessaire. |
| `namespace_name` | `""` | Laisser vide pour une génération automatique. |
| `network_tags` | `[]` | Tags réseau de nœud/pod pour les règles de pare-feu. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé pour Unleash (sans état). `stateful_pvc_enabled` par défaut `null` ; laissez les
entrées StatefulSet à leurs valeurs par défaut.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des suffixes binaires** (`4Gi`, `8192Mi`) — les entiers nus sont des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 30s de délai, 30 tentatives | Sonde de démarrage. Marge pour les migrations au premier démarrage. |
| `health_check_config` | HTTP `/health`, 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Unleash. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — Unleash est sans état. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur (non utilisé par défaut). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires. |
| `storage_buckets` | `[]` | Vide — Unleash est sans état. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Unleash nécessite PostgreSQL ; `Unleash_Common` provisionne PostgreSQL 15. |
| `application_database_name` | `unleash` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `unleash` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods en rolling-restart. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** L'activation d'IAP nécessite une authentification par
> identité Google pour **toutes** les requêtes entrantes, y compris les appels
> d'API Unleash authentifiés par jeton SDK et CI. N'activez IAP que lorsque
> l'API n'a pas besoin d'être directement accessible par les clients SDK.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Unleash. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoire lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (découvre automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Niveaux d'accès CIDR / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées en cas de déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Unleash. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Unleash). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD et dépôt connecté. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `deployment_id` / `project_id` | Identifiants de nommage et de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1`
> avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension
> activée, un `backup_retention_days` hors de portée. Une configuration invalide échoue la
> **planification** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en
> amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` (→ PostgreSQL 15) | Critique | Tout autre moteur empêche le démarrage d'Unleash — il ne prend en charge que PostgreSQL. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de drapeaux. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_file` valide échoue le job d'importation. |
| `startup_probe_config` / `health_check_config` chemin | `/health` | Élevé | Pointer une sonde vers `/api/admin/*` renvoie 401/403 et le pod ne devient jamais prêt. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. Maintenir 1 maintient l'API accessible. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment de la planification. |
| `session_affinity` | `None` | Faible | Unleash est sans état ; la persistance est inutile et n'ajoute aucune valeur. |
| `enable_iap` | uniquement en l'absence de trafic SDK | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les appels SDK/CI authentifiés par jeton vers l'API Unleash. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| Connexion UI par défaut `admin` / `unleash4all` | Changer à la première connexion | Élevé | Laisser le mot de passe par défaut expose le contrôle administratif complet de chaque drapeau. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Unleash
partagée avec la variante Cloud Run est décrite dans
**[Unleash_Common](Unleash_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Unleash sur GKE Autopilot](../labs/Unleash_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Unleash sur Google Cloud Run](Unleash_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Unleash Common — Configuration d'application partagée](Unleash_Common.md) — la configuration partagée par les deux cibles de déploiement.
