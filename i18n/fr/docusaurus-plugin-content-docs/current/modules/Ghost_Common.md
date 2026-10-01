---
title: "Ghost Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Ghost — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Ghost_Common.md @ 3055034 sha256:fc6b48cc0995 -->

# Ghost Common — Configuration applicative partagée {#ghost-common--shared-application-configuration}

`Ghost_Common` est la **couche applicative partagée** de Ghost. Elle n'est pas déployée seule ; elle fournit la configuration propre à Ghost sur laquelle s'appuient à la fois [Ghost_GKE](Ghost_GKE.md) et [Ghost_CloudRun](Ghost_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où c'est important. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Ghost, consultez les guides des plateformes ([Ghost_GKE](Ghost_GKE.md), [Ghost_CloudRun](Ghost_CloudRun.md)) et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Ghost_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle de Ghost et construit une variante personnalisée via un Dockerfile (`curl`, `jq`, `netcat-openbsd`, `default-mysql-client`) | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Installe un script de démarrage qui détecte l'URL du service, associe les variables d'environnement de base de données du socle aux paramètres `database__connection__*` de Ghost, injecte `database__client=mysql` et répare automatiquement un verrou de migration périmé du premier démarrage | Comportement de l'application dans les guides des plateformes |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job `db-init` du premier déploiement, qui crée la base de données avec le jeu de caractères `utf8mb4`, crée l'utilisateur et accorde les privilèges | Sortie `initialization_jobs` |
| Stockage objet | Déclare un bucket **Cloud Storage** (suffixe `content`) | Sortie `storage_buckets` |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage (`/`, délai initial de 90s, 10 échecs) et de vivacité (`/`, délai de 60s) | §Observabilité dans les guides des plateformes |
| Sonde de disponibilité | HTTP `/`, délai initial de 30s, période de 10s, 3 échecs | Appliquée au conteneur en cours d'exécution |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

`Ghost_Common` étend l'image officielle `ghost:<version>` de Docker Hub avec un Dockerfile personnalisé qui installe `curl`, `jq`, `netcat-openbsd` et `default-mysql-client` (ce dernier permet au point d'entrée de libérer un verrou de migration périmé — voir l'étape 5 ci-dessous), puis ajoute un script de démarrage (`entrypoint.sh`) en tant que `/usr/local/bin/custom-entrypoint.sh`.

Le script de démarrage effectue les actions suivantes à chaque démarrage du conteneur :

1. **Détection de l'URL du service.** Interroge l'API de métadonnées GCP (`/computeMetadata/v1/instance/service-accounts/default/token`, l'API Cloud Run et `K_SERVICE`) pour découvrir l'URL publique du service, et l'exporte en tant que `url` et `admin__url` pour Ghost. Une variable d'environnement `url` explicite est prioritaire ; sinon, il se rabat sur `CLOUDRUN_SERVICE_URL` injectée par le socle, puis sur `GKE_SERVICE_URL`, puis sur `http://localhost:2368` pour le développement local.
2. **Association des identifiants de la base de données.** Associe `DB_HOST` (ou `DB_IP` en repli), `DB_USER`, `DB_NAME`, `DB_PASSWORD` et `DB_PORT` — injectées par le socle — aux paramètres `database__connection__socketPath`, `database__connection__host`, `database__connection__user`, `database__connection__database`, `database__connection__password` et `database__connection__port` de Ghost. Lorsque `DB_HOST` commence par `/`, il est traité comme un socket Unix (le chemin du socket du Cloud SQL Auth Proxy).
3. **Association SMTP.** Associe `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_SSL`/`EMAIL_FROM` aux clés nconf `mail__*` de Ghost (Ghost ne lit que `mail__*` ; sans cette association, il se rabat sur un envoi « Direct » non authentifié par le port 25, que l'egress de Cloud Run/GKE bloque, et même l'e-mail de connexion administrateur de Ghost 6 reste bloqué jusqu'à l'expiration de la requête).
4. **Validation de la configuration.** Émet un avertissement lorsque `database__client` n'est pas défini (Ghost se rabattrait sur SQLite) et vérifie la connectivité MySQL avant de démarrer Ghost.
5. **Réparation automatique d'un verrou de migration périmé.** Comme ce module exécute un seul réplica de Ghost, toute ligne `migrations_lock` encore détenue plus de 120 secondes après le démarrage ne peut pas appartenir à une migration légitimement en cours — il s'agit d'un reliquat d'un pod arrêté en pleine migration (apply interrompu, OOM, éviction de nœud). Le point d'entrée supprime uniquement ces verrous périmés avant le démarrage de Ghost, ce qui évite la boucle de plantage permanente (« Migration lock was never released ») qui, autrement, nécessitait une intervention manuelle sur la base de données pour s'en remettre.
6. **Lancement de Ghost.** Délègue à `docker-entrypoint.sh "$@"` — la séquence de démarrage officielle de Ghost.

Pour explorer la configuration en cours d'exécution :

```bash
# Cloud Run — check what URL Ghost detected
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep -E "URL:|Starting Ghost"

# GKE — check the Ghost pod startup output
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "URL:|Database|Starting"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Ghost nécessite **MySQL 8.0** ; le moteur est fixé à `MYSQL_8_0` dans `Ghost_Common` et ne peut pas être remplacé par PostgreSQL. Lors du premier déploiement, un job ponctuel `db-init` se connecte à Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. Crée la base de données Ghost avec `CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` (la valeur par défaut de MySQL 8.0, requise par Ghost 6.x).
2. Crée l'utilisateur de l'application.
3. Accorde tous les privilèges sur la base de données Ghost, ainsi que `CREATE`, `ALTER`, `DROP`, `INDEX`, `REFERENCES` pour les migrations.
4. Envoie un signal d'arrêt `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le Job Kubernetes se termine proprement.

Le job s'exécute à chaque apply (`execute_on_apply = true`) et est idempotent. Inspectez directement la base de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Ghost_Common` établit l'environnement de base de Ghost afin que l'application démarre correctement dès le premier lancement :

- **Client de base de données** — `database__client = "mysql"` est injecté via le point d'entrée. Sans lui, Ghost utilise silencieusement SQLite, même lorsque toutes les autres variables de connexion à la base de données sont présentes.
- **Migrations au démarrage** — Ghost exécute automatiquement ses migrations de base de données à chaque démarrage, de sorte que les mises à niveau de version appliquent les changements de schéma sans étape manuelle.
- **Connaissance de l'URL** — le point d'entrée découvre et exporte l'URL du service au démarrage, afin que Ghost génère des liens absolus corrects dans les newsletters et la navigation de l'administration. C'est indispensable lorsque vous utilisez des domaines personnalisés ou l'URL `run.app` dynamique de Cloud Run.
- **Pré-remplissage SMTP** — le module applicatif appelant pré-remplit `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` et `EMAIL_FROM` en tant que variables d'environnement par défaut. Définissez de vraies valeurs SMTP avant d'inviter des membres — sans configuration SMTP fonctionnelle, Ghost ne peut pas envoyer de confirmations d'inscription, de réinitialisations de mot de passe ni de newsletters.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le chemin racine de Ghost (`/`), qui ne renvoie HTTP 200 qu'une fois l'application entièrement initialisée, avec un délai de démarrage généreux pour permettre les migrations de base de données et la compilation des thèmes du premier démarrage.

- **Sonde de démarrage** — HTTP `/`, délai initial de 90 s, période de 10 s, seuil d'échec de 10. Cela laisse à Ghost jusqu'à 90 + (10 × 10) = 190 secondes à partir du démarrage du conteneur avant qu'il soit arrêté comme non sain.
- **Sonde de vivacité** — HTTP `/`, délai initial de 60 s, période de 30 s, seuil d'échec de 3.
- **Sonde de disponibilité** — HTTP `/`, délai initial de 30 s, période de 10 s, seuil d'échec de 3.

GKE comme Cloud Run utilisent des sondes HTTP sur `/`. Contrairement à Mautic (qui émet des redirections HTTP→HTTPS provoquant des échecs de sonde sur Cloud Run), Ghost sert son chemin racine directement en HTTP sur le port 2368, sans redirection ; les sondes HTTP fonctionnent donc sur les deux plateformes.

Ne réduisez pas `initial_delay_seconds` en dessous de 60 secondes. Au premier démarrage, Ghost doit se connecter à MySQL, exécuter toutes les migrations en attente et compiler les thèmes par défaut avant de pouvoir répondre aux requêtes HTTP. Arrêter Ghost pendant cette fenêtre provoque une boucle de redémarrage.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `content`, par ex. `gcs-ghost<tenant>-content`) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Ce bucket est disponible pour le stockage de contenu via GCS Fuse ou un accès direct par SDK. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~ghost"
```

Combiné au volume Filestore (NFS) partagé, il offre à Ghost un stockage de contenu durable et cohérent entre toutes les instances.

---

Pour la configuration propre à Ghost visible par l'utilisateur (variables par groupe, sorties et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Ghost_GKE](Ghost_GKE.md)** et **[Ghost_CloudRun](Ghost_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Ghost sur Google Cloud Run](Ghost_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Ghost sur GKE Autopilot](Ghost_GKE.md) — cette configuration déployée sur GKE.
