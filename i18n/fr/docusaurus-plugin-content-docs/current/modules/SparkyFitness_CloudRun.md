---
title: "SparkyFitness sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de SparkyFitness sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SparkyFitness_CloudRun.md @ e69407af sha256:b9e676d0a721 -->

# SparkyFitness sur Google Cloud Run {#sparkyfitness-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SparkyFitness_CloudRun.png" alt="SparkyFitness sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SparkyFitness est un outil auto-hébergé, assisté par l'IA, de suivi familial de
l'alimentation, de la forme physique, de l'eau et de la santé, construit comme un
backend Node.js/Express (`codewithcj/sparkyfitness_server`) avec un frontend React
séparé servi par nginx (`codewithcj/sparkyfitness`). Ce module déploie
SparkyFitness sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par SparkyFitness et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte SparkyFitness sur RAD et comment cela se compare {#what-sparkyfitness-costs-on-rad-and-how-that-compares}

**L'exécution de SparkyFitness dans votre propre projet GCP coûte environ 82,03 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support -- pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas -- voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~82,03 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (scaleToZero) | 11,58 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **82,03 $** |

### Comment cela se compare {#how-it-compares}

- L'empreinte propre de SparkyFitness ici (1x vCPU / 1 Gio) est plus petite que cette classe de référence, donc un niveau de VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** -- plus le temps d'administration pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous -- mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- SparkyFitness est utilisé par une poignée de personnes quelques fois par jour, pas un service continuellement chargé, donc le coût d'exécution ci-dessous est ce qui génère réellement la facture -- pas les frais de module.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement -- la suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL,
aucune VM ou la ressource de calcul une par une : le projet entier s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de facturation,
puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer
que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à
jour trouve les mêmes ressources déjà présentes -- c'est une vérification, pas une
reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau.
Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours --
après cela, Google le supprime définitivement -- et la restauration est admise
comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés
doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
adapté à la plupart des utilisations d'étude/démo). Google affirme que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

**Une lacune réelle :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet -- même si le projet lui-même est récupérable pendant 30 jours.
Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant
de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a
pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer SparkyFitness purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si SparkyFitness reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

SparkyFitness s'exécute sous la forme de **deux conteneurs dans un seul service
Cloud Run multi-conteneurs** — une contrainte de plateforme réelle, pas un choix
stylistique. La configuration nginx de l'image frontend en amont code en dur une
cible de proxy inverse simple `http://` (`proxy_pass http://${SPARKY_FITNESS_SERVER_HOST}:${SPARKY_FITNESS_SERVER_PORT}`),
qui ne peut pas atteindre l'URL publique HTTPS uniquement d'un service Cloud Run
*séparé*. Donc :

- Le **frontend** (nginx, port 80) est le **conteneur principal (ingress)** — il
  reçoit tout le trafic public du navigateur et agit comme proxy inverse pour les
  requêtes `/api`, `/uploads`, `/mcp` et `/health-data`.
- Le **backend** (Node.js, port 3010) s'exécute comme un **sidecar `additional_containers`
  dans le pod**, accessible par le frontend uniquement à `http://127.0.0.1:3010` — HTTP
  loopback simple, exactement ce que la configuration nginx du fournisseur attend.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 (révision multi-conteneurs) | Frontend (ingress, ~0,5 vCPU/512 Mio) + backend (sidecar dans le pod, 1 vCPU/1 Gio par défaut) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — aucun autre moteur n'est pris en charge |
| Secrets | Secret Manager | `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run | URL `run.app` par défaut sur le conteneur frontend ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Aucun autre moteur n'est pris en charge.
- **Deux rôles de base de données, un géré par Terraform.** `db_user` (par défaut `sparky`) est le rôle
  administrateur/migration créé par le job `db-init` ; `app_db_user` (par défaut
  `sparky_app`) est un rôle à privilèges limités que le **backend crée et maintient
  lui-même** à chaque démarrage, en utilisant les identifiants de `db_user` — il n'y a pas de
  ressource Terraform pour cela.
- **Pas de job de migration séparé.** Contrairement à de nombreuses applications de ce catalogue, le
  backend de SparkyFitness exécute ses propres migrations de base de données à chaque démarrage de
  conteneur.
- **L'image du frontend est pré-construite** — `container_image_source = "prebuilt"`, donc la
  Fondation ne construit rien. Le **sidecar du backend est construit par ce module lui-même**
  (`null_resource.build_backend_sidecar` soumet un Cloud Build de
  `SparkyFitness_Common/scripts/Dockerfile` et pousse
  `sparkyfitness-backend:<content-hash>` vers le dépôt Artifact Registry découvert),
  car les sidecars Cloud Run n'obtiennent pas de pipeline de build de la Fondation.
- **Mise à l'échelle à zéro par défaut** (`cpu_always_allocated = false`, `min_instance_count = 0`)
  — une application simple de requête/réponse sans planificateur d'arrière-plan.
- **Les sondes de santé sont réelles, pas devinées.** `GET /api/health` sur le port 3010 est confirmée
  via la directive `HEALTHCHECK` du Dockerfile du backend.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service SparkyFitness {#a-cloud-run--the-sparkyfitness-service}

Un seul service Cloud Run v2 exécute les deux conteneurs dans une seule révision. Le conteneur frontend
est celui qui reçoit le trafic entrant et apparaît dans
`status.url` ; le backend n'est visible que via la spécification de conteneur de la révision.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques. Développez la révision pour voir les deux conteneurs (`sparkyfitness` /
  frontend et `backend`).
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.containers[].name)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

SparkyFitness stocke toutes les données de l'application dans une instance gérée de Cloud SQL pour PostgreSQL 15.
Le sidecar du backend reçoit les détails de connexion via les variables d'environnement
`SPARKY_FITNESS_DB_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` (renommées par rapport aux noms
standards `DB_*` de la Fondation).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Trois secrets cryptographiques sont générés automatiquement :

- **`SPARKY_FITNESS_API_ENCRYPTION_KEY`** — hexadécimal de 64 caractères, chiffre les
  identifiants des sources de données externes stockées.
- **`BETTER_AUTH_SECRET`** — signe les sessions et chiffre les données 2FA/TOTP.
- **`SPARKY_FITNESS_APP_DB_PASSWORD`** — mot de passe pour le rôle `app_db_user`
  auto-réparateur et à privilèges limités.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

### D. Réseau et ingress {#d-networking--ingress}

Le conteneur frontend est accessible à l'URL `run.app` du service par défaut. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés.

```bash
gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

Les journaux du sidecar du backend apparaissent dans le même flux Cloud Logging,
étiquetés avec le nom de son conteneur — filtrez sur `resource.labels.container_name="backend"` pour les isoler.

---

## 3. Comportement de l'application SparkyFitness {#3-sparkyfitness-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un seul job d'initialisation `db-init` (utilisant
  `postgres:15-alpine`) crée le rôle **admin** (`db_user`) et la base de données
  (`db_name`). Il ne crée pas `app_db_user` — le backend le fait lui-même.
- **Les migrations s'exécutent à chaque démarrage.** Le backend applique ses propres migrations de schéma au
  démarrage en utilisant les identifiants admin `db_user` — il n'y a pas de job de migration séparé à
  surveiller.
- **`app_db_user` est auto-réparateur.** Le backend crée ou met à jour ce
  rôle à privilèges limités à chaque démarrage, de sorte qu'il survit à une recréation complète du conteneur
  sans intervention manuelle.
- **Création de compte à la première exécution.** Inscrivez-vous via l'interface web pour créer le premier compte
  utilisateur. Définissez `admin_email` sur l'adresse e-mail de cet utilisateur et redéployez pour accorder les
  privilèges d'administrateur — `SPARKY_FITNESS_ADMIN_EMAIL` n'élève qu'un compte **existant**, il
  n'en crée pas.
- **Désactiver l'inscription après la première utilisation.** Définissez `disable_signup = true` une fois le compte
  administrateur existant, pour empêcher les utilisateurs non authentifiés de s'auto-enregistrer.
- **Chemin de santé.** `GET /api/health` sur le port 3010 (backend) — confirmé via la
  directive `HEALTHCHECK` du Dockerfile en amont, non deviné.
- **Secrets immuables.** `BETTER_AUTH_SECRET` ne doit jamais changer après que les utilisateurs aient activé
  la 2FA (cela les bloque) ; `SPARKY_FITNESS_API_ENCRYPTION_KEY` ne doit jamais changer
  après la connexion de sources de données externes (cela invalide les identifiants chiffrés).
- **Cloud SQL TLS.** Le `SPARKY_FITNESS_DB_HOST` du sidecar du backend se résout toujours
  à l'adresse IP privée brute de Cloud SQL sur Cloud Run (le mécanisme
  `additional_containers`/`inherit_app_env` de cette Fondation utilise toujours l'IP brute,
  quelle que soit `enable_cloudsql_volume`), et Cloud SQL rejette cette connexion
  non chiffrée. Les pools `pg` en amont ne définissent aucune option `ssl` et l'application n'a pas de
  bascule de variable d'environnement, donc l'image du backend est une fine construction personnalisée qui
  corrige les trois constructeurs `pg.Pool` pour activer SSL pour tout hôte non-loopback (voir
  [SparkyFitness_Common](SparkyFitness_Common.md) §4).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour SparkyFitness sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `sparkyfitness` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Étiquette les images frontend et backend de manière identique. Utilisez `latest` ou une étiquette préfixée par `v` exactement telle que publiée en amont (par exemple `v0.17.3` — un simple `0.17.3` n'existe pas). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources pour le **sidecar du backend**. |
| `min_instance_count` / `max_instance_count` | `0` / `2` | Bornes de mise à l'échelle de l'instance. |
| `container_port` | `3010` | Port d'écoute du backend à l'intérieur de son sidecar. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — aucun travail en arrière-plan n'est nécessaire à l'état stable. |
| `enable_cloudsql_volume` | `true` | Voir la note Cloud SQL TLS dans le §3 — le sidecar du backend reçoit toujours l'IP privée brute de Cloud SQL, quel que soit cet indicateur sur Cloud Run. |

### Groupe 5 — Configuration de l'application SparkyFitness {#group-5--sparkyfitness-application-config}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `app_db_user` | `sparky_app` | Nom du rôle d'exécution à privilèges limités, auto-créé par le backend. |
| `disable_signup` | `false` | Désactiver la nouvelle auto-inscription. |
| `admin_email` | `""` | Accorde l'administration à un utilisateur EXISTANT au démarrage ; ne crée pas le compte. |
| `public_api_docs` | `false` | Exposer publiquement la documentation Swagger. |
| `allow_private_network_cors` | `false` | N'activer que sur un réseau privé. |
| `log_level` | `ERROR` | Verbosite des journaux du backend. |
| `timezone` | `Etc/UTC` | Fuseau horaire du backend. |

### Groupe 7 — SMTP (facultatif) {#group-7--smtp-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_enabled` | `false` | Activer les e-mails de réinitialisation de mot de passe/notification. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_from` / `smtp_secure` | voir `variables.tf` | Définissez tous les champs ensemble lors de l'activation du SMTP ; fournissez le mot de passe via `secret_environment_variables` (`SPARKY_FITNESS_EMAIL_PASS`). |

### Groupe 13 — Base de données {#group-13--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — aucun autre moteur n'est pris en charge. |
| `db_name` | `sparkyfitness_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `sparky` | Rôle d'administrateur/migration — le backend exécute ses propres migrations avec ce rôle. |

### Groupe 15 — Jobs et tâches planifiées {#group-15--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (rôle admin + base de données uniquement). |

### Groupe 16 — Observabilité et santé {#group-16--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/health`, port 3010 | Cible le **backend** ; le conteneur principal du frontend reçoit sa propre sonde TCP simple (codée en dur dans le fichier de câblage, non configurable par l'utilisateur). |

### Groupe 17 — Redis (non utilisé nativement) {#group-17--redis-not-used-natively}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | SparkyFitness n'utilise pas Redis ; laissé disponible comme capacité générique de la Fondation. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `app_url` | URL de l'application (conteneur frontend/ingress) — ouvrez-la dans un navigateur. |
| `backend_url` | Adresse de bouclage interne du sidecar du backend (`http://127.0.0.1:3010`). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données admin. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `container_image` | Image frontend déployée. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `BETTER_AUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après que les utilisateurs aient activé la 2FA | Critique | Le faire pivoter bloque tous les utilisateurs ayant activé la 2FA. |
| `SPARKY_FITNESS_API_ENCRYPTION_KEY` (auto-généré) | Ne jamais faire pivoter après la première connexion | Critique | Le faire pivoter invalide toutes les informations d'identification des sources de données externes stockées. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; la modification recrée la base de données et détruit toutes les données. |
| `application_version` | Utiliser l'étiquette exacte de l'amont (`v0.17.3`) | Élevé | Un simple `0.17.3` (sans préfixe `v`) n'existe pas en amont — l'extraction échoue. |
| `admin_email` | Définir uniquement après que le compte existe | Moyen | Le définir avant l'inscription n'a aucun effet — il élève un compte existant, ne le crée jamais. |
| `enable_cloudsql_volume` | laisser à `true` | Élevé | Le sidecar du backend Cloud Run reçoit toujours l'IP privée brute de Cloud SQL (pas le socket) quel que soit cet indicateur ; l'image du backend patchée SSL est ce qui fait fonctionner cette connexion. |
| `disable_signup` | `true` après le premier admin | Moyen | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `smtp_enabled` | Définir TOUS les champs smtp_* ensemble | Moyen | Un bloc SMTP partiellement configuré peut rendre la réinitialisation du mot de passe par e-mail non fonctionnelle. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à SparkyFitness partagée avec la variante GKE est décrite dans
**[SparkyFitness_Common](SparkyFitness_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SparkyFitness sur Cloud Run](../labs/SparkyFitness_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [SparkyFitness sur GKE Autopilot](SparkyFitness_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [SparkyFitness Common — Configuration d'application partagée](SparkyFitness_Common.md) — la configuration partagée par les deux cibles de déploiement.
