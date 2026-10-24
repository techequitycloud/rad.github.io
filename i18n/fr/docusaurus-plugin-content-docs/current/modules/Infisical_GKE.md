---
title: "Infisical sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Infisical sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Infisical_GKE.md @ e69407af sha256:33dcf5a91444 -->

# Infisical sur GKE Autopilot {#infisical-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Infisical_GKE.png" alt="Infisical sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Infisical est une plateforme open source de gestion de secrets chiffrés de bout
en bout : les équipes et les pipelines CI/CD stockent, injectent et font
tourner les secrets d'application à partir d'une plateforme unique, en utilisant
des SDK clients, une CLI ou l'interface web. Ce module déploie Infisical sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Infisical utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Infisical sur RAD, et comment cela se compare {#what-infisical-costs-on-rad-and-how-that-compares}

**Infisical sur le module GKE de RAD coûte environ 143 US$ par mois dans votre propre projet, plus des frais de module de 175 crédits (18 US$) une fois par déploiement.** Si vous n'en avez besoin que pour une période limitée, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre vos secrets. Infisical est également disponible en tant que module Cloud Run, qui est l'option la moins chère ici (environ 84 US$/mois) — consultez le guide Cloud Run, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 US$) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **142,62 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **108 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 142,62 US$** |

### Comment cela se compare {#how-it-compares}

- L'offre hébergée d'Infisical, **Infisical Cloud**, commence à **23 $/mois** sur le plan Pro (20 $ par identité machine/humaine par mois, facturé annuellement) et **46 $/mois** sur le plan Advanced — un prix qui évolue en fonction du nombre d'identités qui l'utilisent, et non de l'infrastructure sous-jacente ([infisical.com/pricing](https://infisical.com/pricing), 8 octobre 2026).
- Le coût d'exécution du propre projet de RAD ici (environ 84 $/mois) est un coût d'infrastructure fixe quelle que soit la taille de l'équipe, il dépasse donc rapidement le plan d'entrée d'Infisical Cloud mais reste fixe à mesure que de plus en plus de services et de personnes commencent à en lire les secrets — la forme opposée à une facture SaaS par identité.
- Un VPS nu (Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go, environ 24 $/mois ; un GCP Compute Engine e2-standard-2 environ 49 $/mois) est moins cher en espèces, mais vous devez alors gérer vous-même PostgreSQL, le partage NFS, les sauvegardes, les correctifs de sécurité et les propres mises à jour d'Infisical — exactement le type de magasin de justificatifs où une base de données non corrigée est le pire endroit pour faire des économies.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Infisical s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'Infisical en tant que module unique, cela ne détruit pas le service Cloud Run/GKE, la base de données Cloud SQL, le serveur de fichiers NFS et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne des secrets et de la configuration d'Infisical est conservée dans ce bucket, alors copiez-la d'abord si vous voulez un instantané restaurable au-delà des 30 jours du projet.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli est de supprimer Infisical purement et simplement et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Infisical resterait autrement inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 2 jours ou plus dans un projet géré par RAD). La base de données et le serveur de fichiers NFS représentent la majeure partie du coût d'exécution ici, donc la suppression d'Infisical seul permet d'économiser la totalité de la facture ci-dessus, à moins que quelque chose d'autre dans le projet ne les partage.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration ; [Tarification Infisical](https://infisical.com/pricing) pour la comparaison avec Infisical Cloud hébergé. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Infisical s'exécute en tant que pod Node.js (une image personnalisée enveloppant
l'image officielle `infisical/infisical`) en tant que `Deployment` sans état. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js personnalisés, 2 vCPU / 2 Gio par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Infisical ne prend pas en charge MySQL ou d'autres moteurs |
| Cache et limitation de débit | Redis (facultatif, activé par défaut) | Redis hébergé sur NFS par défaut, ou un Redis externe authentifié via `redis_auth` |
| Secrets | Secret Manager | `ENCRYPTION_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service `LoadBalancer` externe par défaut, avec une IP statique réservée |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15` et est
  la seule valeur prise en charge par Infisical.
- **L'image du conteneur est construite sur mesure, pas l'image amont.** `Infisical_Common`
  construit `FROM infisical/infisical:${INFISICAL_VERSION}` avec un wrapper `entrypoint.sh`
  qui assemble la chaîne de connexion à la base de données au démarrage du conteneur.
  `application_version = "latest"` correspond à une version épinglée et validée
  (`v0.162.10`) comme argument de build.
- **Redis est activé par défaut, et son câblage est mutuellement exclusif par construction.** Lorsque
  `redis_auth` est vide (par défaut), l'injection plain-env de Redis hébergé sur NFS de la Fondation
  fournit `REDIS_HOST`/`REDIS_PORT`. Lorsque `redis_auth` est défini,
  `Infisical_Common` crée et injecte à la place son propre secret `REDIS_URL`.
- **`site_url` ne se calcule pas automatiquement sur GKE.** Contrairement à la variante Cloud Run, ce
  module transmet `site_url` directement sans calcul d'URL prédite.
  Le laisser vide signifie que le `SITE_URL` de l'application revient à
  `http://localhost:8080` ; le job `admin-bootstrap` n'est pas affecté — son script
  résout le `GKE_SERVICE_URL` injecté par la Fondation lorsque `INFISICAL_API_URL` est
  vide. Voir [§3](#3-infisical-application-behaviour).
- **Les sondes de santé ciblent HTTP `/api/status`,** contrairement à la sonde de démarrage
  TCP uniquement de la variante Cloud Run. Autorisez un généreux `initial_delay_seconds`/
  `failure_threshold` au premier démarrage — ce point de terminaison ne renvoie 2xx que lorsque les
  connexions à la base de données (et à Redis, si activé) sont saines.
- **Aucun stockage d'objets n'est monté.** Un bucket GCS générique `data` est provisionné via
  la variable `storage_buckets` de la Fondation, mais `gcs_volumes` est vide par
  défaut — Infisical conserve tout l'état persistant dans PostgreSQL.
- **`postgres_extensions` est vestigial pour cette application.** La variable par défaut est
  `["vector", "uuid-ossp"]` (un vestige du modèle d'origine du module) mais n'est
  jamais transmise à `App_GKE` — `Infisical_Common` code en dur
  `enable_postgres_extensions = false`. Infisical n'utilise pas pgvector.
- **Le compte administrateur est amorcé sans interface graphique, pas via l'interface web.** Un
  job d'initialisation `admin-bootstrap` exécute la commande `infisical` CLI `bootstrap` contre
  le serveur en cours d'exécution. Sur GKE, le pod du job est planifié immédiatement et réessaie
  jusqu'à ce que le serveur réponde — voir [§3](#3-infisical-application-behaviour).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Infisical {#a-gke-autopilot--the-infisical-workload}

Les pods Infisical sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le
nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Infisical pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Infisical stocke toutes les données d'application (secrets, projets, organisations, utilisateurs,
journaux d'audit) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** en boucle locale
(`enable_cloudsql_volume = true` par défaut). Lors du premier déploiement, le job d'initialisation `db-init`
crée la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe.

### C. Redis (cache et limitation de débit) {#c-redis-cache--rate-limiting}

Redis est **activé par défaut** (`enable_redis = true`). Lorsque `redis_host` est laissé
vide, l'IP de la VM du serveur NFS est utilisée comme hôte Redis par défaut. Lorsque `redis_auth`
est défini, `Infisical_Common` provisionne son propre secret Secret Manager `REDIS_URL`
au lieu de s'appuyer sur l'injection plain-env de la Fondation.

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm which Redis path is active in the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `ENCRYPTION_KEY` (chiffre chaque secret stocké par Infisical),
`AUTH_SECRET` (signe les jetons de session JWT) et `ADMIN_PASSWORD` (consommé uniquement
par le job `admin-bootstrap`, jamais injecté dans le pod en cours d'exécution). Un
secret `REDIS_URL` est créé de manière conditionnelle. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~infisical"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true`), de sorte que l'adresse
survit aux redéploiements. Un domaine personnalisé avec un certificat géré par Google peut être
activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Infisical {#3-infisical-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job d'initialisation `db-init` exécute
  `postgres:15-alpine`, se connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente
  le rôle et la base de données de l'application. `execute_on_apply = true`, donc cela
  s'exécute à chaque apply et peut être réexécuté en toute sécurité.
- **La chaîne de connexion à la base de données est assemblée au démarrage du conteneur.** Infisical
  accepte un seul `DB_CONNECTION_URI` ; `entrypoint.sh` encode en URL `DB_PASSWORD`
  et construit l'URI à partir des valeurs discrètes `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/
  `DB_NAME` que la Fondation injecte, en branchant `sslmode` sur la forme de `DB_HOST`
  (la boucle locale `127.0.0.1` du sidecar du proxy d'authentification Cloud SQL GKE → `disable`).
- **Le compte administrateur est amorcé sans interface graphique, et réessaie jusqu'à ce que le serveur soit
  accessible.** Le job d'initialisation `admin-bootstrap` (image `infisical/cli:latest`,
  dépend de `db-init`) exécute `infisical bootstrap --ignore-if-bootstrapped`
  contre `INFISICAL_API_URL` (défini à partir de `site_url`). Sur GKE,
  `execute_on_apply = false` ne fait que *attendre* le job par Terraform — le pod du job est
  toujours planifié et s'exécute immédiatement, réessayant jusqu'à 20 fois (à 15s d'intervalle).
  **Si `site_url` est défini, il doit résoudre le service réellement accessible.** Lorsque
  il est laissé vide, `admin-bootstrap.sh` revient au `GKE_SERVICE_URL` injecté par la Fondation,
  et seulement ensuite à `http://localhost:8080` si celui-ci est également non défini.
  Pour épingler explicitement la cible, définissez `site_url` sur l'IP externe du LoadBalancer
  ou le domaine personnalisé (connu après que le Service a une IP externe) et réappliquez :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  # set site_url = "https://<that-ip-or-domain>" and re-apply
  ```
- **Le mot de passe administrateur ne se trouve que dans Secret Manager.** Récupérez le
  identifiant amorcé avec :
  ```bash
  gcloud secrets versions access latest --secret=<prefix>-infisical-admin-password --project "$PROJECT"
  ```
- **Point de terminaison de santé.** `/api/status` renvoie HTTP 200 avec un corps JSON une fois
  qu'Infisical, sa connexion à la base de données et (si activé) Redis sont tous sains. Les
  sondes de démarrage et de vivacité ciblent ce chemin directement sur GKE (contrairement à la sonde
  TCP uniquement de la variante Cloud Run) — autorisez le délai/seuil généreux par défaut au
  premier démarrage pendant l'exécution des migrations.
- **Redis est facultatif mais activé par défaut.** Définissez `enable_redis = false` uniquement si aucun
  backend de mise en cache/limitation de débit n'est souhaité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Infisical sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `infisical` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Infisical` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image. `"latest"` correspond à un argument de build épinglé (`v0.162.10`). |
| `site_url` | `""` | URL publique pour `SITE_URL` et la cible CLI `admin-bootstrap`. **Transmise telle quelle — pas de prédiction automatique d'URL sur GKE.** Voir [§3](#3-infisical-application-behaviour). |
| `admin_email` | `admin@techequity.cloud` | E-mail pour le premier compte super-administrateur amorcé. |
| `admin_organization` | `Default Organization` | Nom de l'organisation créée pour le compte amorcé. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `container_port` | `8080` | Port sur lequel Infisical écoute. |
| `min_instance_count` | `0` | Réplicas minimum (HPA `minReplicas`). |
| `max_instance_count` | `3` | Réplicas maximum (HPA `maxReplicas`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Infisical Core sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | divers | **Déclaré mais non transmis à `Infisical_Common` — inerte, sans effet sur le déploiement.** |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Laisser vide pour générer automatiquement. |
| `workload_type` | `Deployment` | Fixé à `Deployment` au site d'appel de la Fondation `main.tf` — Infisical ne conserve aucun état qui survive à un redémarrage de pod. |
| `service_type` | `LoadBalancer` | Accès externe par défaut. |
| `session_affinity` | `ClientIP` | Valeur par défaut de la Fondation ; l'authentification d'Infisical est basée sur JWT, ce n'est donc pas une exigence stricte. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status` | Transmis à `Infisical_Common`. Renvoie 200 une fois que les connexions à la base de données (et à Redis, si activé) sont saines. |
| `liveness_probe` | HTTP `/api/status`, délai initial de 60s | Transmis à `Infisical_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité facultative de Cloud Monitoring — envisagez de pointer `path` vers `/api/status`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Pertinent ici uniquement comme source par défaut de l'IP de l'hôte Redis lorsque `redis_host` est vide. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket par défaut au niveau de la Fondation — **provisionné mais jamais monté**. |
| `gcs_volumes` | `[]` | Vide par défaut et inutilisé par Infisical. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis pour la mise en cache et la limitation de débit. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Lorsqu'il est défini, bascule Infisical vers le secret `Infisical_Common` `REDIS_URL`. |
| `cubejs_api_url` / `hub_api_url` | URL localhost | **Déclaré mais non transmis à `Infisical_Common` — inerte, sans effet.** |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Infisical nécessite PostgreSQL. |
| `db_name` | `infisical` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | `infisical` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `postgres_extensions` / `enable_postgres_extensions` | `["vector","uuid-ossp"]` / `true` | **Vestigial — non transmis à `App_GKE`.** `Infisical_Common` code en dur `enable_postgres_extensions = false`. Infisical n'utilise pas pgvector. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle pour les noms d'hôte personnalisés + SSL. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements — important car `site_url` doit référencer une adresse durable pour `admin-bootstrap` et les liens OAuth/e-mail. |

Tous les groupes restants (Sauvegarde et maintenance, CI/CD, SQL personnalisé, IAP, Cloud Armor,
StatefulSet, Politiques de fiabilité, VPC Service Controls) se comportent exactement comme
documenté dans [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP intra-cluster / IP externe du LoadBalancer. |
| `service_url` | URL pour atteindre Infisical. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` inutilisé). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` | Si la surveillance est configurée. |
| `initialization_jobs` | Noms des jobs `db-init` et `admin-bootstrap`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `artifact_registry_repository` | État et registre CI/CD. |
| `kubernetes_ready` | Si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `audit_logging_enabled` | Posture de sécurité. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs et les combinaisons au moment de la planification. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `ENCRYPTION_KEY` (auto-généré) | Ne jamais faire tourner après le premier démarrage | Critique | Le faire tourner rend chaque secret précédemment stocké indéchiffrable de manière permanente. |
| `AUTH_SECRET` (auto-généré) | Ne faire tourner que pendant une fenêtre de maintenance | Critique | Le faire tourner invalide toutes les sessions utilisateur actives. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_redis` | Transmettre `var.enable_redis` inconditionnellement à `App_GKE` | Critique | Le coder en dur à `false` lors de l'appel de la Fondation laisse `REDIS_URL` complètement non défini dans le cas courant sans authentification — Infisical plante au démarrage. |
| `database_type` | `POSTGRES_15` | Critique | MySQL n'est pas pris en charge ; toute valeur non-Postgres rompt complètement la connexion. |
| `site_url` | Définir après le premier déploiement, une fois que l'IP/le domaine du LoadBalancer est connu | Élevé | Laissé vide, le `SITE_URL` de l'application reste `http://localhost:8080`, ce qui rompt les liens d'invitation/e-mail et CORS (`admin-bootstrap` lui-même résout toujours `GKE_SERVICE_URL`). Défini sur un hôte qui n'est pas réellement accessible et le job d'amorçage échoue également à chaque tentative — aucun compte administrateur n'est jamais créé. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `postgres_extensions` / `enable_postgres_extensions` | N/A | Faible | Déclaré mais non transmis à `App_GKE` — les définir n'a aucun effet ; Infisical n'a pas besoin de pgvector. |
| `smtp_host` / `smtp_user` / `smtp_password` / `mail_from` / `cubejs_api_url` / `hub_api_url` | N/A | Faible | Déclaré pour la parité de mise en miroir des conventions mais jamais transmis à `Infisical_Common` — les définir n'a aucun effet. |
| `reserve_static_ip` | `true` (par défaut) | Moyen | Sans IP stable, `service_url`/`site_url` peut référencer une adresse obsolète lors des redéploiements. |
| `memory_limit` | `2Gi` (par défaut) ou plus élevé | Moyen | Des valeurs inférieures risquent un OOM sous une charge de récupération de secrets concurrente. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Infisical
partagée avec la variante Cloud Run est décrite dans
**[Infisical_Common](Infisical_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Infisical sur GKE Autopilot](../labs/Infisical_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Infisical sur Google Cloud Run](Infisical_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Infisical Common — Configuration d'application partagée](Infisical_Common.md) — la configuration partagée par les deux cibles de déploiement.
