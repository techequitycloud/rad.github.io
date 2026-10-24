---
title: "Shlink sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Shlink sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Shlink_CloudRun.md @ 1665a43e sha256:08ef50eed5d8 -->

# Shlink sur Google Cloud Run {#shlink-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Shlink_CloudRun.png" alt="Shlink sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Shlink est un raccourcisseur d'URL auto-hébergé et open source avec des analyses de visites détaillées, la génération de codes QR et une API REST complète. Ce module déploie Shlink sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Shlink et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Shlink sur RAD, et comment cela se compare {#what-shlink-costs-on-rad-and-how-that-compares}

**L'exécution de Shlink dans votre propre projet GCP coûte environ 67,80 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~67,80 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~26 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **67,80 $** |

### Comment cela se compare {#how-it-compares}

- L'empreinte propre de Shlink ici (1x vCPU / 0,5 GiB) est plus petite que cette classe de référence, donc un niveau de VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Un raccourcisseur d'URL répond à des redirections simples de manière continue mais peu coûteuse — la base de données est le principal coût fixe ici, pas le service de raccourcisseur lui-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD commence par délier sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Shlink purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Shlink reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 4 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conservez les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Shlink s'exécute en tant que conteneur PHP (RoadRunner) sur Cloud Run v2. Le déploiement relie un ensemble délibérément restreint de services Google Cloud — Shlink conserve **tout** son état dans PostgreSQL, il n'y a donc pas de partage NFS ou de bucket de stockage d'objets à gérer :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 512 Mio par défaut, scale-to-zero (`min_instance_count = 0`) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — contient les URL courtes, les visites, les tags et les clés API |
| Connectivité DB | Proxy d'authentification Cloud SQL (socket Unix) | `enable_cloudsql_volume = true` ; socket compatible libpq, pas d'IP publique |
| Secrets | Secret Manager | Mot de passe de la base de données + `INITIAL_API_KEY` auto-généré |
| Cache / verrous | Redis (facultatif) | Désactivé par défaut ; utile uniquement pour la mise en cache/verrouillage multi-instances |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, LB HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur pris en charge** (`database_type = "POSTGRES_15"`, `DB_DRIVER = "postgres"`). Shlink se connecte via le socket Unix du proxy d'authentification Cloud SQL — libpq accepte le répertoire du socket comme hôte, donc aucune configuration TCP/SSL n'est nécessaire.
- **`DB_USER` / `DB_NAME` sont injectés par la fondation** avec des noms limités au locataire et délibérément *non* définis par le module — le job `db-init` crée le même utilisateur et la même base de données, donc tout s'aligne automatiquement.
- **`INITIAL_API_KEY` est auto-généré** (32 caractères), stocké dans Secret Manager et injecté comme variable d'environnement secrète. Shlink le lit au premier démarrage pour amorcer sa première clé API REST — vous ne créez jamais de clé manuellement.
- **Les migrations s'exécutent automatiquement au démarrage du conteneur.** L'image officielle gère l'installation et les mises à niveau du schéma ; aucune étape de migration séparée n'existe.
- **Mise à l'échelle à zéro par défaut.** Shlink est une application requête/réponse sans état (redirections + API REST) ; elle ne coûte rien lorsqu'elle est inactive. Le compromis est un démarrage à froid d'environ 5 à 15 s lors de la première requête après l'inactivité.
- **Les sondes de santé ciblent `/rest/health`** — un point de terminaison public, non authentifié, qui renvoie HTTP 200 avec `{"status":"pass"}`. Shlink n'a **pas de page d'accueil web** ; `/` renvoie 404 par conception.
- **`DEFAULT_DOMAIN` est laissé vide** car l'URL `run.app` n'est pas connue avant le déploiement — définissez-la après le déploiement afin que les URL courtes générées utilisent le bon hôte. `IS_HTTPS_ENABLED=true` est prédéfini.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager, injecté comme `DB_PASSWORD`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Shlink {#a-cloud-run--the-shlink-service}

Shlink s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre le nombre minimal (0) et maximal (3) d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Shlink stocke tout — URL courtes, enregistrements de visites, tags, domaines et clés API — dans une instance Cloud SQL gérée pour PostgreSQL 15. Le service se connecte en privé via le **proxy d'authentification Cloud SQL** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont gérés automatiquement : le **mot de passe de la base de données** (créé par la fondation, injecté comme `DB_PASSWORD`) et la **clé API initiale** (créée par `Shlink_Common`, injectée comme `INITIAL_API_KEY`). Le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~shlink"
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~shlink AND name~initial-api-key' --format='value(name)' --limit=1)" \
    --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Redis (facultatif) {#d-redis-optional}

Shlink peut utiliser Redis pour la mise en cache et les verrous distribués — ce qui n'est utile que lors de l'exécution de plusieurs instances simultanément. Il est **désactivé par défaut** (`enable_redis = false`) ; un déploiement `max_instance_count` à un seul chiffre fonctionne très bien sans.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé (l'option naturelle pour un domaine court de marque tel que `s.example.com`), Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring. Un test de disponibilité contre `/rest/health` est provisionné par défaut, avec une alerte d'échec de test câblée à `support_users`.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tests de disponibilité / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Shlink {#3-shlink-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (image `postgres:15-alpine`) se connecte à Cloud SQL via le socket du proxy d'authentification et crée de manière idempotente l'utilisateur et la base de données de l'application, accorde les privilèges (y compris `GRANT <user> TO postgres` afin que la propriété puisse être définie), et signale au sidecar du proxy de s'arrêter afin que le job se termine. Le job s'exécute à chaque apply et peut être relancé en toute sécurité.
- **Migrations au démarrage.** L'image officielle de Shlink exécute ses migrations de base de données automatiquement à chaque démarrage de conteneur — le premier démarrage installe le schéma, les mises à niveau appliquent les modifications de schéma sans étape manuelle. La sonde de démarrage autorise jusqu'à ~300 s (`failure_threshold = 30` × 10 s) pour les migrations du premier démarrage.
- **API-first — pas de page d'accueil.** Shlink est un serveur sans tête : `/` renvoie **404 par conception**. Tout est piloté via l'API REST (`/rest/v3/...`) en utilisant l'en-tête `X-Api-Key`, ou via une interface utilisateur [shlink-web-client](https://app.shlink.io/) hébergée séparément et pointant vers ce serveur.
- **Accès à la première exécution.** Récupérez la clé API de démarrage de Secret Manager (voir §2C) et utilisez-la immédiatement :
  ```bash
  API_KEY=$(gcloud secrets versions access latest --secret=<initial-api-key-secret> --project "$PROJECT")
  curl -s -X POST "<service-url>/rest/v3/short-urls" \
    -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
    -d '{"longUrl": "https://cloud.google.com/run"}'
  ```
- **`DEFAULT_DOMAIN` après le déploiement.** Shlink intègre son hôte public dans chaque URL courte générée. L'URL du service est inconnue au moment de la planification, donc `DEFAULT_DOMAIN` est vide — définissez-le (via l'entrée `environment_variables` lors d'une mise à jour) sur le nom d'hôte `run.app` ou votre domaine court personnalisé une fois connu.
- **La géolocalisation est optionnelle.** La géolocalisation des visites nécessite une licence MaxMind GeoLite2 : définissez `GEOLITE_LICENSE_KEY` dans `environment_variables`. Sans cela, les visites sont toujours enregistrées — mais pas géolocalisées.
- **Contraintes de mise à l'échelle.** Les instances sont sans état (tout l'état est dans PostgreSQL), donc la mise à l'échelle est sûre. Si vous augmentez `max_instance_count` bien au-delà du défaut 3 et que vous comptez sur les compteurs/verrous mis en cache de Shlink, activez Redis (`enable_redis = true`).
- **Vérification de la santé :**
  ```bash
  curl -s "<service-url>/rest/health"
  # {"status":"pass","version":"...","links":{...}}
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Shlink sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `shlink` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Shlink` | Nom convivial affiché dans la console. |
| `application_version` | `stable` | Tag de version de l'image Shlink (par exemple `4.4.0`) ; incrémenter pour déclencher un nouveau build. |
| `admin_username` | `shlink` | **Non utilisé par Shlink** (il s'authentifie avec des clés API, pas des comptes administrateur). Conservé pour la parité de l'interface. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance — 1 vCPU gère confortablement les redirections et les appels API. |
| `memory_limit` | `512Mi` | Mémoire par instance (minimum gen2). |
| `min_instance_count` | `0` | **Mise à l'échelle à zéro.** Ne coûte rien à l'arrêt ; la première requête après l'arrêt prend un démarrage à froid d'environ 5 à 15 s. Définissez `1` pour les liens sensibles à la latence. |
| `max_instance_count` | `3` | Nombre maximal d'instances. Activez Redis avant d'augmenter significativement cette valeur. |
| `container_port` | `8080` | Port HTTP natif de Shlink. |
| `enable_cloudsql_volume` | `true` | Socket Unix du proxy d'authentification Cloud SQL — la connexion compatible libpq que Shlink attend. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `execution_environment` | `gen2` | Cloud Run gen2 (recommandé). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair. Options Shlink notables : `DEFAULT_DOMAIN` (hôte public d'URL courte — à définir après le déploiement), `GEOLITE_LICENSE_KEY` (clé MaxMind pour la géolocalisation des visites). `DB_DRIVER=postgres`, `DB_PORT=5432`, `IS_HTTPS_ENABLED=true` sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires. `DB_PASSWORD` et `INITIAL_API_KEY` sont câblées automatiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Contrôle d'accès et d'ingress {#group-6--access--ingress-control}

Entrées IAP / ingress / egress VPC standard (`enable_iap`, `ingress_settings`, `vpc_egress_setting`). Notez que les points de terminaison de redirection d'un raccourcisseur doivent rester accessibles publiquement — IAP devant Shlink protège également chaque lien court. Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7 à 10 — Sauvegarde, CI/CD, SQL personnalisé, Domaine et CDN {#groups-710--backup-cicd-custom-sql-domain--cdn}

Comportement standard d'App_CloudRun (`backup_schedule`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_custom_sql_scripts`, `application_domains`, `enable_cdn`, `enable_cloud_armor`, entrées de rétention d'image). `application_domains` est l'endroit où un domaine court de marque est attaché. Toutes les entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Shlink stocke toutes les données dans PostgreSQL — aucun système de fichiers partagé n'est nécessaire. |
| `create_cloud_storage` / `gcs_volumes` | off / `[]` | Aucun bucket n'est provisionné ; Shlink n'en a pas besoin. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Moteur Cloud SQL pris en charge par Shlink ici — ne pas modifier. |
| `db_name` | `shlink` | Nom de base de données (préfixé par le locataire par la fondation). Immuable après le premier déploiement. |
| `db_user` | `shlink` | Utilisateur de base de l'application (préfixé par le locataire). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_password_env_var_name` | `DB_PASSWORD` | Prédéfini — Shlink lit `DB_PASSWORD` directement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/rest/health`, délai initial de 30 s, `failure_threshold = 30` | Permet jusqu'à ~300 s pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/rest/health`, délai de 30 s, période de 30 s | `/rest/health` n'est pas authentifié, donc la vivacité reste activée. |
| `uptime_check_config` | désactivé, chemin `/rest/health` | Test de disponibilité Cloud Monitoring + alerte d'échec. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Mise en cache/verrouillage facultatif pour les configurations multi-instances ; inutile à l'échelle par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Détails du point de terminaison Redis lorsqu'il est activé. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Comportement standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging`).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `health_check_url` | `<api_url>/rest/health` — utilisez curl pour confirmer que le déploiement est actif (Shlink n'a pas de page d'accueil ; `/` renvoie 404). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (étendue au locataire). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Shlink n'en a pas besoin). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Shlink est configuré pour PostgreSQL ici (`DB_DRIVER=postgres`) ; un autre moteur interrompt le démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les URL courtes et les données de visite. |
| `environment_variables` `DB_USER` / `DB_NAME` | jamais défini manuellement | Critique | Remplace les noms du locataire de la fondation → `password authentication failed for user "shlink"`. Laissez-les non définis. |
| `container_port` | `8080` | Critique | Port natif de Shlink ; une non-concordance échoue toutes les sondes de santé. |
| `enable_cloudsql_volume` | `true` | Critique | Shlink attend le socket Unix du proxy d'authentification ; le désactiver interrompt le chemin de connexion à la base de données. |
| sonde / disponibilité `path` | `/rest/health` | Élevé | `/` renvoie **404 par conception** — le sonder tue les révisions saines. |
| `startup_probe` failure_threshold | `30` | Élevé | Le réduire peut tuer le conteneur avant la fin des migrations au premier démarrage. |
| `DEFAULT_DOMAIN` | défini après le déploiement | Élevé | Laissé vide, les URL courtes générées peuvent avoir le mauvais hôte ; définissez-le sur le `run.app` ou le domaine personnalisé. |
| `enable_iap` | `false` pour les liens publics | Élevé | IAP devant Shlink protège chaque redirection de lien court derrière la connexion Google. |
| `max_instance_count` sans Redis | `3` | Moyen | De nombreuses instances sans Redis perdent la mise en cache/le verrouillage partagés ; activez `enable_redis` avant de mettre à l'échelle. |
| `min_instance_count` | `0` (par défaut) ou `1` | Moyen | `0` est presque gratuit mais ajoute un démarrage à froid d'environ 5 à 15 s à la première redirection après l'inactivité. |
| `GEOLITE_LICENSE_KEY` | défini si l'analyse est importante | Faible | Sans cela, les visites sont enregistrées mais non géolocalisées. |
| `enable_nfs` / `create_cloud_storage` | `false` / off | Faible | Coût gaspillé — Shlink conserve tout l'état dans PostgreSQL. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Shlink partagée avec la variante GKE est décrite dans **[Shlink_Common](Shlink_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Shlink sur Cloud Run](../labs/Shlink_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Shlink sur GKE Autopilot](Shlink_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Shlink Common — Configuration d'application partagée](Shlink_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
