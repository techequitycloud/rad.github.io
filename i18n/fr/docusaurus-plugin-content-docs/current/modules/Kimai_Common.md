---
title: "Kimai Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Kimai — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Kimai_Common.md @ 3055034 sha256:09953bd9f221 -->

# Kimai Common — Configuration applicative partagée {#kimai-common--shared-application-configuration}

`Kimai_Common` est la **couche applicative partagée** de Kimai. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Kimai sur laquelle
s'appuient à la fois [Kimai_GKE](Kimai_GKE.md) et [Kimai_CloudRun](Kimai_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
c'est important. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Kimai, consultez les
guides des plateformes ([Kimai_GKE](Kimai_GKE.md), [Kimai_CloudRun](Kimai_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Kimai_Common | Où cela apparaît |
|---|---|---|
| Secrets | Génère `APP_SECRET` (clé de signature CSRF/session de Symfony) et `ADMINPASS` (mot de passe administrateur initial), tous deux stockés dans **Secret Manager** | Injectés comme variables d'environnement secrètes du conteneur ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Un build personnalisé léger `FROM kimai/kimai2:<tag>` avec un point d'entrée wrapper qui compose `DATABASE_URL` à l'exécution ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) comme moteur | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit un unique job `db-init` (crée la base de données, l'utilisateur et les droits) — pas de job de migration distinct | Sortie `initialization_jobs` |
| Paramètres principaux | Définit `ADMINMAIL` et la variable d'environnement en minuscules `memory_limit` ; laisse `DATABASE_URL` entièrement à la composition à l'exécution | Comportement de l'application dans les guides des plateformes |
| Stockage objet | Un bucket GCS `storage`, éventuellement monté via GCS FUSE sur `/opt/kimai/var/data` | Sortie `storage_buckets` |
| Contrôles de santé | Déclare les valeurs par défaut de `startup_probe`/`liveness_probe` (`GET /en/login`) que les deux variantes héritent telles quelles | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — aucun
n'est jamais défini en clair :

- **`APP_SECRET`** — une chaîne aléatoire de 32 caractères (sans caractères
  spéciaux), stockée sous `secret-<prefix>-<app>-app-secret`. C'est la clé de
  signature CSRF/session Symfony de Kimai. Sinon, l'image de l'éditeur en
  générerait une elle-même et la conserverait sous `var/data/.appsecret` au premier
  démarrage ; la fournir explicitement via Secret Manager signifie qu'aucun volume
  persistant n'est nécessaire juste pour garder cette valeur stable entre les
  redémarrages du conteneur.
- **`ADMINPASS`** — une chaîne aléatoire de 24 caractères (sans caractères
  spéciaux), stockée sous `secret-<prefix>-<app>-admin-password`. C'est le mot de
  passe du compte super-administrateur amorcé (voir §4).

Les deux sont injectés comme variables d'environnement secrètes via
`config.secret_environment_variables` (`APP_SECRET`, `ADMINPASS`), et le module
attend 30 secondes (`time_sleep.wait_for_secrets`) après avoir créé les deux
versions de secret avant de renvoyer son output `config`, pour laisser la
réplication globale de Secret Manager se faire. Le mot de passe de la base de
données est généré et géré séparément par le socle ; le nom de son secret figure
dans les outputs du déploiement de la plateforme (`database_password_secret`).

Récupérez l'un ou l'autre secret après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~kimai"
gcloud secrets versions access latest --secret=<app-secret-or-admin-password-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity.

---

## 3. Pourquoi `DATABASE_URL` est composée à l'exécution, et non définie dans Terraform {#3-why-database_url-is-composed-at-runtime-not-set-in-terraform}

La couche Doctrine DBAL de Kimai se configure via une seule variable
d'environnement, `DATABASE_URL`, de la forme
`mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0` — et non via des
variables distinctes `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` comme l'attendent
de nombreux autres frameworks de ce catalogue. Deux contraintes rendent impossible
de la définir directement comme valeur Terraform au moment du plan :

1. **Le mot de passe de la base de données est un secret d'exécution.** Il est
   généré par le socle au moment de l'apply et n'est pas connu lorsque Terraform
   génère la spécification du conteneur.
2. **Cloud Run n'interpole pas les références `$(VAR)`** comme le fait Kubernetes.
   Une chaîne définie au plan comme `"mysql://$(DB_USER):$(DB_PASSWORD)@..."`
   parviendrait au conteneur Cloud Run sous la forme de ce texte littéral, non
   substitué — et non d'une chaîne de connexion fonctionnelle.

`Kimai_Common` définit `image_source = "custom"` et construit une image wrapper
légère `FROM kimai/kimai2:${KIMAI_VERSION}` (voir `scripts/Dockerfile`) dont le seul
ajout est `scripts/entrypoint.sh`, copié sous `/cloud-entrypoint.sh` et défini comme
`ENTRYPOINT` de l'image. Ce point d'entrée s'exécute **avant** tout le reste dans le
conteneur et compose `DATABASE_URL` à ce moment-là, lorsque le véritable secret
`DB_PASSWORD` injecté par le socle est effectivement présent comme variable
d'environnement :

```sh
ENCODED_DB_PASS=$(php -r 'echo rawurlencode(getenv("DB_PASSWORD") ?: "");')
export DATABASE_URL="mysql://${DB_USER}:${ENCODED_DB_PASS}@${DB_IP}:3306/${DB_NAME}?charset=utf8mb4&serverVersion=8.0"
exec docker-php-entrypoint /entrypoint.sh
```

- **Encodage URL du mot de passe.** Les mots de passe MySQL/Cloud SQL générés
  peuvent contenir des caractères (`@ : / ? # % & +`) qui seraient sinon mal
  interprétés comme des délimiteurs d'URL dans le DSN. Le wrapper encode le mot de
  passe pour l'URL avec `php -r 'echo rawurlencode(...)'` — l'image n'a pas
  `python3` installé ; c'*est* une image PHP, donc le correctif utilise ce qui est
  déjà présent plutôt que d'ajouter un nouvel interpréteur.
- **Vérifié en local avant le cloud.** Ce comportement exact — l'étape d'encodage
  URL et la vérification préalable d'attente de la base de données propre à
  l'éditeur dans `docker-php-entrypoint /entrypoint.sh` — a été confirmé de bout en
  bout en construisant l'image wrapper et en l'exécutant localement contre un
  véritable conteneur MySQL avec un mot de passe contenant délibérément des
  caractères spéciaux (`p@ss:w/rd?1`), avant tout déploiement sur Cloud Run ou GKE.
- **Passage de relais sans modification.** Après avoir exporté `DATABASE_URL`, le
  wrapper fait un `exec` de la chaîne de points d'entrée propre à l'éditeur,
  entièrement non modifiée (`docker-php-entrypoint /entrypoint.sh`), qui exécute à
  son tour `kimai:install` (création du schéma et migrations) et l'amorçage de
  l'utilisateur administrateur à chaque démarrage.

---

## 4. Pourquoi `DB_IP`, et non le standard `DB_HOST` {#4-why-db_ip-not-the-standard-db_host}

L'Application Module appelant définit `db_host_env_var_name = "DB_IP"`, de sorte que
le socle injecte l'hôte de la base de données sous **à la fois** le nom standard
`DB_HOST` et cet alias `DB_IP`. `entrypoint.sh` lit délibérément `$DB_IP`, et non
`$DB_HOST` :

- Sur **Cloud Run**, `DB_IP` correspond à l'**adresse IP privée brute de Cloud SQL**
  (`Kimai_CloudRun` définit `enable_cloudsql_volume = false` — aucun volume de socket
  de l'Auth Proxy n'est monté).
- Sur **GKE**, `DB_IP` correspond à la **boucle locale `127.0.0.1` du sidecar
  cloud-sql-proxy** (`Kimai_GKE` définit `enable_cloudsql_volume = true` — le socle
  injecte un conteneur sidecar Cloud SQL Auth Proxy dans le pod).

Dans les deux cas, `DB_IP` est un hôte simple sans deux-points — sûr à placer
directement dans la partie autorité d'une URL (`mysql://user:pass@HOST:3306/db`). La
variable standard `DB_HOST` peut au contraire prendre sur Cloud Run la forme de
**répertoire de socket** Unix de Cloud SQL (par ex.
`/cloudsql/project:region:instance`), qui contient des deux-points qui casseraient
l'analyse de l'autorité de l'URL si elle était utilisée de la même façon — c'est
précisément pourquoi le wrapper lit `DB_IP` et non `DB_HOST`.

---

## 5. Amorçage de l'administrateur {#5-admin-bootstrap}

Le `entrypoint.sh` propre à l'éditeur (dans l'image de base `kimai/kimai2`, exécuté
à la fin de la chaîne `exec` du wrapper) exécute
`kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN "$ADMINPASS"` à chaque
démarrage du conteneur dès que `ADMINPASS` est défini. C'est **idempotent** — sans
effet une fois le compte existant, il est donc sûr de l'exécuter à chaque démarrage
plutôt que comme job d'initialisation ponctuel.

Le **nom d'utilisateur du compte est toujours `admin`**, codé en dur par le point
d'entrée de l'éditeur, quelle que soit la valeur de `ADMINMAIL`
(`var.admin_email`). Seuls l'adresse e-mail et le mot de passe sont configurables
via les entrées de ce module.

---

## 6. Amorçage de la base de données {#6-database-bootstrap}

Kimai n'a besoin que d'**un seul** job d'initialisation par défaut — un modèle
nettement plus simple que celui des applications du catalogue qui séparent la
création du schéma d'une étape de migration explicite :

- **`db-init`** (`mysql:8.0-debian`, `scripts/db-init.sh`,
  `execute_on_apply = true`, `max_retries = 3`, `timeout_seconds = 600`) — crée la
  base de données MySQL et l'utilisateur applicatif. C'est le code MySQL standard
  et éprouvé du catalogue (partagé avec Matomo/SnipeIT/BookStack), nécessaire
  précisément parce que la valeur par défaut `caching_sha2_password` de Cloud SQL
  MySQL 8 exige `--get-server-public-key` pour l'échange de clés RSA sur TCP en
  clair — ce que la création automatique des rôles/bases de données du socle ne
  gère pas.

Il n'y a **pas de job de migration distinct**. `kimai:install` (création du schéma
et migrations) s'exécute à chaque démarrage du conteneur dans le cadre de la chaîne
de points d'entrée de l'éditeur — de manière idempotente, conformément au
comportement documenté de l'image de l'éditeur — si bien que ce seul job `db-init`,
plus la création automatique des rôles/bases de données MySQL par le socle, suffit ;
la séquence de démarrage de Kimai s'occupe du reste.

Le job comme l'installation au démarrage peuvent être réexécutés sans risque.
Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

`Kimai_CloudRun` comme `Kimai_GKE` transmettent sans modification les valeurs par
défaut de `startup_probe`/`liveness_probe` propres à cette couche :

- **Démarrage :** `HTTP GET /en/login`, délai initial de 30s, timeout de 10s,
  période de 15s, seuil d'échec de 20 tentatives — généreux, pour couvrir la
  vérification préalable d'attente de la base de données du conteneur et
  l'exécution de `kimai:install` au premier démarrage.
- **Vivacité :** `HTTP GET /en/login`, délai initial de 60s, timeout de 10s,
  période de 30s, seuil d'échec de 3 tentatives.

`/en/login` (la page de connexion de Kimai) renvoie `200` une fois l'application
prête. `/` fonctionne aussi pour une sonde générique (Kimai émet une redirection
`302` depuis le chemin racine), mais `/en/login` est la cible plus précise,
directement vérifiée, et c'est ce que configurent réellement les deux variantes de
plateforme.

---

## 8. Stockage d'objets {#8-object-storage}

Cette couche provisionne un bucket GCS via `storage_buckets`
(`name_suffix = "storage"`, classe `STANDARD`, `force_destroy = true`, prévention
de l'accès public appliquée). Lorsque `enable_gcs_storage_volume = true` (la valeur
par défaut), ce bucket est monté via GCS FUSE dans le conteneur sur
`/opt/kimai/var/data`, où Kimai stocke les logos/modèles de factures téléversés et
les données des plugins.

Il s'agit d'un **bucket distinct** de l'entrée générique `storage_buckets` que
chaque Application Module expose également au niveau du socle (par défaut un bucket
nommé `data` dans `Kimai_CloudRun` comme dans `Kimai_GKE`) — ce bucket générique
n'est ni lu ni écrit par Kimai, sauf s'il est explicitement raccordé.

---

Pour la configuration de Kimai destinée aux utilisateurs (variables par groupe,
outputs, et comment explorer chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[Kimai_GKE](Kimai_GKE.md)** et
**[Kimai_CloudRun](Kimai_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Kimai sur Google Cloud Run](Kimai_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Kimai sur GKE Autopilot](Kimai_GKE.md) — cette configuration déployée sur GKE.
