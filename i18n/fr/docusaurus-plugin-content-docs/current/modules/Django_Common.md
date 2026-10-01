---
title: "Django Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Django — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Django_Common.md @ 3055034 sha256:1503ffd21c96 -->

# Django Common — Configuration applicative partagée {#django-common--shared-application-configuration}

`Django_Common` est la **couche applicative partagée** de Django. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration propre à Django sur laquelle s'appuient
[Django_GKE](Django_GKE.md) et [Django_CloudRun](Django_CloudRun.md), de sorte que
les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle ne possède aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Django, consultez les guides des
plateformes ([Django_GKE](Django_GKE.md), [Django_CloudRun](Django_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Django_Common | Où cela apparaît |
|---|---|---|
| `SECRET_KEY` Django | Génère une clé aléatoire de 50 caractères et la stocke dans **Secret Manager** | Injectée sous le nom `SECRET_KEY` à l'exécution ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image Django/Gunicorn et la source Cloud Build, UID 2000 | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job `db-init` qui crée la base de données et l'utilisateur, et installe les extensions | Output `initialization_jobs` |
| Migrations de schéma | Définit le job `db-migrate` qui exécute `manage.py migrate` + `collectstatic` | S'exécute automatiquement à chaque déploiement |
| Extensions PostgreSQL | Installe automatiquement `pg_trgm`, `unaccent`, `hstore`, `citext` | Aucune action requise de l'utilisateur |
| Stockage d'objets | Déclare le bucket de médias **Cloud Storage** | Output `storage_buckets` |
| Paramètres principaux | Définit le port du conteneur (8080), la source de l'image (`custom`), l'indicateur d'extensions, le serveur Gunicorn | Comportement de l'application dans les guides des plateformes |
| Sondes de santé | Transmet `startup_probe`/`liveness_probe` sans modification (valeur par défaut `null` ici — la variante CloudRun utilise par défaut `/healthz`, la variante GKE `/`) | §Observabilité dans les guides des plateformes |

---

## 2. `SECRET_KEY` Django dans Secret Manager {#2-django-secret_key-in-secret-manager}

La `SECRET_KEY` Django est générée automatiquement et stockée sous forme de secret Secret Manager
— elle n'est jamais définie en clair. Récupérez-la après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~key"
gcloud secrets versions access latest --secret=<resource-prefix>-django-key --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son
secret est indiqué dans les outputs du déploiement de la plateforme (`database_password_secret`).

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Django exige **PostgreSQL 15** ; le moteur est imposé et MySQL n'est pas pris en charge
par ce module. Lors du premier déploiement, deux jobs s'exécutent successivement :

1. **`db-init`** (image : `postgres:15-alpine`) — se connecte à Cloud SQL via
   l'Auth Proxy et crée de manière idempotente la base de données applicative et l'utilisateur, accorde
   les privilèges et installe les quatre extensions PostgreSQL requises :

   | Extension | Rôle |
   |---|---|
   | `pg_trgm` | Similarité par trigrammes pour la recherche plein texte |
   | `unaccent` | Recherche textuelle insensible aux accents |
   | `hstore` | Type de colonne clé-valeur |
   | `citext` | Type de colonne texte insensible à la casse |

2. **`db-migrate`** (image de l'application) — exécute `manage.py migrate` pour appliquer toutes
   les migrations en attente et `manage.py collectstatic --noinput --clear` pour rassembler
   les fichiers statiques à l'emplacement configuré.

Les deux jobs s'exécutent avec `execute_on_apply = true`, de sorte qu'ils se déclenchent automatiquement à chaque
déploiement. Ils sont idempotents et peuvent être réexécutés sans risque. Inspectez ou relancez
la base de données avec :

```bash
# Cloud Run:
gcloud run jobs list --region "$REGION" --project "$PROJECT"
gcloud run jobs execute db-init-<resource-prefix> --region "$REGION" --project "$PROJECT"
# GKE:
kubectl get jobs -n "$NAMESPACE"
kubectl describe job db-init -n "$NAMESPACE"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les outputs du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Django_Common` établit l'environnement Django de base afin que l'application
démarre correctement dès le premier lancement :

- **Port de conteneur 8080.** Gunicorn écoute sur le port 8080. Le socle configure le
  service Cloud Run ou le Service Kubernetes pour cibler ce port.
- **Image personnalisée via Cloud Build.** `container_image_source = "custom"` indique au
  socle de déclencher un Cloud Build à partir du Dockerfile de `Django_Common/scripts/`,
  qui produit une image Django basée sur Gunicorn et taguée avec `application_version`.
- **Indicateur des extensions PostgreSQL.** `enable_postgres_extensions = true` est défini
  en interne afin que le socle provisionne les autorisations IAM liées aux extensions. Les quatre
  extensions sont installées par `db-init.sh` ; vous n'avez pas besoin de définir cet indicateur
  manuellement.
- **Création du superutilisateur.** `entrypoint.sh` recherche `DJANGO_SUPERUSER_USERNAME` et
  `DJANGO_SUPERUSER_PASSWORD` au démarrage (si `DJANGO_SUPERUSER_PASSWORD` n'est pas défini mais que
  `DB_PASSWORD` est présent, le mot de passe du superutilisateur prend par défaut la valeur de `DB_PASSWORD`) et crée le
  compte via un script `manage.py shell` qui appelle directement `User.objects.create_superuser(...)`
  — **et non** `manage.py createsuperuser --noinput`. `DJANGO_SUPERUSER_EMAIL` est facultatif
  et vaut par défaut `admin@example.com`. Utilisez `secret_environment_variables` dans le module de plateforme
  pour fournir `DJANGO_SUPERUSER_PASSWORD` depuis Secret Manager.
- **Le stockage des médias dans GCS est optionnel, pas automatique.** `Django_Common` provisionne le bucket de stockage `media`
  et intègre `django-storages[google]` à l'image (`settings.py` bascule le backend de stockage
  de fichiers `default` vers `storages.backends.gcloud.GoogleCloudStorage` uniquement lorsque la
  variable d'environnement `GS_BUCKET_NAME` est définie — sinon Django revient à `FileSystemStorage` local pour
  les médias et à Whitenoise pour les fichiers statiques). Ni `GS_BUCKET_NAME` ni une entrée `gcs_volumes`
  correspondante ne sont définis par défaut, de sorte que la référence `mount_gcs_volumes = ["django-media"]`
  du job `db-migrate` ne prend effet que si la variable `gcs_volumes` du module de plateforme est également renseignée
  avec une entrée nommée `django-media` pointant vers le bucket. Pour utiliser GCS pour les médias, définissez
  `GS_BUCKET_NAME` via `environment_variables` (et, si le montage est nécessaire, ajoutez l'entrée
  `gcs_volumes` correspondante) plutôt que de supposer que c'est configuré d'emblée.

Valeurs par défaut propres à chaque plateforme (définies par la variante CloudRun/GKE, et non par `Django_Common` lui-même) :

- **GKE** utilise par défaut `session_affinity = "ClientIP"` afin que les requêtes d'un même utilisateur soient acheminées vers
  le même pod lorsque le stockage des sessions en processus est utilisé.
- **Cloud Run** utilise par défaut `execution_environment = "gen2"` (requis notamment pour les montages NFS/GCS Fuse,
  entre autres fonctionnalités propres à gen2). Il s'agit simplement de la valeur par défaut statique du module — elle n'est pas modifiée
  automatiquement en fonction de `enable_nfs`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

`Django_Common` ne définit lui-même aucune valeur par défaut pour les sondes (`startup_probe`/`liveness_probe` valent par défaut
`null`) ; les valeurs ci-dessous proviennent des valeurs par défaut du `variables.tf` des variantes CloudRun et GKE, toutes deux sur
le port 8080. **Cloud Run** utilise par défaut le chemin de sonde `/healthz` (servi par le fichier
`myproject/urls.py` du projet d'exemple, qui renvoie un HTTP 200 une fois l'application prête). **Le chemin de sonde par défaut de GKE
est `/`** (la racine de l'application), et non `/healthz` — les deux variantes divergent ici, vérifiez donc
le chemin déployé dans le `variables.tf` du module de plateforme avant de vous fier à l'une ou l'autre valeur par défaut.

- **GKE** utilise des sondes HTTP pour le démarrage (délai initial de 90 s) et pour la vivacité (délai
  initial de 60 s) — le trafic des sondes interne au cluster atteint directement le conteneur sans
  passer par un équilibreur de charge.
- **Cloud Run** utilise également des sondes HTTP pour le démarrage (délai initial de 60 s) et pour la
  vivacité (délai initial de 30 s). Contrairement à Mautic/Apache, le serveur Gunicorn de Django ne
  redirige pas le HTTP vers le HTTPS, de sorte que des sondes HTTP simples fonctionnent sans contournement TCP.
  Assurez-vous que `SECURE_SSL_REDIRECT = False` dans `settings.py` (ou exemptez `/healthz`) afin que le
  chemin de la sonde ne soit jamais redirigé.

Si les migrations du premier déploiement sont volumineuses et que le délai initial de 60 secondes (Cloud Run) ou de 90 secondes
(GKE) est insuffisant, remplacez `startup_probe` par une valeur de
`initial_delay_seconds` plus élevée dans les variables du module de plateforme.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket de médias **Cloud Storage** dédié (`name_suffix = "media"`) est déclaré ici
et provisionné par le socle, qui accorde également l'accès au compte de service de la charge
de travail. Le bucket est provisionné dans la région du déploiement, mais — comme indiqué au §4 — ni le
bucket GCS ni le volume Filestore (NFS) partagé ne sont reliés par défaut au `MEDIA_ROOT` de Django :
GCS nécessite que `GS_BUCKET_NAME` soit défini explicitement, et le chemin de montage NFS par défaut (`/mnt/nfs`) ne
correspond pas au répertoire `/app/media` de l'image ; `nfs_mount_path` doit donc être défini sur `/app/media` pour
assurer la persistance des médias sur NFS. Listez et inspectez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<resource-prefix>-media/
```

---

Pour la configuration propre à Django destinée aux utilisateurs (variables par groupe, outputs et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Django_GKE](Django_GKE.md)** et **[Django_CloudRun](Django_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Django sur Cloud Run](Django_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Django sur GKE Autopilot](Django_GKE.md) — cette configuration déployée sur GKE.
