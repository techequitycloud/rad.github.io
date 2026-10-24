---
title: "Payload CMS sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Payload CMS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Payload_CloudRun.md @ 1665a43e sha256:9962d011aaff -->

# Payload CMS sur Google Cloud Run {#payload-cms-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Payload_CloudRun.png" alt="Payload CMS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Payload CMS est un CMS headless et un framework d'application TypeScript-natif, code-first,
construit directement sur Next.js — ce n'est pas un produit SaaS hébergé, mais une bibliothèque
installée dans votre propre application Next.js. Le contenu est modélisé via des "Collections"
typées définies dans `payload.config.ts`, et Payload génère une interface d'administration ainsi que des API
REST, GraphQL et locales à partir de cette même configuration. Ce module déploie une véritable
application Payload sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ce déploiement et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécaniques communes à toutes les applications Cloud Run — identité de service, ingress et équilibrage
de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Payload sur RAD et comment cela se compare {#what-payload-costs-on-rad-and-how-that-compares}

**Pour une petite équipe, Payload sur le module Cloud Run de RAD coûte environ 84 US$ par mois, sans
licence par utilisateur.** Payload Cloud, l'offre hébergée du projet, ne publie pas de liste de prix
publique actuelle ; un serveur autogéré est moins cher en espèces que RAD, mais vous gérez alors
vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Les
chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour une certification, une démo, une activité
saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques
crédits, de sorte que ces 84 US$ deviennent quelques dollars par mois. Voir **Mettez-le en pause
gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 crédits par mois (environ 96 US$ au prix de la recharge, 77 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par
chaque application du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de
données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 84 US$** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ; la VM coûte environ
  10 % de plus.
- **La mise à l'échelle à zéro est la valeur par défaut.** La ligne Cloud Run ci-dessus reflète déjà
  ce coût ; le réglage `min_instance_count = 1` maintient une instance active et augmente cette ligne, en échange de
  l'absence de démarrages à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise une petite VM NFS/cache par
  défaut. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 US$ par mois
  à elle seule.

### Comment cela se compare {#how-it-compares}

- Payload Cloud, l'offre hébergée du projet, ne publie pas de liste de prix publique actuelle,
  donc cette comparaison se fait plutôt avec un serveur nu.
- Un VPS nu — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 US$/mois
  — est moins cher que le chiffre de RAD pour un projet propre ci-dessus. Payload n'a besoin que
  d'un vCPU / 1-2 Gio, donc un niveau de VPS plus petit/moins cher ferait probablement l'affaire ;
  les chiffres ci-dessus sont la plus petite classe vérifiée indépendamment.
- La différence réside dans la base de données et la gestion des secrets : les sauvegardes Cloud
  SQL et la récupération à un point dans le temps, ainsi que Secret Manager, sont inclus sur RAD
  plutôt que d'être votre propre travail sur un VPS.
- Si Payload doit rester actif sans mise à l'échelle à zéro, ou fonctionner à côté d'autres
  charges de travail Kubernetes, consultez plutôt le [guide GKE](Payload_GKE.md) — environ 107 US$
  par mois dans votre propre projet, ou 2 760 crédits (environ 221-276 US$) par mois dans un projet
  géré par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Payload s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le
dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle —
étudier pour une certification, un environnement de démonstration, une activité saisonnière — que
de faire fonctionner Payload en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation,
  puis demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un
  seul module, cela ne supprime pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de
  rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement,
  cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte
  une poignée de crédits (moins de 1 US$) pour une chaîne typique de 2-3 déploiements, contre les
  115 crédits (11,50 US$) que coûte un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 84 US$.**
  Déployez Payload, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine
  fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque
  vous avez terminé. Vous ne payez qu'une seule fois les frais de module, les builds et le temps
  pendant lequel Payload était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que RAD gère
  uniquement pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela,
  Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits
  pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration).
  Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36
  heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes de Payload sont
  écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que
  vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous
  avez apporté des modifications à Payload que vous souhaitez conserver, copiez une sauvegarde
  (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de
  redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a
  pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à
un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la
façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115
  crédits (11,50 US$), car RAD recrée le projet et les services partagés avant Payload. La
  suppression ne permet d'économiser de l'argent que si Payload devait rester inutilisé pendant
  environ 5 jours ou plus, à la fois dans votre propre projet (environ 2,79 US$ par jour) et dans
  un projet géré par RAD (32 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée.**
  Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Payload
  alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Payload.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la
  supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les
  paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque
  participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  chaque place, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour
  un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le
  client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
[radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les
estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

Payload s'exécute en tant que conteneur Node.js (Next.js) sur Cloud Run v2. Il n'y a **pas
d'image Docker officielle de Payload** — ce module construit une véritable application de démarrage
vérifiée localement à partir de la source (un modèle `create-payload-app` vierge utilisant l'adaptateur
PostgreSQL) via Cloud Build. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js (Next.js autonome), mise à l'échelle automatique sans serveur ; mise à l'échelle à zéro prise en charge par défaut |
| Build | Cloud Build | Construit l'application de démarrage Payload groupée à partir de `Payload_Common/scripts/Dockerfile` — aucune image préconstruite n'existe à extraire |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — l'adaptateur Postgres de Payload est utilisé ; MySQL/MongoDB ne sont pas connectés |
| Stockage d'objets | Aucun | Aucun bucket n'est provisionné ; les téléchargements de médias vont sur le disque local et éphémère du conteneur |
| Secrets | Secret Manager | `PAYLOAD_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire et le schéma n'est pas créé au démarrage.** Le démarrage du
  serveur construit sur une base de données vierge ne crée aucune table — le job d'initialisation
  `payload-migrate` applique le schéma via la CLI `payload migrate`, en utilisant un fichier de migration
  pré-généré intégré à l'image.
- **`container_image_source` est fixé à `"custom"`.** Il n'y a rien à déployer sans une exécution de Cloud
  Build — le module construit toujours `Payload_Common/scripts/` à partir de la source.
- **Les sondes de santé ciblent `/admin`, pas `/` ou une route API.** `/admin` sert le
  formulaire de connexion/création du premier utilisateur de Payload et renvoie un `200` non
  authentifié ; les routes REST/GraphQL de Payload nécessitent une authentification et ne sont pas
  des cibles de sonde appropriées.
- **Aucun bucket de stockage n'est provisionné.** Les médias téléchargés sont écrits sur le disque
  local du conteneur et ne survivent pas à un redémarrage de pod ou à un redéploiement.
- **`enable_redis` et les variables associées du groupe 21 sont déclarées mais inertes.** Elles ne sont
  pas transmises à `Payload_Common`, qui n'a pas de câblage Redis.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les démarrages à froid
  ajoutent de la latence à la première requête après l'inactivité, aggravée par le coût de
  démarrage à froid propre à Next.js.
- **Le premier utilisateur administrateur est créé manuellement.** Payload n'a pas de CLI
  non-interactive pour cela — la visite de `/admin` sur une collection `users` vide affiche un
  formulaire d'inscription.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de
ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Payload {#a-cloud-run--the-payload-service}

Payload s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la charge de
requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision
immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud Build — construction de l'image Payload {#b-cloud-build--building-the-payload-image}

Puisqu'il n'existe pas d'image Payload officielle, chaque déploiement (et chaque redéploiement
après une modification du Dockerfile ou de la source) déclenche une exécution de Cloud Build
contre `Payload_Common/scripts/`.

- **Console :** Cloud Build → Historique.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit=10
  gcloud builds log <build-id> --project "$PROJECT"
  ```

### C. Cloud SQL pour PostgreSQL 15 {#c-cloud-sql-for-postgresql-15}

Payload stocke toutes les données d'application (Collections, utilisateurs, métadonnées de
documents téléchargés) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se
connecte en privé via le **proxy d'authentification Cloud SQL** via un socket Unix ; aucune IP
publique n'est exposée. Lors du premier déploiement, `db-init` crée la base de données et le rôle,
puis `payload-migrate` applique le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent
dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `PAYLOAD_SECRET`
(utilisé pour signer les propres jetons de session/authentification de Payload). Le mot de passe
de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud
SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Payload {#3-payload-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init` (utilisant `postgres:15-alpine`)
  se connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente le rôle et
  la base de données de l'application.
- **La migration de schéma est un job séparé et dépendant.** `payload-migrate` (`depends_on_jobs =
  ["db-init"]`) exécute `./node_modules/.bin/payload migrate`
  à partir d'une copie complète `/app/cli` de `node_modules` + source TypeScript intégrée à l'image —
  le runtime autonome Next.js allégé utilisé pour servir le trafic n'inclut pas la CLI Payload ou
  ses dépendances. C'est un fait comportemental réel confirmé localement : le démarrage de
  l'application sur une base de données sans schéma ne sert aucune table et chaque requête de
  collection échoue tant que les migrations n'ont pas été exécutées.
- **`PAYLOAD_SECRET` doit être traité comme immuable après le premier démarrage.** Il signe les jetons de
  session/authentification de Payload ; sa rotation invalide toutes les sessions actives.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/admin` — la route de
  l'interface d'administration de Payload, qui renvoie un `200` non authentifié une fois que le
  serveur Node.js et la connexion à la base de données sont prêts. Prévoyez plusieurs minutes au
  premier démarrage pour que le job `payload-migrate` se termine avant que le service ne soit censé servir
  du contenu réel.
- **Premier compte administrateur.** Payload n'a pas de commande CLI pour créer le premier
  utilisateur administrateur de manière non interactive. Visitez `$SERVICE_URL/admin` — avec une collection
  `users` vide, Payload affiche un formulaire d'inscription pour créer le premier
  administrateur. Il s'agit d'une étape manuelle et unique de l'opérateur.
- **Les téléchargements de médias ne persistent pas.** Aucun bucket de stockage n'est
  provisionné ; les fichiers téléchargés sont écrits sur le disque local du conteneur et sont
  perdus lors du prochain redémarrage du pod, du redéploiement ou du démarrage à froid de la mise
  à l'échelle à zéro remplaçant le conteneur.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Payload sont listés ; toutes les
autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `payload` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Payload CMS` | Nom lisible par l'homme affiché dans la console. Texte résiduel de la source de clonage du module — à remplacer par `Payload CMS` (ou toute étiquette que vous préférez) au moment du déploiement ; il est purement cosmétique. |
| `application_version` | `latest` | Balise de suivi de déploiement intégrée à l'image via l'argument de build `application_version` de Cloud Build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Payload (Next.js) a besoin d'une marge de manœuvre pour le serveur autonome et l'empreinte TypeScript/CLI du job de migration. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Payload s'exécute uniquement côté serveur (pas de processus worker, cron désactivé), il est donc purement requête/réponse sans rien à limiter. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | `0` active la mise à l'échelle à zéro. |
| `container_port` | `3000` | Valeur par défaut de Next.js. |
| `container_image_source` | `custom` | Fixe — il n'y a pas d'image Payload préconstruite à déployer. |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut. |
| `enable_iap` | `false` | Exiger la connexion Google — bloque les visiteurs anonymes du formulaire d'inscription du premier utilisateur de `/admin` si activé avant l'existence du premier administrateur. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `PAYLOAD_SECRET` ou `DATABASE_URL` ici — les deux sont calculés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Déclaré dans `variables.tf` avec une description impliquant un adaptateur de stockage GCS compatible S3, mais **non transmis** à `Payload_Common` — n'a aucun effet. La sortie `Payload_Common` de `storage_buckets` est toujours `[]`. |
| `gcs_volumes` | `[]` | Transmis réellement — montages de volume GCS Fuse, si vous souhaitez connecter vous-même un stockage persistant. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; Payload nécessite PostgreSQL. |
| `db_name` / `db_user` | `payload` / `payload` | Nom de la base de données PostgreSQL et utilisateur de l'application. Immuable après le premier déploiement. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `payload-migrate`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/admin`, délai de 120 s, période de 15 s, 40 tentatives | Fenêtre totale d'environ 12 minutes pour que les migrations au premier démarrage se terminent. |
| `liveness_probe` | HTTP `/admin`, délai de 30 s | Sonde de vivacité. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | `true` / `""` / `6379` / `""` | **Inerte.** Déclaré dans `variables.tf` (avec une description affirmant que Payload v0.4+ nécessite Redis) mais jamais transmis à `Payload_Common`, qui n'a aucun câblage Redis. La définition de ces valeurs n'a aucun effet. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — aucun bucket n'est provisionné. |
| `container_image` / `container_registry` | Image construite et référentiel Artifact Registry. |
| `initialization_jobs` | Noms des jobs `db-init` et `payload-migrate`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `PAYLOAD_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives, obligeant tous les utilisateurs à se reconnecter. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `startup_probe` / `payload-migrate` (délai) | Autoriser la fenêtre complète d'environ 12 minutes | Élevé | Si la fenêtre de la sonde est raccourcie en dessous du temps nécessaire à `payload-migrate`, la révision peut être marquée comme non saine avant la fin de la migration du schéma, car les deux s'exécutent simultanément plutôt que la sonde n'attende le job. |
| Persistance des médias/téléchargements | Ajouter un véritable adaptateur de stockage avant l'utilisation en production | Élevé | Sans bucket de stockage connecté, tous les médias téléchargés résident sur le disque local du conteneur et sont perdus à chaque redémarrage de pod, redéploiement ou démarrage à froid de la mise à l'échelle. |
| `enable_gcs_storage` | Ne pas se fier à ce commutateur | Moyen | Déclaré mais non transmis à `Payload_Common` — son activation ne provisionne ni ne connecte aucun stockage. |
| `enable_redis` / `redis_*` | Ne pas se fier à ces commutateurs | Moyen | Déclaré mais non transmis à `Payload_Common`, qui n'a aucun câblage Redis — leur définition n'a aucun effet. |
| Création du premier administrateur | Terminer rapidement après le déploiement | Moyen | Tant que le premier administrateur n'est pas créé via le formulaire d'inscription `/admin`, l'instance n'a aucun utilisateur authentifié. |
| `container_image_source` | Laisser à `custom` | Faible | Il n'y a pas d'image Payload préconstruite ; la définition de `prebuilt` sans un `container_image` valide interrompt le déploiement. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Payload partagée avec la variante GKE est décrite dans
**[Payload_Common](Payload_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Payload CMS sur Cloud Run](../labs/Payload_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Payload CMS sur GKE Autopilot](Payload_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Payload Common — Configuration d'application partagée](Payload_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Medusa sur Google Cloud Run](Medusa_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Boutique en ligne**.
