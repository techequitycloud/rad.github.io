---
title: "InvenTree Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module InvenTree — paramètres de la couche application consommés par le déploiement Google Cloud Run."
---

<!-- translated-from: docs/modules/InvenTree_Common.md @ 2829548 sha256:4febcf3804eb -->

# InvenTree Common — Configuration d'application partagée {#inventree-common--shared-application-configuration}

`InvenTree_Common` est la **couche d'application partagée** pour InvenTree. Il n'est pas
déployé seul ; il fournit plutôt la configuration spécifique à InvenTree sur
laquelle [InvenTree_CloudRun](InvenTree_CloudRun.md) s'appuie — l'image de
conteneur, l'environnement InvenTree de base et les jobs d'amorçage de la
base de données. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a pas d'interface utilisateur de déploiement propre —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous
voyez dans le guide de la plateforme.

Pour l'infrastructure qui provisionne et exécute InvenTree, consultez le
guide de la plateforme ([InvenTree_CloudRun](InvenTree_CloudRun.md)) et les
guides de fondation ([App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par InvenTree_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé léger de l'image officielle `inventree/inventree` avec un point d'entrée wrapper ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Cloud SQL pour MySQL 8.0** (`MYSQL_8_0`), `INVENTREE_DB_ENGINE = "mysql"`, port 3306 | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Une chaîne de deux jobs : `db-init` (base de données, utilisateur, autorisations) → `migrate` (migrations Django) | Sortie `initialization_jobs` |
| Paramètres de base | L'environnement de base `INVENTREE_*` : gestion du proxy/HTTPS, répertoire de données, migrations désactivées en cours de processus | Comportement de l'application dans le guide de la plateforme |
| Stockage | Un bucket Cloud Storage supplémentaire (`storage`) | Sortie `storage_buckets` |
| Secrets | **Aucun** — le seul identifiant est le mot de passe de la base de données, généré par la fondation | Sortie `database_password_secret` |
| Sondes de santé | Transmet les `startup_probe` / `liveness_probe` de la variante | §Observabilité dans le guide de la plateforme |

Le module active également l'API Secret Manager sur le projet.

---

## 2. Secrets {#2-secrets}

`InvenTree_Common` ne génère aucun secret d'application : ses sorties `secret_ids` et
`secret_values` sont toutes deux vides. Le mot de passe de la base de données est
généré et stocké dans Secret Manager par la fondation et injecté comme
`DB_PASSWORD`.

La clé de signature propre à InvenTree n'est **pas** fournie par cette couche.
InvenTree génère `secret_key.txt` dans son répertoire de données (`/home/inventree/data`)
au premier démarrage, c'est pourquoi ce répertoire doit être persistant — voir §6.

Voir [App_Common](App_Common.md) pour le modèle de secret partagé.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

InvenTree fonctionne sur **Cloud SQL pour MySQL 8.0** (`MYSQL_8_0`). InvenTree
ne fournit pas de SQL groupé — le schéma est créé par les migrations Django.
Deux jobs d'initialisation s'exécutent en séquence (tous deux `execute_on_apply = true`) :

1. **`db-init`** (`mysql:8.0-debian`, `max_retries = 3`,
   `timeout_seconds = 600`) — trouve la connexion Cloud SQL (un socket Unix sous
   `/cloudsql` si monté, sinon TCP vers `DB_IP`), attend MySQL, crée
   ou aligne l'utilisateur et la base de données de l'application, accorde les
   privilèges, vérifie que l'utilisateur peut se connecter (ce qui réchauffe
   également le cache `caching_sha2_password`), puis signale au sidecar Cloud SQL Auth Proxy
   de se terminer.
2. **`migrate`** (`depends_on_jobs = ["db-init"]`, l'image de l'application,
   `cpu_limit = "2000m"`, `memory_limit = "2Gi"`, `timeout_seconds = 1800`,
   `max_retries = 1`, `mount_nfs = true`) — mappe `DB_*` sur `INVENTREE_DB_*`,
   exécute `python3 manage.py migrate --noinput`, puis compte les tables réellement
   présentes et échoue s'il y en a moins de 10. Un `migrate` qui aurait
   silencieusement choisi les mauvais paramètres se terminerait autrement avec
   un code de sortie 0 et un schéma vide.

Une liste `initialization_jobs` fournie par l'appelant remplace les deux jobs.

**Note de récupération.** Une base de données laissée à moitié migrée (par
exemple par une tentative de migration en cours de processus) ne peut pas être
réparée en réexécutant `migrate` — cela échoue avec `Duplicate column name`.
Supprimez et recréez la base de données, puis exécutez `db-init` et
`migrate` à nouveau.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

`scripts/Dockerfile` :

```dockerfile
ARG INVENTREE_VERSION=1.5.4
FROM inventree/inventree:${INVENTREE_VERSION}

COPY entrypoint.sh /cloud-entrypoint.sh
RUN chmod +x /cloud-entrypoint.sh

ENTRYPOINT ["/cloud-entrypoint.sh"]
CMD ["sh", "-c", "exec gunicorn -c ./gunicorn.conf.py InvenTree.wsgi -b ${INVENTREE_WEB_ADDR}:${INVENTREE_WEB_PORT} --chdir ${INVENTREE_BACKEND_DIR}/InvenTree"]
```

Le `CMD` est délibérément réaffirmé : l'image du fournisseur conserve la
commande gunicorn dans `CMD`, donc le remplacement du `ENTRYPOINT` sans
elle laissait `init.sh` sans arguments et le conteneur se terminait avec un
code de sortie 0 à chaque démarrage.

Le tag de base provient de l'ARG de build `INVENTREE_VERSION` spécifique à l'application,
défini à partir de `application_version`. L'épingle qui prend effet est la valeur par
défaut `application_version` de la **variante** (`1.5.4` dans `InvenTree_CloudRun`),
car la variante transmet sa valeur à cette couche.

`scripts/entrypoint.sh` s'exécute à chaque démarrage de conteneur :

- **URL du site.** Si `INVENTREE_SITE_URL` n'est pas défini, il revient à
  `CLOUDRUN_SERVICE_URL` ; si les deux sont manquants, il refuse de démarrer. Le
  `settings.py` d'InvenTree se termine au démarrage sans URL de site (validation
  d'URL, `ALLOWED_HOSTS` vide, `CSRF_TRUSTED_ORIGINS` vide).
- **Mappage de la base de données.** Nécessite `DB_IP`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD` et exporte `INVENTREE_DB_HOST` (depuis
  `DB_IP` — la forme de répertoire de socket de `DB_HOST` n'est pas un
  hôte TCP), `INVENTREE_DB_NAME`, `INVENTREE_DB_USER`, `INVENTREE_DB_PASSWORD` et
  `INVENTREE_DB_PORT` (par défaut 3306).
- **Fichiers statiques.** Sauf si `INVENTREE_COLLECTSTATIC` est `false`, exécute
  `invoke int.collect-static --no-i18n` (revenant à `manage.py
  collectstatic --noinput`). Un échec est un avertissement, pas une
  erreur fatale.
- **Transfert.** `exec /bin/bash ./init.sh "$@"` — le script d'initialisation du fournisseur
  exécute ensuite gunicorn (conteneur web) ou `invoke worker` (le sidecar
  `qcluster`).

`scripts/migrate.sh` effectue le même mappage `DB_*` pour le job `migrate`.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`InvenTree_Common` définit cet environnement de base. Les valeurs dans
`environment_variables` de l'appelant sont fusionnées par-dessus et l'emportent en cas de
conflit.

| Variable | Valeur | Pourquoi |
|---|---|---|
| `INVENTREE_DB_ENGINE` | `mysql` | Cloud SQL pour MySQL. |
| `INVENTREE_DB_PORT` | `3306` | Port MySQL. |
| `INVENTREE_AUTO_UPDATE` | `false` | Le job `migrate` possède le schéma. La migration en cours de processus s'exécute avant que le port ne se lie, sa branche de base de données vide en amont est inaccessible, et deux conteneurs seraient en concurrence. |
| `INVENTREE_USE_X_FORWARDED_PROTO` | `true` | Sinon, chaque lien absolu (réinitialisation de mot de passe, invitations) est construit comme `http://` derrière Cloud Run. |
| `INVENTREE_SESSION_COOKIE_SECURE` | `true` | Sinon, les cookies CSRF, de session et de langue ne sont pas sécurisés sur un point de terminaison HTTPS uniquement. |
| `INVENTREE_DATA_DIR` | `/home/inventree/data` | Tout état mutable. |
| `INVENTREE_BACKGROUND_WORKERS` | `2` | À partir de l'entrée `background_workers` de cette couche (non exposée par la variante). |

Les valeurs par défaut du conteneur définies ici : `container_port = 8000` (gunicorn se lie
à `INVENTREE_WEB_ADDR:INVENTREE_WEB_PORT`, pas au `$PORT` de Cloud Run),
`database_type = MYSQL_8_0`, `enable_cloudsql_volume = false`, `cloudsql_volume_mount_path = /cloudsql`,
`image_source = "custom"`, plus les limites de ressources et les nombres d'instances
transmis par la variante.

**Entrées déclarées ici mais non utilisées.** `admin_username`, `admin_email`,
`php_memory_limit` et `enable_gcs_storage_volume` sont déclarées (et les trois dernières
sont transmises par la variante) mais rien dans cette couche ne les lit. Aucun
compte administrateur n'est créé et aucun bucket n'est monté par elles.

---

## 6. Stockage et répertoire de données {#6-storage-and-the-data-directory}

InvenTree conserve **tout** son état mutable sous `INVENTREE_DATA_DIR`
(`/home/inventree/data`) : `config.yaml`, le `secret_key.txt` généré, les
médias téléchargés, les fichiers statiques collectés et le répertoire des
plugins. L'image ne déclare aucun volume pour cela.

Cette couche n'ajoute aucun volume GCS Fuse pour cela — un véritable système de
fichiers POSIX (le partage NFS) est le magasin de stockage prévu. Dans la
variante, le sidecar `qcluster` monte NFS à `/home/inventree/data` et le
conteneur web et les jobs le montent à `nfs_mount_path`, le tout uniquement lorsque
`enable_nfs = true`. Tous les `gcs_volumes` fournis par l'appelant sont transmis
inchangés.

La sortie `storage_buckets` ajoute un bucket avec le suffixe `storage`
(`STANDARD`, `force_destroy = true`, prévention de l'accès public appliquée). Il
n'est pas monté dans le conteneur.

---

## 7. Comportement de la sonde de santé {#7-health-probe-behaviour}

Cette couche transmet tout `startup_probe` / `liveness_probe` que la variante
transmet. Dans `InvenTree_CloudRun`, les deux sont **HTTP `GET /`**,
correspondant à la propre vérification de santé de l'image du fournisseur ; la
sonde de démarrage permet une longue fenêtre (`failure_threshold = 60`, `period_seconds = 15`).

---

Pour la configuration spécifique à InvenTree et destinée à l'utilisateur
(variables par groupe, sorties et comment explorer chaque service depuis la
Console et la CLI), consultez le guide de la plateforme :
**[InvenTree_CloudRun](InvenTree_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [InvenTree sur Google Cloud Run](InvenTree_CloudRun.md) — cette configuration déployée sur Cloud Run.
