---
title: "Seerr sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Seerr sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Seerr_CloudRun.md @ e69407af sha256:f9d28ebb77c0 -->

# Seerr sur Google Cloud Run {#seerr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Seerr_CloudRun.png" alt="Seerr sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Seerr est la fusion en 2026 de **Jellyseerr** et **Overseerr** — une interface
utilisateur de demande open-source, sous licence MIT, qui se place devant un
serveur multimédia Jellyfin, Plex ou Emby. Les utilisateurs parcourent et
demandent des titres ; un administrateur approuve la demande, et Seerr appelle
les API de Sonarr et Radarr pour déclencher l'acquisition. Ce module déploie
Seerr sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Seerr et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Seerr sur RAD, et comment cela se compare {#what-seerr-costs-on-rad-and-how-that-compares}

**L'exécution de Seerr dans votre propre projet GCP coûte environ 180,87 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide GKE pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~180,87 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~83 crédits/jour, mesuré à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **180,87 $** |

### Comment cela se compare {#how-it-compares}

- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais censé battre un VPS, seulement remplacer le temps d'administration qu'un VPS nécessite encore.
- Seerr se place devant un serveur multimédia domestique plutôt que l'internet public, il fonctionne donc en continu mais avec un faible trafic — notez que ce module nécessite `alwaysOn` de calcul pour maintenir l'acquisition déclenchée par les requêtes réactive, c'est pourquoi son propre coût d'exécution est plus élevé que la plupart des applications de ce lot.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour lequel RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Seerr purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Seerr reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 2 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Seerr s'exécute en tant que conteneur Node.js/Next.js unique sur Cloud Run v2.
Le déploiement relie un petit ensemble de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Processus Node.js unique, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL PostgreSQL 15 | Contient les données de demande/utilisateur ; les migrations s'exécutent automatiquement à chaque démarrage |
| Stockage d'objets | Cloud Storage | Un bucket `storage` monté à `/app/config` via GCS FUSE — contient `settings.json`, les propres paramètres d'application de Seerr |
| Cache et file d'attente | aucun | Seerr n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données généré — Seerr n'initialise pas ses propres identifiants (son premier administrateur provient de l'assistant de configuration web de l'application) |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Véritablement pré-construit — pas d'image personnalisée.** Le répertoire
  `Seerr_Common` de `scripts/` est vide. `container_image_source = "prebuilt"` déploie
  `ghcr.io/seerr-team/seerr` directement ; il n'y a pas d'étape Cloud Build pour l'image
  principale.
- **`DB_TYPE=postgres` est défini sans condition.** La propre logique de source de
  données de Seerr (`process.env.DB_TYPE === 'postgres'`, confirmée via `/app/dist/datasource.js` dans
  l'image réelle) utilise une base de données SQLite en conteneur — effacée à
  chaque redémarrage, sans erreur — si cette variable est manquante. `Seerr_Common`
  la définit comme une variable d'environnement statique afin qu'un
  déploiement standard soit toujours correct.
- **Port 5055, chemin de santé `/api/v1/status`.** Confirmé via des tests
  `docker run` locaux et un déploiement en direct : `GET /api/v1/status`
  renvoie un `200` non authentifié avec JSON (`{"version":...,"commitTag":...}`)
  une fois l'application prête.
- **Deux éléments d'état distincts.** PostgreSQL contient les données de
  demande/utilisateur. Les propres paramètres d'application de Seerr (serveurs
  multimédias connectés, curseurs de découverte, agents de notification) sont
  écrits dans un fichier `settings.json` simple sous `/app/config`
  **indépendamment du backend de la base de données** — confirmé par
  l'inspection directe du système de fichiers du conteneur. Ce module monte un
  volume GCS persistant à ce chemin en plus de la connexion Postgres.
- **`DB_PASS`, pas `DB_PASSWORD`.** La source de données TypeORM de Seerr
  lit une variable d'environnement `DB_PASS` spécifiquement nommée pour le
  mot de passe de la base de données. Ce module définit `db_password_env_var_name = "DB_PASS"` pour
  correspondre.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Seerr {#a-cloud-run--the-seerr-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence
et la répartition du trafic.

### B. Cloud SQL — données de demande/utilisateur {#b-cloud-sql--requestuser-data}

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  ```

### C. Cloud Storage — le volume de paramètres {#c-cloud-storage--the-settings-volume}

Le bucket `storage` est monté à `/app/config` via GCS FUSE. Il contient
`settings.json` (et `settings.old.json`, un répertoire `db/`, et `logs/`) —
la propre configuration au niveau de l'application de Seerr, distincte de tout
ce qui est stocké dans PostgreSQL.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~seerr"
  gcloud storage ls "gs://<bucket-name>/"
  ```

### D. Secret Manager {#d-secret-manager}

Seul le mot de passe de la base de données auto-généré réside ici — Seerr n'a
pas de secret d'identifiant administrateur propre.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~seerr"
  ```

### E. Réseau et ingress {#e-networking--ingress}

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Seerr {#3-seerr-application-behaviour}

- **Pas de job de schéma de base de données au premier déploiement.** Le
  `dist/index.js` de Seerr appelle `dbConnection.runMigrations()` explicitement à chaque
  démarrage, il n'y a donc pas de job `db-init`/migrate dans ce module et
  aucun n'est nécessaire. `initialization_jobs` est vide par défaut.
- **La configuration initiale se fait entièrement dans l'interface web de
  l'application.** Il n'y a aucun identifiant administrateur pré-rempli
  d'aucune sorte — visitez l'URL du service après le premier déploiement et
  complétez l'assistant de configuration de Seerr : connectez Jellyfin/Plex/Emby,
  puis Sonarr/Radarr.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `GET /api/v1/status` — un `200` non authentifié avec une charge
  utile JSON une fois que l'application a terminé son démarrage et sa connexion
  à Postgres.
- **Inspecter l'exécution du job (ne devrait rien montrer, par conception) :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### ⚠ Le piège DB_TYPE — la chose la plus importante à savoir sur ce module {#-the-db_type-trap--the-most-important-thing-to-know-about-this-module}

La sélection de la source de données de Seerr est une vérification de variable
d'environnement unique et facile à manquer, confirmée par la lecture de
`/app/dist/datasource.js` à l'intérieur de l'image en cours d'exécution :

```js
exports.isPgsql = process.env.DB_TYPE === 'postgres';
```

Si `DB_TYPE` n'est pas défini exactement sur `postgres`, Seerr revient
**silencieusement** à un fichier de base de données SQLite en conteneur —
aucune erreur, aucun avertissement dans les journaux, et un déploiement qui
semble par ailleurs complètement sain (le conteneur démarre, la vérification
de santé passe, l'interface utilisateur se charge). Chaque écriture — y
compris l'ensemble de la configuration initiale — va dans un fichier effacé au
prochain redémarrage ou démarrage à froid.

`Seerr_Common` comble cette lacune avec une variable d'environnement statique
définie sans condition avant toute variable `environment_variables` fournie par
l'appelant :

```hcl
environment_variables = merge(
  { DB_TYPE = "postgres" },
  var.environment_variables
)
```

Un déploiement standard de ce module est correct dès la sortie de la boîte. Le
risque ne se manifeste que si vous forkez le module Common ou remplacez
`environment_variables` entièrement au lieu de superposer des ajouts — vérifiez que
`DB_TYPE=postgres` survit à un tel changement avec :

```bash
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env)' | grep DB_TYPE
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Seerr sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `seerr` | Nom de base des ressources. |
| `display_name` | `Seerr` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tiré directement comme le tag d'image `ghcr.io/seerr-team/seerr` — aucune étape de build impliquée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5055` | Confirmé via `docker run` local et déploiement en direct. |
| `container_image_source` | `prebuilt` | Seerr ne prend en charge que l'image officielle ; `Seerr_Common` la code également en dur en interne. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Voir §6 ci-dessous — `max_instance_count = 5` est une valeur par défaut plus souple que ce que le modèle de paramètres à rédacteur unique de Seerr suggérerait. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry (évite les limites de débit de GHCR). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Bucket supplémentaire, distinct du bucket `storage` automatique. |
| `gcs_volumes` | `[]` | Le montage du bucket `storage` à `/app/config` est ajouté automatiquement ; utilisez ceci uniquement pour des volumes *supplémentaires*. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Requis — Seerr n'a pas de chemin non-Postgres. |
| `db_name` / `db_user` | `seerr` / `seerr` | Transféré à `Seerr_Common`, injecté comme `DB_NAME`/`DB_USER`. |
| `db_password_env_var_name` | `DB_PASS` | **Critique** — la source de données de Seerr lit spécifiquement `DB_PASS`, pas la valeur par défaut `DB_PASSWORD` de la Fondation. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Vide et reste généralement ainsi — `dbConnection.runMigrations()` s'exécute à chaque démarrage à l'intérieur de l'application elle-même. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` (via `Seerr_Common`) | Point de terminaison de statut JSON `200` non authentifié ; la valeur par défaut `variables.tf` de la variante (HTTP `/`) est remplacée par la valeur par défaut plus précise de `Seerr_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom et URL du service Cloud Run. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Identifiants de l'instance Cloud SQL et de la base de données Seerr. |
| `storage_buckets` | Le bucket `storage` supportant `/app/config`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide pour Seerr). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement `DB_TYPE` | Laissez la valeur par défaut de `Seerr_Common` (`postgres`) inchangée | **Critique** | Une variable `DB_TYPE` manquante/écrasée fait basculer silencieusement Seerr sur un fichier SQLite par conteneur effacé à chaque redémarrage — l'application semble saine, mais rien ne persiste. |
| `db_password_env_var_name` | Laissez à `DB_PASS` | **Critique** | La source de données TypeORM de Seerr ne lit que `DB_PASS` ; la valeur par défaut `DB_PASSWORD` de la Fondation seule n'est jamais lue, et l'application ne peut pas s'authentifier auprès de Postgres. |
| `max_instance_count` | Définissez `1` si les modifications de paramètres (configuration du serveur multimédia, curseurs de découverte, agents de notification) ne doivent jamais entrer en conflit | Moyen | `settings.json` est un fichier unique mutable, pas une base de données transactionnelle — des rédacteurs concurrents de plusieurs instances risquent une écriture perdue. La valeur par défaut du module est `5`, plus souple que la valeur sécurisée pour un seul rédacteur. |
| `gcs_volumes` / stockage à `/app/config` | Laissez le montage automatique `storage` en place | **Critique** | La suppression ou la mauvaise configuration de ce volume entraîne la perte de tous les paramètres au niveau de l'application (serveurs multimédias, curseurs, agents de notification) au prochain démarrage à froid, même si les données Postgres sont intactes. |
| Chemin de sonde | Laissez à `/api/v1/status` | Élevé | Un chemin de sonde authentifié ou inexistant laisserait la révision en permanence non saine même si l'application a démarré correctement. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Seerr partagée avec la variante GKE est décrite
dans **[Seerr_Common](Seerr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Seerr sur Cloud Run](../labs/Seerr_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Seerr sur GKE Autopilot](Seerr_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Seerr Common — Configuration d'application partagée](Seerr_Common.md) — la configuration partagée par les deux cibles de déploiement.
