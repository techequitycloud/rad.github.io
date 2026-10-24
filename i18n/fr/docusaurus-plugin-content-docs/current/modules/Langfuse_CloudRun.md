---
title: "Langfuse sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Langfuse sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Langfuse_CloudRun.md @ 1665a43e sha256:076d209ea205 -->

# Langfuse sur Google Cloud Run {#langfuse-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Langfuse_CloudRun.png" alt="Langfuse sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Langfuse est une plateforme open-source, sous licence MIT, d'ingénierie et
d'observabilité LLM — traçage, gestion des invites, évaluations et métriques pour les
applications construites sur de grands modèles linguistiques. Ce module déploie Langfuse
sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Langfuse et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte Langfuse sur RAD, et comment cela se compare {#what-langfuse-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Langfuse sur RAD coûte environ 167 US$ par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 US$).** Langfuse est open source sous licence MIT, il s'agit donc du coût d'infrastructure d'une instance auto-hébergée et non mesurée, plutôt que de la version hébergée dont le prix est basé sur l'utilisation. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 167 US$ deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 US$ au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **167 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **77 crédits par jour**, soit environ 2310 par mois (environ 231 US$ au prix de la recharge, 185 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel. Dans
un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont
partagés par toutes les applications du projet, de sorte qu'une deuxième application
n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 167 US$** |

### Comment cela se compare {#how-it-compares}

- **Langfuse Cloud a des prix publiés** sur [langfuse.com/pricing](https://langfuse.com/pricing) : Hobby est gratuit (50k unités de trace/mois, accès aux données pendant 30 jours, 2 utilisateurs) ; Core est à 29 $/mois (100k unités incluses, accès pendant 90 jours, utilisateurs illimités) ; Pro est à 199 $/mois (historique de 3 ans, files d'attente d'annotation illimitées). Le dépassement des unités incluses est facturé 6 à 8 $ par 100k unités.
- **Pour une petite équipe à faible volume, le plan Core de Langfuse Cloud à 29 $/mois est clairement moins cher** que l'auto-hébergement à environ 167 US$. L'auto-hébergement devient rentable lorsque le volume de traces ou les besoins de rétention des données dépassent l'allocation de 100k unités/90 jours de Core, ou lorsque vous avez besoin que les données restent entièrement dans votre propre projet plutôt que dans la base de données d'un tiers.
- Un VPS nu dimensionné aux valeurs par défaut de 2 vCPU/4 GiB de Langfuse (plus proche d'un GCE e2-standard-2, ~49 US$/mois, que de la classe Hetzner/DO plus petite) est moins cher en espèces mais vous laisse gérer Postgres, les sauvegardes et les correctifs.
- Voir le [guide GKE](Langfuse_GKE.md) pour un déploiement qui met à l'échelle les pods sous une charge plus lourde et plus stable.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Langfuse s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du
projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien à
Langfuse si vous n'en avez besoin qu'occasionnellement — un projet de cours, une démo,
une évaluation de courte durée — bien mieux que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à
  la suppression d'un module, cela ne supprime pas Cloud SQL ou le calcul propre à
  Langfuse un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête
  simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  récupérer le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une
  mise à jour ne facture jamais les frais de module à nouveau. Pour Langfuse derrière
  un petit Services_GCP et Project_GCP, c'est **une poignée de crédits (moins de 1
  US$)** au total, contre les 180 crédits que coûte un redéploiement complet.
- **Ce dont cela a besoin.** Vous devez posséder le projet (pas un projet que vous
  apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même
  dans les 30 jours — après cela, Google le supprime définitivement. La restauration
  est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la
  plupart des utilisations d'étude et de démo conviennent). Google indique que la
  plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Une véritable lacune : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes de Langfuse sont écrites dans un bucket à l'intérieur du projet, et ce
  bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est
  donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le
  projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Langfuse
  et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive
  ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail
  de redéploiement ci-dessous. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

La valeur par défaut de ce module maintient Cloud Run en fonctionnement continu (CPU
toujours alloué), il ne se met donc pas à l'échelle à zéro de lui-même. L'option
ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou
une fois que la fenêtre de 30 jours est passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 180 crédits (18,00 US$), car RAD recrée le projet et les services
  partagés avant Langfuse. La suppression ne permet d'économiser de l'argent que si
  Langfuse reste inutilisé pendant environ quatre jours ou plus, à la fois dans votre
  propre projet (environ 5,58 US$ par jour) et dans un projet géré par RAD (77 crédits
  par jour).
- **Supprimez tout ce que Langfuse utilise.** La majeure partie du coût d'exécution
  est généralement la base de données. Elle ne s'arrête que si rien d'autre dans le
  projet ne l'utilise, donc la suppression de Langfuse alors que quelque chose
  d'autre partage le projet n'économise que la partie calcul de Langfuse.
- **Conservez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket
  à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
  sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Langfuse pour
  une classe. Chaque participant dispose de Langfuse dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places à l'avance, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session, et les
  crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  Langfuse pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin de l'engagement, le partenaire transfère le projet, et les
  déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et estimation quotidienne de 77 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'il dit sur les objets Cloud Storage
sans suppression logicielle. [Tarification Langfuse Cloud](https://langfuse.com/pricing).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Langfuse s'exécute comme un conteneur Next.js sur Cloud Run v2. Ce module déploie la
**ligne v2** (Postgres uniquement) ; Langfuse v3 nécessite en outre ClickHouse, Redis
et S3 et n'est pas couvert. Le déploiement relie un ensemble ciblé de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 2 vCPU / 4 GiB par défaut, autoscaling sans serveur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Langfuse v2 ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket dédié provisionné automatiquement ; pas de partage NFS (Langfuse n'a pas de mode de stockage de système de fichiers) |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `SALT` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Langfuse v2 (Postgres uniquement) est épinglé.** L'image est construite `FROM langfuse/langfuse:2`
  via l'ARG de build `LANGFUSE_VERSION`. Même `application_version = "latest"` se résout en `2`. Le déploiement de
  la v3 nécessiterait ClickHouse + Redis + S3 que ce module ne provisionne pas.
- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **`NEXTAUTH_SECRET` et `SALT` sont générés automatiquement** et stockés dans Secret Manager.
  La validation d'environnement zod de Langfuse refuse de démarrer sans les deux —
  `NEXTAUTH_SECRET` signe les JWT de session et `SALT` hache les clés API. Les faire pivoter
  invalide les sessions / les clés API stockées.
- **Les migrations Prisma s'exécutent à chaque démarrage.** Le point d'entrée cloud
  compose `DATABASE_URL` à partir des variables `DB_*` injectées, puis passe la main au
  démarrage propre de Langfuse, qui exécute `prisma migrate deploy`. Le job `db-init` ne crée que le
  rôle et la base de données.
- **Le premier utilisateur à s'inscrire devient le propriétaire.** `AUTH_DISABLE_SIGNUP = "false"` est
  injecté ; il n'y a pas de credential admin pré-rempli. Désactivez l'inscription
  après l'intégration.
- **`min_instance_count = 1` avec `cpu_always_allocated = true`.** Une instance reste chaude afin que le traitement en
  arrière-plan de Langfuse (ingestion par lots, travail planifié) continue de
  fonctionner entre les requêtes ; le CPU n'est pas limité à zéro pendant l'inactivité.
- **L'entrée publique est la valeur par défaut.** `ingress_settings = "all"` afin que l'interface
  utilisateur et les points de terminaison d'ingestion/API soient accessibles par les
  clients SDK de votre application LLM. L'activation d'IAP bloquera le trafic SDK non
  authentifié.
- **Pas de Redis.** Langfuse v2 utilise une file d'attente et un cache basés sur
  PostgreSQL ; `enable_redis` reste `false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Langfuse {#a-cloud-run--the-langfuse-service}

Langfuse s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

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

Langfuse stocke toutes les données d'application (traces, observations, scores, invites,
utilisateurs, projets, clés API) dans une instance Cloud SQL gérée pour PostgreSQL 15.
Le service se connecte en privé via le **proxy d'authentification Cloud SQL** via un
socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée le rôle et la base de données de l'application ; Langfuse
applique ensuite son schéma via `prisma migrate deploy` au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
sont dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement. Langfuse v2 conserve
toutes les données de trace et d'observabilité dans PostgreSQL ; le bucket est
disponible pour les exportations et les médias plutôt que pour l'état primaire.
Langfuse n'a pas de mode de stockage de système de fichiers, donc un partage NFS ne
serait jamais écrit.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `NEXTAUTH_SECRET` (signe les JWT de session d'authentification) et `SALT` (hache les
clés API). Les deux sont injectés comme variables d'environnement secrètes et sont
requis au démarrage. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, ce qui permet l'accès public
dont les clients SDK de votre application LLM ont besoin pour POSTER des traces à
l'API d'ingestion. Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et de
contrôle de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Langfuse {#3-langfuse-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le proxy
  d'authentification Cloud SQL et crée de manière idempotente le rôle et la base de
  données de l'application et accorde les privilèges. Il ne crée **pas** de tables — le
  job peut être réexécuté en toute sécurité.
- **Migrations Prisma au démarrage.** Le point d'entrée cloud compose `DATABASE_URL` puis
  délègue au démarrage propre de Langfuse, qui exécute `prisma migrate deploy` avant de lancer le
  serveur. La mise à niveau de la version de l'application applique donc les
  modifications de schéma sans étape de migration distincte — prévoyez un temps
  supplémentaire lors du premier démarrage après une mise à niveau.
- **`NEXTAUTH_SECRET` et `SALT` sont immuables après le premier démarrage.** Ils sont générés
  une fois et écrits dans Secret Manager. La modification de `NEXTAUTH_SECRET` invalide toutes
  les sessions actives ; la modification de `SALT` invalide de manière permanente
  toutes les clés API existantes (les clients SDK reçoivent alors `401`). Ne
  faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Le premier utilisateur est le propriétaire.** Lors de la première visite, la page
  d'inscription de Langfuse crée le compte initial, qui devient le propriétaire de
  l'instance (pas de credential pré-rempli). Après l'intégration, définissez `AUTH_DISABLE_SIGNUP = "true"`
  dans `environment_variables` et appliquez via **Update** pour empêcher toute inscription
  libre-service ultérieure.
- **Points de terminaison d'ingestion.** Le `ingress_settings = "all"` par défaut permet aux clients SDK
  de votre application LLM de POSTER des traces à l'API d'ingestion publique.
  L'activation d'IAP bloque ces appels non authentifiés — désactivez IAP si les SDK
  doivent atteindre le service, ou autorisez explicitement les appelants.
- **Chemin de santé.** Les sondes de démarrage et de vivacité par défaut sont `/`
  dans `variables.tf` — pas le point de terminaison `/api/public/health` dédié de l'application, qui n'est
  pas câblé par défaut. Prévoyez une fenêtre généreuse lors du premier démarrage (la
  sonde de démarrage utilise un seuil d'échec large et un délai initial de 60
  secondes) afin que les migrations Prisma se terminent ; envisagez de remplacer
  `path` par `/api/public/health` pour un signal de disponibilité plus précis.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Langfuse sont listés
; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langfuse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Langfuse Helpdesk` | Nom lisible par l'homme affiché dans la console. Texte de clone-rot restant dans `variables.tf` (Langfuse est une plateforme d'observabilité LLM, pas un centre d'aide) — remplacez par exemple par `"Langfuse"` pour un nom d'affichage précis. |
| `description` | `Langfuse - Open-source helpdesk and customer support platform` | Description du service. Même texte de clone-rot restant que `display_name` — remplacez pour une description précise. |
| `application_version` | `2` | Tag de l'image Langfuse. Épinglé à la ligne v2 (Postgres uniquement). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Langfuse construit une image wrapper mince à partir de `langfuse/langfuse:2`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; minimum 2 GiB. |
| `cpu_always_allocated` | `true` | Gardez le CPU alloué afin que le traitement en arrière-plan s'exécute entre les requêtes. |
| `min_instance_count` | `1` | Maintient une instance chaude pour le traitement en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure d'autoscaling. |
| `container_port` | `3000` | Langfuse (Next.js) écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Langfuse dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les points de terminaison d'ingestion SDK publics. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque l'ingestion SDK non authentifiée.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas `NEXTAUTH_SECRET`, `SALT` ou `DATABASE_URL` ici — ils sont gérés par le module. Définissez `AUTH_DISABLE_SIGNUP = "true"` ici après l'intégration. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner. |
| `enable_nfs` | `false` | Laisser désactivé : Langfuse n'a pas de mode de stockage de système de fichiers, donc le partage n'est jamais utilisé, et un serveur NFS inaccessible bloquerait le démarrage. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Langfuse nécessite PostgreSQL. |
| `db_name` | `langfuse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `langfuse` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run planifiés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, seuil d'échec large | Sonde de démarrage. Prévoir un temps généreux pour les migrations Prisma au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Sondes structurées alternatives. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 utilise une file d'attente et un cache basés sur PostgreSQL — laisser `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisé uniquement si externalisation vers Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Niveaux d'accès CIDR / mode simulation (dry-run). |
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
| `stage_services` | URL de service spécifiques à la phase (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `SALT` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide de manière permanente toutes les clés API existantes — chaque client SDK les utilisant reçoit `401` jusqu'à ce qu'elles soient reconfigurées. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de trace. |
| `application_version` | `2` (ligne v2) | Critique | La définition d'un tag v3 pointe le build vers une image nécessitant ClickHouse + Redis + S3 que ce module ne provisionne pas — le service ne démarre pas. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans sauvegarde valide échoue au job d'importation. |
| `memory_limit` | `4Gi` (≥ 2Gi) | Élevé | En dessous de 2 GiB, le serveur Next.js de Langfuse tue OOM lors des migrations au premier démarrage ou sous charge d'ingestion. |
| `ingress_settings` | `all` | Élevé | La définition à `internal` bloque tous les appels d'ingestion SDK externes. |
| `enable_iap` | uniquement lorsque l'ingestion SDK n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion de traces SDK. |
| `AUTH_DISABLE_SIGNUP` (auto-injecté `"false"`) | Désactiver après le premier propriétaire | Élevé | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) arrête le traitement en arrière-plan et ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `cpu_always_allocated` | `true` | Moyen | La facturation basée sur les requêtes limite le traitement en arrière-plan à ~0 CPU entre les requêtes. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur et les points de terminaison d'ingestion sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise
à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
Langfuse partagée avec la variante GKE est décrite dans
**[Langfuse_Common](Langfuse_Common.md)**.

## Guides associées {#related-guides}

- [Lab pratique : Langfuse sur Cloud Run](../labs/Langfuse_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Langfuse sur GKE Autopilot](Langfuse_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Langfuse Common — Configuration d'application partagée](Langfuse_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) dans la solution **Assistant IA Privé**.
