---
title: "Open WebUI Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Open WebUI — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OpenWebUI_Common.md @ 3055034 sha256:abfeff9becd4 -->

# Open WebUI Common — Configuration applicative partagée {#open-webui-common--shared-application-configuration}

`OpenWebUI_Common` est la **couche applicative partagée** d'Open WebUI. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Open WebUI sur laquelle
s'appuient à la fois [OpenWebUI_GKE](OpenWebUI_GKE.md) et
[OpenWebUI_CloudRun](OpenWebUI_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Open WebUI, consultez
les guides des plateformes ([OpenWebUI_GKE](OpenWebUI_GKE.md),
[OpenWebUI_CloudRun](OpenWebUI_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par OpenWebUI_Common | Où cela apparaît |
|---|---|---|
| Clé de session | Génère `WEBUI_SECRET_KEY` et la stocke dans **Secret Manager** | Injectée comme variable d'environnement secrète dans les deux variantes de plateforme |
| Image de conteneur | Épingle `ghcr.io/open-webui/open-webui` et l'enveloppe d'un point d'entrée personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job `db-init` du premier déploiement, qui crée la base de données et l'utilisateur | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** (`openwebui-data`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Open WebUI de référence : URL des backends d'IA, politique d'inscription des utilisateurs, interrupteur d'authentification, désactivation de la télémétrie | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage et de vivacité ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Clé de session dans Secret Manager {#2-session-key-in-secret-manager}

La `WEBUI_SECRET_KEY` est générée automatiquement et stockée sous forme de secret
Secret Manager — elle n'est jamais définie en texte clair. Open WebUI l'utilise pour
signer toutes les sessions utilisateur.

```bash
# List and read the secret (the name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

**Important :** cette clé est immuable après la première connexion d'un utilisateur. La
modifier déconnecte immédiatement tous les utilisateurs actifs et invalide tous les
jetons « se souvenir de moi ». N'effectuez pas sa rotation sans planifier une fenêtre de
maintenance.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Open WebUI nécessite **PostgreSQL 15** ; le moteur est fixe et aucun autre type de base
de données n'est pris en charge. Lors du premier déploiement, un job ponctuel `db-init`
exécute `postgres:15-alpine`, se connecte à Cloud SQL via l'Auth Proxy et, de manière
idempotente :

1. crée la base de données Open WebUI (si elle n'existe pas),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. accorde à cet utilisateur tous les privilèges sur cette base de données.

Le job peut être réexécuté sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
  --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Paramètres de base de l'application {#4-core-application-settings}

`OpenWebUI_Common` établit l'environnement Open WebUI de référence afin que
l'application démarre correctement dès le premier démarrage :

- **URL des backends d'IA** — `OLLAMA_BASE_URL` et `OPENAI_API_BASE_URL` sont définies à
  partir des variables du module appelant. Toutes deux sont vides par défaut
  (désactivées). Au moins l'une doit être définie pour que l'application dispose d'un
  backend d'IA fonctionnel.
- **Politique d'inscription des utilisateurs** — `DEFAULT_USER_ROLE`, `ENABLE_SIGNUP` et
  `WEBUI_AUTH` contrôlent qui peut s'inscrire et comment les nouveaux comptes sont
  activés (configurables dans le groupe 5 des modules de plateforme).
- **Désactivation de la télémétrie** — `SCARF_NO_ANALYTICS=true`, `DO_NOT_TRACK=true` et
  `ANONYMIZED_TELEMETRY=false` sont codés en dur, à l'image des valeurs par défaut de
  l'image officielle.
- **Répertoire de données** — `DATA_DIR=/app/backend/data` indique à Open WebUI où
  écrire ses fichiers de données backend dans le conteneur.
- **`WEBUI_URL`** — définie sur l'URL prévue du service afin qu'Open WebUI génère des
  liens absolus et des URI de redirection OAuth corrects.

---

## 5. Assemblage de `DATABASE_URL` et point d'entrée personnalisé {#5-database_url-assembly-and-the-custom-entrypoint}

L'image officielle d'Open WebUI attend une variable d'environnement `DATABASE_URL`. Au
lieu de stocker le mot de passe de la base de données en texte clair, une enveloppe
personnalisée `entrypoint.sh` assemble `DATABASE_URL` au démarrage du conteneur à partir
des variables d'environnement `DB_HOST`, `DB_USER`, `DB_PASSWORD` et `DB_NAME` injectées
par la plateforme. Le mot de passe est au passage encodé pour URL afin que les
caractères spéciaux ne perturbent pas l'analyse de l'URL.

- Lorsque le Cloud SQL Auth Proxy est activé, `DB_HOST` pointe vers le répertoire du
  socket Unix (`/cloudsql`). Le point d'entrée le détecte et construit la forme
  appropriée avec le paramètre de requête `host=` pour psycopg2.
- Lors d'une connexion en TCP (PostgreSQL externe), `DB_HOST` est l'IP ou le nom d'hôte
  et une URL standard `postgresql://user:password@host/dbname` est assemblée.

Si `DATABASE_URL` est déjà définie, l'enveloppe la laisse telle quelle et ignore
entièrement l'étape d'assemblage.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison natif `/health` d'Open WebUI en
HTTP GET. Ce point de terminaison renvoie HTTP 200 dès que le processus applicatif et sa
connexion à la base de données sont prêts.

- La sonde de démarrage accorde un délai initial de 30 secondes et jusqu'à 30 échecs
  (300 secondes au total) pour laisser le temps aux migrations de la base de données du
  premier démarrage — elles peuvent prendre 30 à 60 secondes sur une instance PostgreSQL
  neuve.
- La sonde de vivacité démarre après un délai initial de 60 secondes et tolère 3 échecs
  avant le redémarrage du pod.
- GKE et Cloud Run utilisent tous deux des sondes HTTP sur `/health`. Contrairement à
  certaines applications PHP/Apache qui émettent des redirections HTTP→HTTPS, Open WebUI
  sert `/health` en HTTP simple sans redirection ; les sondes HTTP fonctionnent donc
  correctement sur les deux plateformes.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (`openwebui-data`) est déclaré ici et provisionné par
le socle, qui accorde également l'accès au compte de service de la charge de travail. Le
répertoire de données backend d'Open WebUI (`DATA_DIR`) pointe vers ce bucket lorsqu'un
montage GCS Fuse est configuré. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Open WebUI destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[OpenWebUI_GKE](OpenWebUI_GKE.md)** et
**[OpenWebUI_CloudRun](OpenWebUI_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Open WebUI sur GKE Autopilot](OpenWebUI_GKE.md) — cette configuration déployée sur GKE.
