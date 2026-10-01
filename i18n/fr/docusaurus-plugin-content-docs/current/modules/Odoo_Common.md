---
title: "Configuration applicative partagée d'Odoo"
description: "Référence de la configuration partagée du module Odoo — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Odoo_Common.md @ 3055034 sha256:7e1d093858af -->

# Configuration applicative partagée d'Odoo {#odoo-shared-application-configuration}

`Odoo_Common` est la couche de configuration applicative partagée qu'utilisent à la fois `Odoo_CloudRun` et
`Odoo_GKE`. Elle n'est pas déployée indépendamment — chaque variante de plateforme l'appelle en interne
pour assembler l'image de conteneur Odoo, les variables d'environnement, les jobs d'initialisation,
les paramètres des sondes de santé et les définitions de stockage avant de les transmettre au socle
de déploiement.

Tout ce qui figure dans ce document décrit ce que `Odoo_Common` configure pour vous. Vous
n'interagissez pas directement avec ce module ; vous interagissez avec lui au travers des variables exposées par
`Odoo_CloudRun` ou `Odoo_GKE`.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

`Odoo_Common` prend en charge quatre aspects identiques sur les deux plateformes
de déploiement :

1. **Secret d'administration généré automatiquement** — crée `ODOO_MASTER_PASS` dans Secret Manager.
2. **Câblage de l'image de conteneur** — définit la source de l'image (`custom`), le canal de version (`18.0` par
   défaut) et toutes les variables d'environnement propres à Odoo.
3. **Définitions de stockage** — définit le bucket GCS `odoo-addons` pour les addons personnalisés et
   communautaires.
4. **Jobs d'initialisation** — définit la séquence ordonnée de deux jobs (`nfs-init` → `db-init`)
   qui s'exécute avant le conteneur Odoo principal à chaque déploiement.

---

## 2. Identifiant d'administration {#2-admin-credential}

L'interface de gestion des bases de données d'Odoo (`/web/database/manager`) et le compte
administrateur initial sont protégés par le **mot de passe maître Odoo**. `Odoo_Common` génère un
mot de passe maître alphanumérique de 16 caractères et le stocke sous forme de secret Secret Manager. Le
nom du secret utilise un identifiant aléatoire interne (et non l'ID de déploiement fourni par l'utilisateur) afin d'éviter
les cycles de dépendance au moment du plan.

Vous ne définissez jamais ce mot de passe en clair. Après le premier déploiement, vous pouvez le récupérer avec :

```bash
# List secrets containing the master password:
gcloud secrets list --project "$PROJECT" --filter="name~master-password"
# Access the value:
gcloud secrets versions access latest \
  --secret=<master-password-secret-name> --project "$PROJECT"
```

Pour utiliser un mot de passe maître précis au lieu de celui généré, transmettez une valeur pour
`ODOO_MASTER_PASS` via `explicit_secret_values` dans `Odoo_CloudRun` ou `Odoo_GKE`.

---

## 3. Image de conteneur et build personnalisé {#3-container-image--custom-build}

Odoo est déployé à partir d'une **image Ubuntu Noble personnalisée** construite par Cloud Build à partir du Dockerfile
situé dans `Odoo_Common/scripts/`. Le build :

- Installe Odoo Community Edition depuis le dépôt officiel de paquets `.deb` nightly d'Odoo
  pour le canal de version sélectionné (par défaut `18.0`).
- Installe `wkhtmltopdf` pour la génération des rapports PDF (factures, bons de commande clients, bons de commande fournisseurs,
  rapports financiers).
- Installe `postgresql-client` pour le job `db-init` et les scripts de contrôle de santé.
- Configure l'utilisateur du processus Odoo (UID 101) et le fichier de configuration qui lit les informations
  de connexion à la base de données à partir des variables d'environnement injectées à l'exécution.

L'image est poussée vers Artifact Registry dans votre projet et mise en miroir depuis cet emplacement à chaque
déploiement.

Pour vérifier l'image en cours d'exécution :

```bash
# Cloud Run:
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
# GKE:
kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].spec.containers[0].image}'
```

---

## 4. Variables d'environnement préconfigurées {#4-pre-configured-environment-variables}

`Odoo_Common` injecte automatiquement les variables d'environnement suivantes dans chaque conteneur
Odoo. Les variables SMTP sont pré-renseignées avec des valeurs par défaut que vous devez compléter :

| Variable | Rôle |
|---|---|
| `ODOO_MASTER_PASS` | Mot de passe maître injecté depuis Secret Manager (voir ci-dessus). |
| `DB_HOST` | Hôte PostgreSQL. **Dépend de la plateforme** — sur Cloud Run, il n'y a pas de proxy `127.0.0.1` ; il s'agit du **répertoire** du socket Unix du Cloud SQL Auth Proxy (par ex. `/cloudsql/<instance>`). Sur GKE, cloud-sql-proxy s'exécute en sidecar et `DB_HOST` vaut `127.0.0.1`. |
| `DB_PORT` | Port PostgreSQL — `5432`. |
| `DB_USER` | Utilisateur de la base de données de l'application (issu de `application_database_user`). |
| `DB_NAME` | Nom de la base de données de l'application (issu de `application_database_name`). |
| `DB_PASSWORD` | Mot de passe de la base de données injecté depuis Secret Manager. |
| `REDIS_HOST` | Point de terminaison Redis (chaîne vide lorsque Redis est désactivé). |
| `REDIS_PORT` | Port Redis (par défaut `6379`). |
| `SMTP_HOST` | Nom d'hôte du relais de messagerie sortant. À définir pour l'envoi d'e-mails. |
| `SMTP_PORT` | Port SMTP (par défaut `25`). |
| `SMTP_USER` | Nom d'utilisateur pour l'authentification SMTP. |
| `SMTP_SSL` | Chaîne de type booléen — `"true"` active SSL/STARTTLS, `"false"` (par défaut) le désactive. |
| `EMAIL_FROM` | Adresse d'expéditeur par défaut pour les e-mails sortants. |
| `SMTP_PASSWORD` | Mot de passe SMTP — à transmettre via `secret_environment_variables`. |

Des variables en clair supplémentaires peuvent être ajoutées via `environment_variables`, et des références
Secret Manager supplémentaires via `secret_environment_variables` dans le module appelant.

---

## 5. Séquence des jobs d'initialisation {#5-initialization-job-sequence}

À chaque déploiement, deux Cloud Run Jobs (ou Jobs Kubernetes) s'exécutent dans l'ordre avant le démarrage du service
ou de la charge de travail Odoo. Les deux jobs sont idempotents et peuvent être relancés sans risque.

**Job 1 — `nfs-init`** (s'exécute en premier)

- Image : `alpine:3.19`
- Crée les répertoires `/mnt/filestore`, `/mnt/sessions` et `/mnt/extra-addons` sur le
  partage NFS Filestore.
- Attribue la propriété à `101:101` (l'UID/GID du processus Odoo) et les permissions `777`.
- Odoo ne démarrera pas si ces répertoires sont absents ou si leur propriétaire est incorrect.

**Job 2 — `db-init`** (s'exécute après `nfs-init`)

- Image : `postgres:15-alpine`
- Exécute `db-init.sh`, qui crée l'utilisateur et la base de données de l'application dans Cloud SQL
  for PostgreSQL s'ils n'existent pas déjà.
- Lit `DB_PASSWORD` et `ROOT_PASSWORD` depuis Secret Manager au moment de l'exécution.
- Aucune modification du schéma — la création du schéma est assurée par Odoo au premier démarrage du service.

Pour inspecter les journaux des jobs :

```bash
# Cloud Run:
gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job db-init  --project "$PROJECT" --region "$REGION"
# GKE:
kubectl get jobs -n "$NAMESPACE"
kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
kubectl logs -n "$NAMESPACE" -l job-name=db-init
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`Odoo_Common` définit les valeurs par défaut suivantes pour les sondes. `Odoo_CloudRun` et `Odoo_GKE` les appliquent
sans modification, sauf si vous les remplacez explicitement.

**Sonde de démarrage** — tolère la longue création du schéma lors du premier démarrage :

| Plateforme | Type | Délai initial | Période | Seuil | Attente maximale |
|---|---|---|---|---|---|
| Cloud Run | TCP (port 8069) | 60 s | — | — | ~9 min |
| GKE | HTTP `/web/health` | 180 s | 120 s | 3 | ~9 min |

Le gestionnaire HTTP d'Odoo n'est pas disponible tant que le module `base` n'est pas entièrement installé et que la
base de données n'a pas été initialisée. Lors du tout premier déploiement, cela peut prendre de 2 à 10 minutes selon
la CPU disponible. Augmentez le seuil d'échec si vous constatez des échecs de la sonde de démarrage sur une
nouvelle installation.

**Sonde de vivacité** — vérifie qu'Odoo dispose d'une connexion active à la base de données :

| Plateforme | Type | Chemin | Délai initial | Période |
|---|---|---|---|---|
| Cloud Run | HTTP | `/web/health` | 120 s | 30 s |
| GKE | HTTP | `/web/health` | 30 s | 30 s |

`/web/health` ne renvoie `HTTP 200` que lorsqu'Odoo s'est connecté avec succès à PostgreSQL.
Une réponse 5xx ou un refus de connexion de ce point de terminaison signifie que la base de données est injoignable ou
qu'Odoo a planté.

```bash
# Manually test the health endpoint:
curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
# Expected: 200
```

---

## 7. Stockage d'objets — bucket des addons Odoo {#7-object-storage--odoo-addons-bucket}

`Odoo_Common` définit un bucket Cloud Storage :

| Suffixe du bucket | Chemin de montage | Rôle |
|---|---|---|
| `odoo-addons` | `/mnt/extra-addons` (GCS Fuse) | Addons Odoo personnalisés et communautaires |

Le bucket est monté en lecture-écriture dans le conteneur Odoo via GCS Fuse. Placez les répertoires de vos
modules Odoo personnalisés directement à la racine du bucket ; Odoo les découvre via l'entrée de configuration `addons_path`
qui pointe vers `/mnt/extra-addons`.

```bash
# List the addons bucket:
gcloud storage ls gs://<addons-bucket>/
# Upload a custom addon:
gcloud storage cp -r ./my_custom_addon gs://<addons-bucket>/my_custom_addon/
```

---

Pour les variables de déploiement et les options propres à chaque plateforme, consultez
**[Odoo_CloudRun](Odoo_CloudRun.md)** ou **[Odoo_GKE](Odoo_GKE.md)**. Pour l'infrastructure
partagée dont dépendent les deux plateformes, consultez le
[guide de la plateforme Services_GCP](./Services_GCP.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Odoo sur Cloud Run](Odoo_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Odoo sur GKE Autopilot](Odoo_GKE.md) — cette configuration déployée sur GKE.
