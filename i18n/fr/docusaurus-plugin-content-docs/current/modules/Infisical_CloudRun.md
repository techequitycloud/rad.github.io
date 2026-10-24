---
title: "Infisical sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Infisical sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Infisical_CloudRun.md @ e69407af sha256:32c60ce31c17 -->

# Infisical sur Google Cloud Run {#infisical-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Infisical_CloudRun.png" alt="Infisical sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Infisical est une plateforme open source de gestion de secrets chiffrés de bout
en bout : les équipes et les pipelines CI/CD stockent, injectent et font
tourner les secrets d'application à partir d'une plateforme unique, en utilisant
des SDK clients, une CLI ou l'interface utilisateur web. Ce module déploie
Infisical sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud qu'Infisical utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Infisical sur RAD, et comment cela se compare {#what-infisical-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'Infisical sur RAD coûte environ 84 US$ par mois dans
votre propre projet, plus des frais de module de 110 crédits (11 US$) une fois
par déploiement.** Si vous n'en avez besoin que pour une période limitée,
consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter
de payer sans perdre vos secrets. Infisical est également disponible en tant que
module GKE, qui coûte plus cher ici (environ 143 US$/mois) car son pod est plus
grand et le cluster ajoute ses propres frais de gestion — Cloud Run est le
choix le moins cher, sauf si vous utilisez déjà GKE Autopilot pour d'autres
applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 US$) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **83,61 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins pour un plan. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par chaque application du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 GB, zonal, 10 GB SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 83,61 US$** |

### Comment cela se compare {#how-it-compares}

- L'offre hébergée d'Infisical, **Infisical Cloud**, commence à **23 $/mois**
  sur le plan Pro (20 $ par identité machine/humaine par mois, facturé
  annuellement) et **46 $/mois** sur le plan Advanced — un prix qui évolue en
  fonction du nombre d'identités qui l'utilisent, et non de l'infrastructure
  sous-jacente ([infisical.com/pricing](https://infisical.com/pricing), 8
  octobre 2026).
- Le coût d'exécution du projet propre à RAD ici (environ 84 $/mois) est un
  coût d'infrastructure fixe, quelle que soit la taille de l'équipe. Il
  dépasse donc rapidement le plan d'entrée d'Infisical Cloud, mais reste fixe
  à mesure que de plus en plus de services et de personnes commencent à lire
  des secrets, ce qui est l'inverse d'une facture SaaS par identité.
- Un VPS nu (Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go, environ 24 $/mois ; un
  GCP Compute Engine e2-standard-2 environ 49 $/mois) est moins cher en
  espèces, mais vous devez alors gérer vous-même PostgreSQL, le partage NFS,
  les sauvegardes, les correctifs de sécurité et les mises à niveau
  d'Infisical — exactement le type de magasin de justificatifs où une base de
  données non corrigée est le pire endroit pour faire des économies.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Infisical s'exécute dans un projet géré par RAD pour vous et que vous
prévoyez d'y revenir — une pause entre les cours, une accalmie saisonnière, ou
simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la
meilleure option, et elle ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD commence par dissocier sa facturation,
puis demande à Google de supprimer le projet purement et simplement : la
suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'Infisical en tant que module unique, cela ne démantèle pas le
service Cloud Run/GKE, la base de données Cloud SQL, le serveur de fichiers NFS
et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien
n'est facturé pendant qu'il attend, car la facturation est déjà dissociée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox que la plupart utilisent conviennent). Google affirme que la
plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures
suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet, même si le projet lui-même est récupérable
pendant 30 jours. L'exportation nocturne des secrets et de la configuration
d'Infisical est conservée dans ce bucket, alors copiez-la d'abord si vous
souhaitez un instantané restaurable au-delà des 30 jours du projet.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est
passée, la solution de repli consiste à supprimer Infisical purement et
simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les
  builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits
  de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de
  l'argent que si Infisical devait rester inutilisé pendant environ 4 jours ou
  plus dans votre propre projet (environ 3 jours ou plus dans un projet géré
  par RAD). La base de données et le serveur de fichiers NFS représentent la
  majeure partie du coût d'exécution ici, donc la suppression d'Infisical
  seule permet d'économiser la totalité de la facture ci-dessus, à moins que
  quelque chose d'autre dans le projet ne les partage.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec
  lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que
  vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  autorisation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la
  propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF,
  XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud :
supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration ; [Tarification
Infisical](https://infisical.com/pricing) pour la comparaison avec Infisical
Cloud hébergé. Les prix changent ; vérifiez chaque source avant de vous fier à
un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Infisical s'exécute en tant que conteneur Node.js (une image personnalisée
enveloppant l'image officielle `infisical/infisical`) sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js personnalisé, 1 vCPU / 2 Gi par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Infisical ne prend pas en charge MySQL ou d'autres moteurs |
| Cache et limitation de débit | Redis (facultatif, activé par défaut) | Redis hébergé sur NFS par défaut, ou un Redis externe authentifié via `redis_auth` |
| Secrets | Secret Manager | `ENCRYPTION_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` est par défaut `POSTGRES_15` et
  est la seule valeur prise en charge par Infisical.
- **L'image du conteneur est personnalisée, pas l'image amont.** `Infisical_Common`
  construit `FROM infisical/infisical:${INFISICAL_VERSION}` avec un wrapper `entrypoint.sh` qui assemble la chaîne de
  connexion à la base de données au démarrage du conteneur (la valeur
  `DB_PASSWORD` Secret Manager d'exécution ne peut pas être encodée en URL au
  moment de la planification Terraform). `application_version = "latest"` correspond à une version
  épinglée connue et stable (`v0.162.10`) comme argument de build,
  conformément à la convention de ce catalogue contre la construction d'images
  de base `latest`.
- **Redis est activé par défaut, et son câblage est mutuellement exclusif par
  construction.** Lorsque `redis_auth` est vide (par défaut), l'injection
  d'environnement simple Redis hébergé sur NFS de la Fondation fournit
  `REDIS_HOST`/`REDIS_PORT`. Lorsque `redis_auth` est défini, `Infisical_Common`
  crée et injecte son propre secret `REDIS_URL` à la place. Seul un chemin
  est toujours actif.
- **La sonde de démarrage est TCP, pas HTTP.** Infisical expose un point de
  terminaison `/api/status` non authentifié qui renvoie 200 avec du JSON
  lorsqu'il est sain — mais seulement une fois que l'application signale une
  disponibilité *complète* (base de données + Redis + dépendances). Une sonde
  de démarrage HTTP sur ce chemin ne passerait jamais, donc le module utilise
  par défaut une sonde TCP (réussit dès que le port est lié) et **désactive
  complètement la sonde de vivacité** pour éviter de redémarrer en boucle un
  conteneur qui est encore en cours de démarrage.
- **Aucun stockage d'objets n'est monté.** Un bucket GCS générique
  `data` est provisionné via la variable `storage_buckets` de la Fondation,
  mais `gcs_volumes` est vide par défaut — Infisical conserve tout l'état
  persistant dans PostgreSQL et n'a pas besoin de montage de bucket.
- **Le compte administrateur est amorcé sans interface graphique, pas via
  l'interface utilisateur web.** Un job d'initialisation `admin-bootstrap` exécute la
  commande `infisical` CLI `bootstrap` contre le serveur en cours
  d'exécution, évitant la fenêtre d'inscription "ouverte jusqu'à ce que le
  premier visiteur la réclame". Sur Cloud Run, ce job ne s'exécute **pas**
  automatiquement lors de l'application — voir [§3](#3-infisical-application-behaviour).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Infisical {#a-cloud-run--the-infisical-service}

Infisical s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimum et
maximum d'instances. Chaque déploiement crée une révision immuable.

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

Infisical stocke toutes les données d'application (secrets, projets,
organisations, utilisateurs, journaux d'audit) dans une instance gérée de Cloud
SQL pour PostgreSQL 15. Le service se connecte via le **Cloud SQL Auth Proxy**
sur un socket Unix (`enable_cloudsql_volume =
true` par défaut) ; aucune IP publique n'est
exposée. Lors du premier déploiement, le job d'initialisation `db-init` crée
la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Redis (cache et limitation de débit) {#c-redis-cache--rate-limiting}

Redis est **activé par défaut** (`enable_redis = true`). Lorsque `redis_host` est laissé
vide, l'adresse IP de la VM du serveur NFS est utilisée comme hôte Redis par
défaut. Lorsque `redis_auth` est défini, `Infisical_Common` provisionne son propre
secret `REDIS_URL` Secret Manager au lieu de s'appuyer sur l'injection
d'environnement simple de la Fondation.

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm which Redis path is active in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `ENCRYPTION_KEY` (chiffre chaque secret stocké par Infisical),
`AUTH_SECRET` (signe les jetons de session JWT) et `ADMIN_PASSWORD` (consommé
uniquement par le job `admin-bootstrap`, jamais injecté dans le serveur en
cours d'exécution). Un secret `REDIS_URL` est créé
conditionnellement. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~infisical"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé.

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Infisical {#3-infisical-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  d'initialisation `db-init` exécute `postgres:15-alpine`, se connecte via le
  socket Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la
  base de données de l'application (correspondant à `DB_USER`/`DB_NAME`
  injectés par la Fondation). `execute_on_apply = true`, donc cela s'exécute à chaque
  application et peut être réexécuté en toute sécurité.
- **La chaîne de connexion à la base de données est assemblée au démarrage du
  conteneur, et non intégrée au moment de la planification.** Infisical
  accepte un seul `DB_CONNECTION_URI`, mais le `DB_PASSWORD` d'exécution (une valeur
  Secret Manager) n'est pas connu lorsque Terraform rend l'image —
  `entrypoint.sh` encode en URL et construit l'URI à partir des valeurs
  discrètes `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`,
  ramifiant `sslmode` sur la forme de `DB_HOST` (chemin de socket Unix →
  `disable` ; boucle locale → `disable` ; IP privée brute →
  `require`).
- **Le compte administrateur est amorcé sans interface graphique — mais pas
  automatiquement sur Cloud Run.** Le job d'initialisation `admin-bootstrap` (image
  `infisical/cli:latest`, dépend de `db-init`) exécute `infisical bootstrap --ignore-if-bootstrapped` contre
  l'API HTTP du serveur en cours d'exécution pour créer le premier
  super-administrateur, l'organisation et l'identité machine de
  l'administrateur d'instance. Étant donné que les jobs d'initialisation Cloud
  Run s'exécutent strictement *avant* l'existence du service, ce job ne peut
  pas atteindre un serveur en direct au moment de l'application —
  `execute_on_apply = false`. **Déclenchez-le manuellement** après avoir confirmé que le
  service est sain :
  ```bash
  curl -s "$SERVICE_URL/api/status"   # expect HTTP 200 with a JSON body
  gcloud run jobs execute <service>-admin-bootstrap --region "$REGION" --project "$PROJECT" --wait
  ```
  Le job réessaie jusqu'à 20 fois (à 15 secondes d'intervalle) et est
  idempotent (`--ignore-if-bootstrapped`), donc le réexécuter après un redéploiement est
  sans danger.
- **Le mot de passe administrateur ne réside que dans Secret Manager.**
  Récupérez les informations d'identification amorcées avec :
  ```bash
  gcloud secrets versions access latest --secret=<prefix>-infisical-admin-password --project "$PROJECT"
  ```
  Il n'est jamais injecté dans le conteneur du serveur en cours d'exécution —
  uniquement dans le job `admin-bootstrap`.
- **Point de terminaison de santé.** `/api/status` renvoie HTTP 200 avec un
  corps JSON une fois qu'Infisical, sa connexion à la base de données et
  (s'il est activé) Redis sont tous sains — mais les sondes de démarrage/vivacité
  de la plateforme ne l'interrogent délibérément **pas** directement (voir
  [§1](#1-overview)) ; utilisez-le plutôt pour vos propres vérifications de
  santé manuelles et la surveillance externe de la disponibilité.
- **Redis est facultatif mais activé par défaut.** Définissez `enable_redis = false`
  uniquement si vous êtes certain qu'aucun backend de mise en cache/limitation
  de débit n'est souhaité ; Infisical revient à un comportement en mémoire sans
  Redis mais perd la cohérence inter-instances une fois `max_instance_count > 1`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Infisical sont listés ; chaque autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `infisical` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Infisical` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Infisical - Open Source Secrets Management` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image. `"latest"` correspond à un argument de build épinglé (`v0.162.10`) — la documentation d'Infisical recommande de ne jamais exécuter `latest` nu en production. |
| `site_url` | `""` | URL publique pour `SITE_URL` (liens d'invitation/e-mail, CORS) et la cible CLI `admin-bootstrap`. Par défaut, l'URL `run.app` calculée de ce service est vide. |
| `admin_email` | `admin@techequity.cloud` | E-mail du premier compte super-administrateur amorcé. |
| `admin_organization` | `Default Organization` | Nom de l'organisation créée pour le compte amorcé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit le Dockerfile de `Infisical_Common` ; `prebuilt` déploie `container_image` directement. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `container_port` | `8080` | Port sur lequel Infisical écoute. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Sidecar de socket Unix Cloud SQL Auth Proxy — le branchement `sslmode` du point d'entrée dépend de la forme du chemin du socket. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Sûr au-dessus de 1 — les migrations utilisent un verrou consultatif Postgres distribué et l'authentification est basée sur JWT (pas d'état de session en mémoire persistant). |
| `enable_image_mirroring` | `true` | Miroir de l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public ; Infisical est généralement accessible par les navigateurs et les clients CLI/SDK. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Infisical. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | divers | **Déclarées mais non transmises à `Infisical_Common` — inertes, sans effet sur le déploiement.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Infisical de base (`HOST`, `SITE_URL`, `DB_CONNECTION_URI`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Entrées de sauvegarde/restauration `App_CloudRun` standard — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `backup_schedule`, `backup_retention_days`,
`enable_backup_import`.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard `App_CloudRun` Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez
du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

Entrées standard `App_CloudRun` Cloud Armor / CDN / rétention d'Artifact Registry
— voir [App_CloudRun](App_CloudRun.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket par défaut au niveau de la Fondation — **provisionné mais jamais monté** ; Infisical n'a pas besoin de stockage d'objets. |
| `enable_nfs` | (Par défaut de la Fondation) | Pertinent ici uniquement comme source par défaut de l'IP de l'hôte Redis lorsque `redis_host` est vide. |
| `gcs_volumes` | `[]` | Buckets GCS montés via GCS Fuse. Vides par défaut et inutilisés par Infisical. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Infisical nécessite PostgreSQL. |
| `db_name` | `infisical` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | `infisical` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs `Infisical_Common` + `db-init` par défaut de `admin-bootstrap`. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, `container_port` | Transmis à `Infisical_Common`. TCP, pas HTTP `/api/status` — voir [§1](#1-overview). |
| `liveness_probe` | **désactivé** | Transmis à `Infisical_Common`. Désactivé pour la même raison que la sonde de démarrage. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring — envisagez de pointer `path` vers `/api/status` pour un signal de santé externe significatif. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis pour la mise en cache et la limitation de débit. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Lorsqu'il est défini, bascule Infisical vers le secret `Infisical_Common` de `REDIS_URL` au lieu de l'injection d'environnement simple de la Fondation. |
| `cubejs_api_url` / `hub_api_url` | URL localhost | **Déclarées mais non transmises à `Infisical_Common` — inertes, sans effet.** |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Entrées standard — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` inutilisé). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `uptime_check_names` | État de la surveillance et tests de disponibilité. |
| `initialization_jobs` | Noms des jobs `db-init` et `admin-bootstrap`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `artifact_registry_repository` | État CI/CD et registre. |
| `vpc_sc_enabled` / `audit_logging_enabled` | Posture de sécurité. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs et les combinaisons au moment de la planification. Une
> configuration invalide échoue à la **planification** avec une erreur claire
> et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ENCRYPTION_KEY` (auto-généré) | Ne jamais faire tourner après le premier démarrage | Critique | Le faire tourner rend chaque secret précédemment stocké indéchiffrable de manière permanente. |
| `AUTH_SECRET` (auto-généré) | Ne faire tourner que pendant une fenêtre de maintenance | Critique | Le faire tourner invalide toutes les sessions utilisateur actives. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_redis` | Transmettre `var.enable_redis` inconditionnellement à `App_CloudRun` | Critique | Le coder en dur à `false` lors de l'appel de la Fondation laisse `REDIS_URL` complètement non défini dans le cas courant sans authentification — Infisical plante au démarrage avec "Either REDIS_URL, REDIS_SENTINEL_HOSTS or REDIS_CLUSTER_HOSTS must be defined". |
| `database_type` | `POSTGRES_15` | Critique | Toute valeur non-Postgres est rejetée par la validation, ou (si elle était définie d'une manière ou d'une autre) Infisical échouerait complètement à se connecter — MySQL n'est pas pris en charge. |
| `startup_probe` / `liveness_probe` | Conserver les valeurs par défaut du module (démarrage TCP, vivacité désactivée) | Élevé | Pointer l'un ou l'autre vers HTTP `/api/status` fait que la révision Cloud Run ne devient jamais prête — ce point de terminaison ne renvoie 2xx qu'après une disponibilité complète (DB + Redis + dépendances), et Cloud Run ne routera pas le trafic vers un service qui attend toujours sa propre sonde de démarrage. |
| Job `admin-bootstrap` | Déclencher manuellement après le premier déploiement sain | Élevé | Sans le déclencher, aucun compte administrateur n'existe et l'instance est inutilisable depuis l'interface utilisateur/API tant que le job n'est pas exécuté. |
| `site_url` | Laisser vide pour l'URL `run.app` auto-calculée, ou définir explicitement pour un domaine personnalisé | Moyen | Une valeur incorrecte rompt les liens d'invitation/e-mail, CORS et la cible du job `admin-bootstrap`. |
| `smtp_host` / `smtp_user` / `smtp_password` / `mail_from` / `cubejs_api_url` / `hub_api_url` | N/A | Faible | Ces variables sont déclarées pour la parité de convention mais ne sont jamais transmises à `Infisical_Common` — les définir n'a aucun effet. |
| `memory_limit` | `2Gi` (par défaut) ou plus | Moyen | Des valeurs inférieures risquent un OOM sous une charge de récupération de secrets concurrente. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Infisical partagée avec la variante GKE est décrite
dans **[Infisical_Common](Infisical_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Infisical sur Cloud Run](../labs/Infisical_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de console et les commandes à
  chaque étape.
- [Infisical sur GKE Autopilot](Infisical_GKE.md) — la même application sur
  Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Infisical Common — Configuration d'application partagée](Infisical_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Keycloak sur Google Cloud
  Run](Keycloak_CloudRun.md), [Passbolt sur Google Cloud
  Run](Passbolt_CloudRun.md) dans la solution **SSO Foundation**.
