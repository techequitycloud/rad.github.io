---
title: "Metabase sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Metabase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Metabase_GKE.md @ e69407af sha256:a56c36b811e7 -->

# Metabase sur GKE Autopilot {#metabase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Metabase_GKE.png" alt="Metabase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Metabase est une plateforme open source de business intelligence et d'analyse qui
permet aux utilisateurs non techniques d'interroger, de visualiser et de partager des
données sans écrire de SQL. Ce module déploie Metabase sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Metabase et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Metabase sur RAD, et comment cela se compare {#what-metabase-costs-on-rad-and-how-that-compares}

**L'exécution de Metabase dans votre propre projet GCP coûte environ 136,37 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits uniques (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~136,37 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~105 crédits/jour, mesuré toutes les heures par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **136,37 $** |

### Comment cela se compare {#how-it-compares}

- Le cloud géré officiel de Metabase (Metabase Cloud) commence à **90 $/mois** (Starter, facturé mensuellement ; 100 $/mois prix catalogue) (source : https://www.metabase.com/pricing), géré par le projet lui-même sans infrastructure à exploiter — la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le propre cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un outil de BI/analyse d'équipe interrogé occasionnellement plutôt que continuellement, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la propre suppression logicielle récupérable de Google de 30 jours. Contrairement à la
suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul
une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google
de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
Update sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
individuellement détruit, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de
module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une
chaîne de déploiement typique de 2-3.

Ce que cela nécessite : vous devez être propriétaire du projet (pas un projet que RAD gère
uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la création d'un
nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier
(100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent).
Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures
suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il
est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors
du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Metabase purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 175 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Metabase devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 4 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://www.metabase.com/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Metabase s'exécute comme une charge de travail web Java/JVM (Jetty). Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods JVM, 2 vCPU / 4 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Metabase stocke tout l'état de l'application (questions, tableaux de bord, utilisateurs) dans PostgreSQL |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré ; aucun mot de passe administrateur n'est géré ici (Metabase gère le sien) |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec un nom d'hôte HTTPS `<ip>.nip.io` sans configuration par défaut (`enable_custom_domain = true`) ; définissez `application_domains` pour un véritable domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge.** Tout l'état de l'application —
  questions, tableaux de bord, collections, utilisateurs — réside dans cette base de données.
- **Aucun Redis n'est requis.** Metabase n'utilise pas Redis pour la mise en cache ;
  `enable_redis` par défaut à `false`.
- **L'affinité de session est `ClientIP`.** Le routage persistant maintient une session de navigateur
  sur un seul pod, évitant la perte de session lors de la mise à l'échelle HPA.
- **Le démarrage de la JVM prend 60 à 120 secondes.** La sonde de démarrage cible `/api/health`
  avec un délai initial de 60 secondes et 18 tentatives, ce qui donne une tolérance totale
  d'environ 240 secondes. `min_instance_count = 1` maintient au moins un pod chaud.
- **`MB_JETTY_PORT = "3000"` et `JAVA_TIMEZONE = "UTC"` sont injectés
  automatiquement** — ne les écrasez pas.
- **Aucun bucket de stockage GCS n'est créé par défaut.** Metabase stocke tout dans
  PostgreSQL. Ajoutez un bucket via `storage_buckets` uniquement si nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Metabase {#a-gke-autopilot--the-metabase-workload}

Les pods Metabase sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres de réplicas minimum et maximum. Comme la JVM prend 60 à 120 secondes pour
s'initialiser, maintenez `min_instance_count = 1` en production pour éviter les délais de démarrage à froid
et les échecs de sonde.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Metabase pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche
  l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Metabase stocke l'intégralité de l'état de son application — questions, tableaux de bord,
collections, utilisateurs, autorisations et paramètres — dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy**
sur un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager et injecté dans les pods
au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration. Metabase gère sa propre
clé de chiffrement interne séparément.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

`enable_custom_domain = true` par défaut, donc App_GKE provisionne un ingress HTTPS basé sur Gateway
prêt à l'emploi. Sans `application_domains` défini, il dérive un nom d'hôte `<ip>.nip.io`
sans configuration à partir de l'adresse IP statique réservée et d'un certificat Google géré
correspondant, de sorte que Metabase obtient HTTPS immédiatement. Définissez
`application_domains` pour servir un véritable domaine personnalisé à la place ; une IP statique est
réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties standard/erreur des pods (y compris les journaux JVM de Metabase) sont acheminées vers Cloud Logging ; les métriques GKE et
Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte
facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Metabase {#3-metabase-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation s'exécute avant la
  charge de travail de l'application, utilisant `postgres:15-alpine` pour se connecter à Cloud SQL
  via le proxy d'authentification et créer de manière idempotente la base de données et
  l'utilisateur de l'application. Il peut être réexécuté en toute sécurité.
- **Pas de migration automatique au démarrage.** Contrairement à d'autres applications, Metabase ne
  n'exécute pas de migrations de schéma à chaque démarrage. Les migrations s'exécutent dans le cadre du
  processus de l'application Metabase au premier démarrage sur une base de données déjà initialisée —
  d'où l'importance que le job `db-init` se termine avec succès en premier.
- **Mise à niveau : attention.** Les migrations Metabase sont unidirectionnelles. La rétrogradation après une
  migration corrompt le schéma. Testez toujours les mises à niveau dans un environnement de staging
  avant de les appliquer en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, qui renvoie
  HTTP 200 uniquement lorsque la JVM est entièrement initialisée et connectée à PostgreSQL.
  La sonde de démarrage utilise un délai initial de 60 secondes avec 18 tentatives (période de 10 s),
  ce qui donne une tolérance totale d'environ 240 secondes. Ne réduisez pas ces valeurs.
- **Configuration administrateur.** Au premier démarrage, Metabase présente un assistant de configuration dans le navigateur.
  Après la configuration, les identifiants administrateur sont gérés à l'intérieur de Metabase lui-même — aucun
  `SECRET_KEY` ou mot de passe administrateur n'est géré par ce module.
- **Sources de données.** Metabase est un outil de BI qui interroge des bases de données externes. Après
  le déploiement, configurez les sources de données dans Metabase Admin → Bases de données. Les sources
  natives GCP courantes incluent BigQuery, Cloud SQL PostgreSQL/MySQL et Google Sheets.
- **`MB_JETTY_PORT` et `JAVA_TIMEZONE` sont fixes.** Ceux-ci sont injectés
  automatiquement par `Metabase_Common`. Les écraser via `environment_variables`
  interrompt le routage ou produit des horodatages de rapport incorrects.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Metabase sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `metabase` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Metabase Analytics` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `v0.51.3` | Tag de version de l'image Metabase ; incrémentez pour déployer une nouvelle version. **Ne jamais rétrograder** — les migrations sont irréversibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites CPU/mémoire. La JVM nécessite au moins 2 GiB ; 4 GiB recommandés pour la production. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour éviter les démarrages à froid de la JVM de 60 à 120 s. |
| `max_instance_count` | `5` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `3000` | Port Jetty de Metabase — doit correspondre à `MB_JETTY_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. Requis. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les demandes de ressources — recommandé pour le dimensionnement de la JVM. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MB_JETTY_PORT` et `JAVA_TIMEZONE` sont injectés automatiquement — ne les écrasez pas. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, mot de passe SMTP). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour maintenir les sessions de navigateur sur un seul pod lors de la mise à l'échelle HPA. |
| `workload_type` | `null` | Résolution automatique ; Metabase est sans état, utilisez donc `"Deployment"`. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM ; permet aux requêtes en cours de se terminer. |

### Groupe 7 — StatefulSet (avancé) {#group-7--statefulset-advanced}

Non recommandé pour Metabase — il est sans état. Voir [App_GKE](App_GKE.md) pour
les mécanismes de StatefulSet si nécessaire.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/health`, délai initial 60s, seuil d'échec 18 | Sonde HTTP ; tolérance totale ~240s pour le démarrage de la JVM. Ne pas réduire. |
| `health_check_config` | `/api/health`, délai initial 120s, seuil d'échec 3 | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (création de base de données PostgreSQL + utilisateur). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés pour toute tâche récurrente. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Le stockage NFS n'est pas requis pour Metabase — tout l'état est dans PostgreSQL. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS lorsque `storage_buckets` n'est pas vide. |
| `storage_buckets` | `[]` | Vide par défaut — Metabase ne nécessite pas de stockage d'objets. Ajoutez des buckets ici uniquement si nécessaire (par exemple, pour le stockage S3 de Metabase Enterprise). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Metabase nécessite PostgreSQL. |
| `application_database_name` | `metabase` | Entrée générique de nom de base de données App_GKE. **Inerte pour ce module** — App_GKE dérive le nom réel de la base de données à partir de la configuration `db_name` du module (voir ci-dessous), pas de cette variable. |
| `application_database_user` | `metabase` | Entrée générique d'utilisateur de base de données App_GKE. **Inerte pour ce module** — voir `db_user` ci-dessous. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `db_name` | `metabase` | Nom de base de données **faisant autorité**, transmis à `Metabase_Common`. Immuable après le premier déploiement — le renommage recrée la base de données et détruit les données. |
| `db_user` | `metabase` | Utilisateur d'application **faisant autorité**, transmis à `Metabase_Common`. Immuable après le premier déploiement. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'ingress HTTPS de la passerelle ; dérive un nom d'hôte `<ip>.nip.io` sans configuration lorsque `application_domains` est vide. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Metabase. Fortement recommandé — la propre connexion de Metabase est autrement accessible publiquement. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode d'exécution à sec. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Metabase. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatifs). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Metabase nécessite PostgreSQL ; tout autre moteur bloque le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation interrompt toutes les connexions à la base de données (sidecar Auth Proxy requis). |
| `container_resources.memory_limit` | `4Gi` | Critique | En dessous de 2 GiB, la JVM plante avec OutOfMemoryError au démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Le **vrai** nom/utilisateur de la base de données contrôle (transmis à `Metabase_Common`) ; immuable après le premier déploiement — le renommage recrée la base de données/l'utilisateur et détruit toutes les données de l'application. `application_database_name`/`application_database_user` sont les entrées génériques App_GKE mais sont masquées/inertes pour ce module (App_GKE dérive le vrai nom de la configuration `db_name` du module), donc les modifier n'a aucun effet. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `application_version` | incrémenter avec prudence | Critique | Les migrations Metabase sont unidirectionnelles ; la rétrogradation corrompt le schéma. Toujours tester les mises à niveau en staging. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `startup_probe_config.failure_threshold` | `18` (≥ 18) | Élevé | La réduction entraîne des arrêts prématurés des pods avant que la JVM ne termine son démarrage. |
| `min_instance_count` | `1` | Élevé | `0` provoque des démarrages à froid de 60 à 120 s ; échecs de sonde à la première requête. |
| `container_resources.cpu_limit` | `2000m` | Élevé | En dessous de 500 m, la compilation JIT de la JVM bloque le démarrage, déclenchant des échecs de sonde. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les déploiements multi-pods perdent l'état de la session du navigateur lors de la mise à l'échelle. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | La page de connexion Metabase est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un seul pod ne peut pas être évincé). |
| `enable_redis` | `false` | Faible | Metabase n'utilise pas Redis ; l'activation n'a aucun effet. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Metabase partagée avec
la variante Cloud Run est décrite dans **[Metabase_Common](Metabase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Metabase sur GKE Autopilot](../labs/Metabase_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Metabase sur Google Cloud Run](Metabase_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Metabase Common — Configuration d'application partagée](Metabase_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Kestra sur GKE Autopilot](Kestra_GKE.md), [Apache Superset sur GKE Autopilot](Superset_GKE.md) dans la solution **Analytics Warehouse**.
