---
title: "Apache Superset sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Apache Superset sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Superset_GKE.md @ 1665a43e sha256:e49752f99364 -->

# Apache Superset sur GKE Autopilot {#apache-superset-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Superset_GKE.png" alt="Apache Superset sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Apache Superset est une plateforme open source d'exploration et de visualisation de données
utilisée par des organisations du monde entier. Ce module déploie Superset sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Superset et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle
de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Superset sur RAD, et comment cela se compare {#what-superset-costs-on-rad-and-how-that-compares}

**Le module Superset sur GKE Autopilot de RAD coûte environ 129,18 $ US par mois dans un projet Google Cloud que vous possédez, avec des frais de module uniques de 175 crédits (17,50 $ US, ou 157,5 crédits dans un projet géré par RAD, soit 10 % de moins).** GKE convient à Superset qui doit être placé à côté d'autres charges de travail Kubernetes ou exécuter un pod plus grand en continu ; pour le coût le plus bas, le [module Cloud Run](Superset_CloudRun.md) exécute le même Superset pour environ 83,31 $ US par mois, avec des frais de module inférieurs. Si vous n'avez besoin de Superset qu'occasionnellement — un cycle de reporting, un essai analytique — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **129,18 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **107 crédits par jour**, soit environ 3 210 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **129,18 $ US** |

### Comment cela se compare {#how-it-compares}

- **Preset**, la société d'hébergement géré fondée par le créateur de Superset, facture **20 $/utilisateur/mois facturés annuellement** (ou 25 $/utilisateur/mois mensuellement) sur son plan Professionnel pour un nombre illimité d'utilisateurs et d'espaces de travail, après un niveau Starter gratuit pour un maximum de 5 utilisateurs (source : [preset.io/pricing](https://preset.io/pricing/)). Une équipe de cinq analystes sur Preset Professional coûte 100-125 $/mois avant tout ajout ; le chiffre de RAD pour un projet propre est un coût d'infrastructure fixe qui ne varie pas avec les effectifs.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — moins cher, mais Superset a également besoin d'une base de données gérée, de ses propres sauvegardes et de la surcharge de cluster partagé que vous devriez alors gérer manuellement.
- La licence de Superset est gratuite dans les deux cas — la comparaison ici est entre l'hébergement géré par siège (Preset) et l'infrastructure fixe (RAD), et non le coût du logiciel.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Superset s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de Google pendant 30 jours. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL ou la ressource de calcul un par un : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez créé des tableaux de bord ou enregistré des ensembles de données que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Superset purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Superset resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 4,31 $ US par jour), cela représente environ 5 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (107 crédits par jour). La majeure partie du coût d'exécution ici est la base de données et le pod GKE ; ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Superset alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes sont stockées dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [preset.io/pricing](https://preset.io/pricing/) pour les plans Superset hébergés de Preset.

## 1. Vue d'ensemble {#1-overview}

Superset s'exécute comme une charge de travail web Python/Gunicorn. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Gunicorn, 2 vCPU / 2 Gio par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — stocke les tableaux de bord, les graphiques, les ensembles de données et les paramètres utilisateur |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et requêtes asynchrones | Redis | Désactivé par défaut ; fortement recommandé pour les déploiements multi-utilisateurs en production |
| Secrets | Secret Manager | `SUPERSET_SECRET_KEY` et mot de passe de base de données auto-générés |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Superset l'utilise comme base de données de métadonnées pour tous
  les tableaux de bord, graphiques, ensembles de données et définitions de rôles. MySQL n'est pas pris en charge.
- **`SUPERSET_SECRET_KEY` est auto-généré.** Une clé aléatoire de 50 caractères est générée
  et stockée dans Secret Manager. Elle signe les sessions Flask — sa rotation invalide toutes
  les sessions utilisateur actives. Traitez-la comme immuable après le premier déploiement.
- **L'initialisation en deux phases s'exécute automatiquement.** Un job `db-init` crée la
  base de données et l'utilisateur PostgreSQL ; puis un job `app-init` exécute les migrations de schéma et
  crée l'utilisateur admin. Les deux s'exécutent à chaque déploiement mais sont idempotents.
- **L'affinité de session est `ClientIP`.** Les sessions Flask de Superset bénéficient d'un routage persistant
  afin que les requêtes du même navigateur atteignent le même pod.
- **Redis est désactivé par défaut.** Sans Redis, les workers Celery n'ont pas de broker ;
  l'exécution de requêtes asynchrones et la mise en cache des tableaux de bord ne sont pas disponibles. Activer pour la production.
- La sonde de santé cible **`/health`** — le point de terminaison de disponibilité Gunicorn de Superset.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Superset {#a-gke-autopilot--the-superset-workload}

Les pods Superset sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Superset pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse
  IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Superset stocke toutes les métadonnées (tableaux de bord, graphiques, ensembles de données, utilisateurs, rôles, connexions à la base de données) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods se connectent en privé via le sidecar **Cloud SQL Auth Proxy** via un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données et l'utilisateur de l'application, et le job `app-init` exécute `superset db upgrade` pour appliquer le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
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

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement pour les exportations de données Superset,
les sorties de graphiques et les fichiers de rapport. Le compte de service de la charge de travail
se voit accorder un accès automatique.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Cache Redis et moteur de requêtes asynchrones {#d-redis-cache-and-async-query-engine}

Redis sert de backend de mise en cache pour Superset et de broker Celery. Lorsqu'il est activé, il alimente
l'exécution asynchrone de requêtes SQL, le préchauffage du cache des tableaux de bord et les rapports planifiés. Sans Redis,
toutes les requêtes s'exécutent de manière synchrone et bloquent les workers Gunicorn.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le `SUPERSET_SECRET_KEY` et le mot de passe de la base de données sont stockés en tant que secrets Secret Manager
et injectés dans les pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut
être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Le stdout/stderr des pods est acheminé vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Une vérification de disponibilité optionnelle par rapport à `/health` et des
politiques d'alerte optionnelles sont disponibles (désactivées par défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Superset {#3-superset-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` crée la base de données Superset et
  l'utilisateur de manière idempotente avant le démarrage de l'application. Il s'exécute avec `postgres:15-alpine`
  et arrête le sidecar Cloud SQL Auth Proxy via `quitquitquit` à la fin.
- **Migrations de schéma à chaque déploiement.** Le job `app-init` exécute `superset db upgrade`
  à chaque déploiement, appliquant automatiquement toutes les modifications de schéma Flask-AppBuilder et Superset
  en attente. Ce job crée ou met à jour ensuite l'utilisateur admin avec
  `superset fab create-admin`, et exécute enfin `superset init` pour charger les rôles
  et permissions par défaut.
- **Séquence de démarrage.** Le job `app-init` dépend de la réussite de `db-init`.
  Son délai d'attente de 30 minutes permet des migrations lentes au premier démarrage sur des schémas volumineux
  ou complexes. La sonde de démarrage autorise jusqu'à 180 secondes (60 s de délai initial,
  12 seuils d'échec à des intervalles de 10 s) pour que le pool de workers Gunicorn démarre.
- **Clé secrète Flask.** `SUPERSET_SECRET_KEY` signe les sessions Flask et chiffre
  les identifiants de connexion à la base de données stockés dans les métadonnées de Superset. La modifier après le
  premier déploiement invalide toutes les sessions et rend les identifiants stockés illisibles. La
  clé est auto-générée sous forme de chaîne aléatoire de 50 caractères dans Secret Manager.
- **Requêtes asynchrones et rapports planifiés.** Les workers Celery de Superset utilisent Redis comme
  broker et backend de résultats. Sans Redis, les requêtes asynchrones et les rapports planifiés ne sont
  pas disponibles. Configurez `enable_redis = true` et fournissez `redis_host` pour la production.
- **Chemin de santé.** Les sondes de disponibilité/vivacité ciblent `/health`, qui renvoie HTTP 200
  lorsque le pool de workers Gunicorn est prêt.
- **Connexion administrateur.** Les identifiants administrateur sont définis via les variables d'environnement
  `SUPERSET_ADMIN_USERNAME`, `SUPERSET_ADMIN_EMAIL` et `SUPERSET_ADMIN_PASSWORD`.
  Le mot de passe par défaut est la valeur de `SUPERSET_SECRET_KEY` lorsqu'il n'est pas explicitement défini.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Superset sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `superset` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Apache Superset` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Superset ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par pod ; 2 vCPU / 2 Gio minimum pour Superset. |
| `container_port` | `8088` | Superset/Gunicorn écoute sur le port 8088. |
| `container_image_source` | `custom` | `custom` construit le Dockerfile fourni (requis pour psycopg2) ; `prebuilt` utilise une image existante. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour éviter les retards de démarrage à froid. |
| `max_instance_count` | `5` | Réplicas maximum (plafond de l'autoscaler). |
| `timeout_seconds` | `600` | Délai d'expiration de la requête ; étendu pour les requêtes SQL de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `SUPERSET_SECRET_KEY` est injecté automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour les sessions Flask de Superset. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC dans un StatefulSet. Superset ne nécessite pas de stockage par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC lorsqu'il est activé. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 60 s de délai, 12 échecs | Permet jusqu'à 180 s pour l'initialisation du pool de workers Gunicorn. |
| `health_check_config` | HTTP `/health`, 60 s de délai | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/health` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le pipeline intégré d'initialisation de la base de données en deux phases + initialisation de l'application. |
| `cron_jobs` | `[]` | CronJobs récurrents — utiles pour le préchauffage du cache ou la génération de rapports. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires (par exemple, workers Celery). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume Filestore partagé. Superset ne nécessite pas de NFS — l'état réside dans PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur si NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour Celery et la mise en cache. **Fortement recommandé pour la production.** |
| `redis_host` | `""` | Nom d'hôte ou IP de Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `"6379"` | Port Redis (chaîne dans la variante GKE). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Superset nécessite PostgreSQL. |
| `application_database_name` | `superset_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `superset_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Superset. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la politique. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Superset. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnels). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SUPERSET_SECRET_KEY` (auto-généré) | immuable après le premier déploiement | Critique | La modification de la clé invalide toutes les sessions actives et rend les identifiants de connexion à la base de données stockés dans les métadonnées de Superset définitivement illisibles. |
| `database_type` | `POSTGRES_15` | Critique | Superset nécessite PostgreSQL ; la modification interrompt le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation supprime le sidecar Auth Proxy ; toutes les connexions PostgreSQL échouent. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les tableaux de bord et métadonnées. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_redis` | `true` pour la production | Élevé | Sans Redis, les workers Celery n'ont pas de broker ; les requêtes asynchrones et les rapports planifiés ne sont pas disponibles. |
| `redis_host` | défini explicitement | Élevé | Requis lorsque `enable_redis = true` ; vide, les workers Celery échouent au démarrage. |
| `container_resources.memory_limit` | `2Gi` minimum | Élevé | En dessous de 1 Gio, les workers Gunicorn sont tués par manque de mémoire lors de l'exécution des requêtes. |
| `container_resources.cpu_limit` | `2000m` | Élevé | En dessous de 1000m, le job de migration d'initialisation de l'application peut expirer dans sa fenêtre de 30 minutes. |
| `min_instance_count` | `1` | Élevé | `0` provoque une mise à l'échelle à zéro ; les requêtes asynchrones soumises pendant le démarrage à froid sont perdues. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, l'état de la session Flask est perdu entre les requêtes sur les déploiements multi-réplicas. |
| `startup_probe_config.failure_threshold` | `12` ou plus | Élevé | Une réduction trop importante entraîne la suppression des pods par GKE avant que Superset ne termine les migrations de base de données. |
| `application_version` | épingler à une version spécifique | Moyen | `latest` déclenche des mises à niveau incontrôlées qui peuvent introduire des modifications d'API incompatibles. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans eux, le formulaire de connexion Superset est accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Superset partagée avec la variante Cloud Run est décrite dans
**[Superset_Common](Superset_Common.md)**.

## Guides connexes {#related-guides}

- [Lab pratique : Superset sur GKE Autopilot](../labs/Superset_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Apache Superset sur Google Cloud Run](Superset_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Superset Common — Configuration d'application partagée](Superset_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Kestra sur GKE Autopilot](Kestra_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Analytics Warehouse**.
