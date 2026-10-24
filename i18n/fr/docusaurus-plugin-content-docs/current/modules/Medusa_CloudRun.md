---
title: "Medusa sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Medusa sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Medusa_CloudRun.md @ e69407af sha256:375125ff2e5a -->

# Medusa sur Google Cloud Run {#medusa-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Medusa_CloudRun.png" alt="Medusa sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

## 1. Introduction {#1-introduction}

**La chose la plus importante à savoir sur ce module : Medusa n'a pas
d'image Docker officielle, donc `Medusa_CloudRun` en construit une à partir du code source à chaque
déploiement.** Tous les autres modules d'application de ce catalogue encapsulent une image
pré-construite en amont ; celui-ci, en revanche, utilise Cloud Build pour cloner le
modèle de monorepo `medusajs/dtc-starter` (seul `apps/backend` — le serveur Medusa
plus son interface d'administration intégrée, même processus et port — est construit ; le
Next.js `apps/storefront` séparé est explicitement hors de portée) et exécute `medusa
build` à l'intérieur d'un Dockerfile multi-étapes. Attendez-vous à un vrai `git clone` + `pnpm
install` + `medusa build` à chaque construction d'image — prévoyez environ 10 minutes pour
l'étape de construction seule, en dehors du provisionnement Cloud SQL et du temps d'exécution du job
d'initialisation.

Medusa est une plateforme e-commerce open-source et headless — une alternative API-first
à Shopify Plus/Saleor avec un contrôle programmatique complet sur les
produits, les paniers, les commandes, les clients et les paiements, ainsi qu'une interface d'administration intégrée
servie par le même processus serveur. Ce module déploie Medusa sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Medusa et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à chaque application Cloud Run — identité de service, ingress
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
Autorisation Binaire, Contrôles de Service VPC, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Medusa sur RAD, et comment cela se compare {#what-medusa-costs-on-rad-and-how-that-compares}

**L'exécution de Medusa dans votre propre projet GCP coûte environ 90,17 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support -- pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas -- voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits au fur et à mesure de l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~90,17 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~41 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (chaud) | 19,72 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **90,17 $** |

### Comment cela se compare {#how-it-compares}

- Le cloud géré officiel de Medusa (Medusa Cloud) commence à **29 $/mois** pour son plan d'entrée Develop, passant à 99 $/mois (Launch, ajoute l'autoscaling et les sauvegardes) et 299 $/mois (Scale) (source : https://medusajs.com/pricing/), géré par le projet lui-même sans infrastructure à opérer -- la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces -- Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** -- plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous -- mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un backend de vitrine de production, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module -- et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet
-- la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une :
l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet
et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer
que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes -- c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US)
au total pour une chaîne de déploiement typique de 2-3.

Ce que cela nécessite : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours -- après cela, Google le supprime définitivement -- et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez
le projet -- même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé
l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors
du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative
est de supprimer Medusa purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus
les builds — environ 175 + 3-6 crédits de temps de build.

La suppression permet d'économiser de l'argent seulement si Medusa devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela
représente environ 6 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM de fichier/cache partagée ; elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
  par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://medusajs.com/pricing/ pour le prix du concurrent nommé.

## 2. Vue d'ensemble {#2-overview}

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js (construit à partir du code source), 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; `min_instance_count = 1` par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Medusa ne prend pas en charge MySQL ou d'autres moteurs |
| Cache et workflows en arrière-plan | Redis (**requis**) | Session/cache/bus d'événements/moteur de workflow/verrouillage ; pas de solution de secours de production prise en charge |
| Stockage d'objets (facultatif) | Cloud Storage | Désactivé par défaut (`enable_gcs_storage = false`) ; lorsqu'il est activé, un bucket + un compte de service dédié + une clé HMAC auto-générée sont provisionnés |
| Secrets | Secret Manager | `JWT_SECRET`, `COOKIE_SECRET`, mot de passe administrateur auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Build | Cloud Build | Clone `medusajs/dtc-starter`, exécute `medusa build` — aucune image pré-construite n'existe pour être tirée à la place |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur interrompt le démarrage.
- **Redis est requis, et non facultatif, en production.** `enable_redis = true` par
  défaut. Medusa enregistre `"redisUrl not found. A fake redis instance will be
  used."` et démarre quand même si Redis est inaccessible — c'est une solution de secours pour le développement/test, pas un mode de production pris en charge.
- **`container_port = 9000`** — le port par défaut documenté de Medusa, servant à la fois
  l'API REST et l'interface d'administration.
- **`container_image_source = "custom"` ne peut pas être changé en `"prebuilt"`
  de manière significative** — il n'y a pas d'image Medusa pré-construite à déployer à la place.
- **Le temps de build est réel et distinct du temps de déploiement.** L'étape Cloud Build
  est allouée jusqu'à 30 minutes (`timeout: 1800s` dans la référence
  `cloudbuild.yaml`) bien qu'un build typique — clone, `pnpm install`, `medusa
  build` — se termine en environ 10 minutes. Ceci s'ajoute au
  provisionnement normal de Cloud SQL (20 à 35 minutes lors d'un premier déploiement) et aux quatre
  exécutions de jobs d'initialisation qui suivent.
- **Une chaîne d'initialisation en quatre étapes s'exécute avant que le service ne soit considéré
  prêt** : `db-init` → `medusa-migrate` → `medusa-verify` →
  `medusa-admin-create`, chacune dépendant de la précédente.
- **`MEDUSA_WORKER_MODE = "shared"`** — une seule instance Cloud Run gère
  à la fois les requêtes API et les jobs/abonnés/workflows en arrière-plan de Medusa, car
  la topologie serveur/worker divisée officiellement recommandée par Medusa ne correspond pas
  à un seul service Cloud Run.
- **`enable_gcs_storage = false` par défaut.** Medusa utilise le stockage local,
  éphémère du système de fichiers du conteneur pour les fichiers téléchargés jusqu'à ce que vous l'activiez.
- **`application_version` ne fixe pas ce qui est construit.** Le Dockerfile n'a
  pas de `ARG` le consommant — seul `MEDUSA_STARTER_REF` (codé en dur à `main` dans
  `Medusa_Common`) contrôle quelle branche `dtc-starter` est clonée.

---

## 3. Services Google Cloud et comment les explorer {#3-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources
sont rapportés dans les [Sorties](#6-outputs) du déploiement.

### A. Cloud Run — le service Medusa {#a-cloud-run--the-medusa-service}

Medusa s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre
le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable.

```bash
gcloud run services list --project "$PROJECT" --region "$REGION"
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud Build — la construction d'image à partir du code source {#b-cloud-build--the-from-source-image-build}

Chaque déploiement (et chaque reconstruction déclenchée par une modification de la configuration de build du module
Application) exécute un véritable build : `git clone --depth 1 --branch main
https://github.com/medusajs/dtc-starter.git`, `pnpm install`, `pnpm build`
à l'intérieur de `apps/backend`, puis un second `pnpm install --prod` en dehors de l'espace de travail pnpm
avant que l'image d'exécution ne soit assemblée.

```bash
gcloud builds list --project "$PROJECT" --limit 5
gcloud builds log <build-id> --project "$PROJECT"
```

### C. Cloud SQL pour PostgreSQL 15 {#c-cloud-sql-for-postgresql-15}

Medusa stocke toutes les données d'application (produits, commandes, clients, paniers,
inventaire) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service
se connecte en privé via le **proxy d'authentification Cloud SQL** sur un socket Unix par
défaut (`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée.

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql instances describe <instance-name> --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#6-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### D. Redis {#d-redis}

Redis est **activé par défaut**. Lorsque `redis_host` est laissé vide, l'IP de la VM NFS de la plateforme est utilisée comme hôte Redis de secours (nécessite `enable_nfs = true` ou un serveur NFS géré par `Services_GCP` découvert) ; sinon, définissez `redis_host` explicitement.

```bash
redis-cli -h <redis-host> ping
# Confirm the resolved REDIS_URL in the running revision's logs (constructed
# by entrypoint.sh at boot):
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 | grep -i redis
```

### E. Cloud Storage (facultatif) {#e-cloud-storage-optional}

Provisionné uniquement lorsque `enable_gcs_storage = true`. Contrairement à de nombreuses applications de ce
catalogue, aucune configuration manuelle de clé HMAC n'est requise — `Medusa_Common` génère
automatiquement un compte de service dédié et une paire clé d'accès/clé secrète.

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://gcs-<service-name>-storage/
```

### F. Secret Manager {#f-secret-manager}

`JWT_SECRET`, `COOKIE_SECRET` et le mot de passe administrateur initialisé sont
générés automatiquement. Le mot de passe de la base de données est géré séparément par la
fondation.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~medusa"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

Voir [App_CloudRun](App_CloudRun.md) pour les tests de disponibilité et les politiques d'alerte.

---

## 4. Comportement de l'application Medusa {#4-medusa-application-behaviour}

### La chaîne d'initialisation en quatre étapes {#the-four-stage-initialization-chain}

1. **`db-init`** (`postgres:15-alpine`) — attend la base de données, crée le
   rôle d'application et la base de données, accorde les privilèges sur `public`, et
   installe au mieux les extensions `uuid-ossp`/`postgis`.
2. **`medusa-migrate`** — exécute `npx medusa db:migrate` sur l'image construite (2
   vCPU / 2 Gio, jusqu'à 30 minutes, 3 tentatives).
3. **`medusa-verify`** — un job de garde qui se connecte après `medusa-migrate` et
   **échoue l'apply** si le schéma `public` a zéro table. Ceci existe
   parce que cette Fondation **ne** fait **pas** échouer l'apply du module lorsqu'un job d'initialisation
   échoue seul — sans `medusa-verify`, une migration en concurrence ou échouée
   pourrait silencieusement livrer un service Cloud Run d'apparence saine pointant vers une
   base de données **vide**, et chaque requête échouerait alors en raison de tables manquantes
   sans signal évident au moment du déploiement. Vérifié en direct : `"public schema has 146 table(s)"` enregistré
   lors d'un déploiement réussi.
4. **`medusa-admin-create`** — exécute `npx medusa user -e <email> -p <password>`
   pour créer le premier identifiant administrateur, en utilisant `admin_email` (par défaut
   `admin@techequity.cloud`) et le secret du mot de passe administrateur auto-généré.
   Vérifié en direct : `"User created successfully."` enregistré.

```bash
gcloud run jobs list --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
```

### Point de terminaison de santé {#health-endpoint}

`/health` n'est pas authentifié et est utilisé à la fois par la sonde de démarrage (délai initial de 120 secondes, 40 × 15 secondes de tentatives — environ 12 minutes au total) et la sonde de vivacité (délai initial de 30 secondes, 3 tentatives). Vérifié en direct : `curl
/health` renvoie `OK` avec HTTP 200.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
```

### `MEDUSA_WORKER_MODE = "shared"` {#medusa_worker_mode--shared}

Une seule instance Cloud Run exécute à la fois le serveur API et les jobs/abonnés/workflows en arrière-plan de Medusa — la topologie serveur/worker divisée officiellement recommandée par Medusa ne correspond pas à un seul service Cloud Run, donc ce module s'exécute toujours en mode partagé. En pratique : chaque instance en cours d'exécution gère à la fois les requêtes et tout travail en arrière-plan que le moteur de workflow de Medusa planifie.

### Récupération des identifiants administrateur de première exécution {#retrieving-the-first-run-admin-credentials}

```bash
ADMIN_SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~medusa-admin-password" --format="value(name)")
gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project "$PROJECT"
```

L'e-mail de l'administrateur est celui qui a été défini pour `admin_email` au moment du déploiement (par défaut
`admin@techequity.cloud`).

### Accéder à l'interface d'administration intégrée {#accessing-the-built-in-admin-ui}

Medusa sert son interface d'administration à partir du même processus et du même port que l'API — ouvrez
`$SERVICE_URL/app` dans un navigateur et connectez-vous avec l'e-mail/mot de passe récupérés
ci-dessus.

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Medusa sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `medusa` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `admin_email` | `admin@techequity.cloud` | E-mail du premier utilisateur administrateur créé par `medusa-admin-create`. |
| `application_version` | `latest` | Balise de suivi de déploiement uniquement. **Ne sélectionne pas ce qui est construit** — le Dockerfile n'a pas de `ARG` le consommant ; seul `MEDUSA_STARTER_REF` (fixé à `main`) détermine le code cloné. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de ressources par instance. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Bornes d'instance. |
| `container_port` | `9000` | Port par défaut documenté de Medusa. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. Envisagez `true` si vous comptez sur les workflows planifiés/pilotés par événements de Medusa — le mode worker partagé les traite dans la même instance, et la facturation basée sur les requêtes limite le CPU entre les requêtes entrantes. |
| `container_image_source` | `custom` | Toujours construit à partir du code source — il n'y a pas d'image Medusa `"prebuilt"`. |
| `enable_cloudsql_volume` | `true` | Socket Unix du proxy d'authentification Cloud SQL. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Medusa_Common` ; MySQL n'est pas pris en charge. |
| `db_name` / `db_user` | `medusa` / `medusa` | Nom de la base de données / utilisateur de l'application. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisionne un bucket GCS + une clé HMAC auto-générée pour le fournisseur de fichiers compatible S3 de Medusa. Lorsque `false`, les téléchargements utilisent le stockage local et éphémère du conteneur. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis en production. |
| `redis_host` | `""` | Vide utilise l'IP de la VM NFS de la plateforme comme solution de secours (nécessite `enable_nfs = true`) ; sinon, définissez explicitement. |
| `redis_port` / `redis_auth` | `"6379"` / `""` | Port Redis / mot de passe d'authentification (sensible). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 120s, seuil de 40 échecs | Fenêtre totale d'environ 12 minutes. |
| `liveness_probe` | HTTP `/health`, délai de 30s, seuil de 3 échecs | |

Pour tous les autres groupes (CI/CD, sauvegarde, IAM, VPC-SC, équilibreur de charge/CDN, etc.),
voir [App_CloudRun](App_CloudRun.md) — Medusa hérite du comportement standard de la Fondation
sans aucune surcharge spécifique à l'application.

---

## 6. Sorties {#6-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés — vide sauf si `enable_gcs_storage = true`. |
| `container_image` / `container_registry` | L'image Medusa produite par Cloud Build et son dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des quatre jobs d'initialisation créés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` / `artifact_registry_repository` | État et détails du CI/CD. |
| `vpc_sc_enabled` / `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Indicateurs de posture de sécurité. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs et les combinaisons au moment de la planification. Une configuration invalide fait échouer
> le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Build à partir du code source (`container_image_source = "custom"`) | Aucune action nécessaire — c'est le seul mode valide | Élevé | Toute modification du Dockerfile, de `entrypoint.sh` ou des arguments de build dans `Medusa_Common` nécessite une véritable reconstruction Cloud Build (environ 10 minutes pour l'étape de build seule) avant de prendre effet — il n'y a aucun moyen de "simplement redémarrer" sur une nouvelle source, contrairement aux applications à build personnalisé dont l'image de base existe déjà. Forcez une reconstruction avec `tofu taint 'module.medusa_app.module.app_build.null_resource.build_and_push_application_image[0]'` si le déclencheur de hachage de contenu manque une modification. |
| `enable_redis` | `true` | Critique | Medusa enregistre `"redisUrl not found. A fake redis instance will be used."` et démarre quand même — ce message de journal d'apparence gracieuse est une solution de secours pour le développement/test, pas un mode de production pris en charge. Le cache/session/bus d'événements/moteur de workflow/verrouillage dépendent tous de Redis ; le désactiver dans un déploiement de production à long terme n'est pas pris en charge. |
| Job d'initialisation `medusa-verify` | Laisser dans la chaîne par défaut | Critique | Ce job existe spécifiquement parce qu'un échec de job d'initialisation **ne** fait **pas** échouer l'apply du module dans cette Fondation. Le supprimer (en surchargeant `initialization_jobs`) rouvre le risque exact de base de données vide silencieuse qu'il a été ajouté pour fermer — une migration en concurrence ou échouée `medusa-migrate` livrerait autrement un service "déployé avec succès" contre un schéma `public` vide, et chaque requête échouerait sans signal évident au moment du déploiement. |
| Isolation de l'espace de travail pnpm (leçon pour étendre ce modèle de Dockerfile) | N/A — informatif | Élevé | Si vous clonez ce modèle à partir du code source pour une autre application basée sur pnpm/npm-workspace, rappelez-vous que la sortie de build produite *à l'intérieur* d'un monorepo cloné est toujours imbriquée sous le `pnpm-workspace.yaml` de ce monorepo. L'exécution de `pnpm install --prod` directement sur cette sortie la réinstalle silencieusement dans le cadre de l'espace de travail externe et peut écrire **zéro** `node_modules` — confirmé ici comme `sh: medusa: not found` au moment de l'exécution. Copiez toujours la sortie de build autonome dans un répertoire sans ancêtre `pnpm-workspace.yaml` avant d'installer ses dépendances de production. |
| `admin_email` / mot de passe administrateur initialisé | Récupérer de Secret Manager après le déploiement | Élevé | Il n'y a pas d'identifiant administrateur pré-rempli visible nulle part sauf Secret Manager (sortie `admin_password_secret_id`) — perdre sa trace signifie récupérer l'accès via `npx medusa user` manuellement contre la base de données en cours d'exécution. |
| `MEDUSA_WORKER_MODE = "shared"` + `cpu_always_allocated = false` (par défaut) | Définir `cpu_always_allocated = true` si vous comptez sur des workflows planifiés/pilotés par événements | Moyen | Le mode worker partagé traite les workflows/abonnés en arrière-plan dans la *même* instance qui sert les requêtes HTTP. La facturation basée sur les requêtes (par défaut) limite le CPU à près de zéro entre les requêtes entrantes, ce qui peut bloquer le travail en arrière-plan en cours — la même classe de problème documentée à l'échelle de la flotte pour les applications de type n8n/OpenClaw dans ce catalogue. |
| `application_version` | Comprendre que ce n'est que des métadonnées | Faible | Le modifier ne fixe ni ne modifie le code construit ; seul `MEDUSA_STARTER_REF` (fixé à `main`) contrôle la branche `dtc-starter` clonée. Un build épinglé entièrement reproductible nécessite de surcharger `container_build_config.build_args`. |
| `enable_gcs_storage = false` (par défaut) | L'activer pour tout cas d'utilisation de téléchargement persistant | Moyen | Le stockage local est un système de fichiers de conteneur éphémère — les images/fichiers de produits téléchargés ne survivent pas à un redémarrage, un redéploiement ou un démarrage à froid avec mise à l'échelle à zéro. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Autorisation Binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Medusa
partagée avec la variante GKE est décrite dans **[Medusa_Common](Medusa_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Medusa sur Cloud Run](../labs/Medusa_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Medusa sur GKE Autopilot](Medusa_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Medusa Common — Configuration d'application partagée](Medusa_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Payload CMS sur Google Cloud Run](Payload_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **E-commerce Storefront**.
