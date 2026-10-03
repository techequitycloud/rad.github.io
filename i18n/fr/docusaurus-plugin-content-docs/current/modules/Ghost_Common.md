---
title: "Ghost Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Ghost — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Ghost_Common.md @ 15fd4c7 sha256:bf410b015624 -->

# Ghost Common — Configuration d'application partagée {#ghost-common--shared-application-configuration}

`Ghost_Common` est la **couche d'application partagée** pour Ghost. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à Ghost sur laquelle [Ghost_GKE](Ghost_GKE.md) et [Ghost_CloudRun](Ghost_CloudRun.md) s'appuient, de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Ghost, consultez les guides de plateforme ([Ghost_GKE](Ghost_GKE.md), [Ghost_CloudRun](Ghost_CloudRun.md)) et les guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Ghost_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle de Ghost et construit une variante personnalisée via un Dockerfile (`curl`, `ca-certificates`, `jq`, `netcat-openbsd`, `default-mysql-client`) | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Installe un script de démarrage qui détecte l'URL du service, mappe les variables d'environnement de la base de données du socle aux paramètres `database__connection__*` de Ghost, injecte `database__client=mysql`, et auto-répare un verrou de migration de premier démarrage périmé | Comportement de l'application dans les guides de plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job `db-init` de premier déploiement qui crée la base de données avec le jeu de caractères `utf8mb4`, crée l'utilisateur et accorde les privilèges | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `content`) | Sortie `storage_buckets` |
| Vérifications de santé | Fournit le comportement par défaut des sondes de démarrage (`/`, délai initial de 90 s, 10 échecs) et de vivacité (`/`, délai de 60 s) | §Observabilité dans les guides de plateforme |
| Sonde de disponibilité | HTTP `/`, délai initial de 30 s, période de 10 s, 3 échecs | Appliqué au conteneur en cours d'exécution |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

`Ghost_Common` étend l'image officielle `ghost:<version>` de Docker Hub avec un Dockerfile personnalisé qui installe `curl`, `ca-certificates`, `jq`, `netcat-openbsd`, et `default-mysql-client` (le dernier permet au point d'entrée de libérer un verrou de migration périmé — voir l'étape 5 ci-dessous), puis ajoute un script de démarrage (`entrypoint.sh`) comme `/usr/local/bin/custom-entrypoint.sh`.

Le script de démarrage effectue ces actions à chaque démarrage de conteneur :

1.  **Détection de l'URL du service.** Interroge l'API de métadonnées GCP (`/computeMetadata/v1/instance/service-accounts/default/token`, l'API Cloud Run, et `K_SERVICE`) pour découvrir l'URL publique du service et l'exporte comme `url` et `admin__url` pour Ghost. Une variable d'environnement explicite `url` a la priorité ; sinon, elle utilise `CLOUDRUN_SERVICE_URL` injectée par le socle, puis `GKE_SERVICE_URL`, puis `http://localhost:2368` pour le développement local.
2.  **Mappage des identifiants de base de données.** Mappe `DB_HOST` (ou `DB_IP` en cas de repli), `DB_USER`, `DB_NAME`, `DB_PASSWORD`, et `DB_PORT` — injectés par le socle — aux paramètres `database__connection__socketPath`, `database__connection__host`, `database__connection__user`, `database__connection__database`, `database__connection__password`, et `database__connection__port` de Ghost. Lorsque `DB_HOST` commence par `/`, il est traité comme un socket Unix (le chemin du socket du proxy d'authentification Cloud SQL).
3.  **Mappage SMTP.** Mappe `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_SSL`/`EMAIL_FROM` aux clés nconf `mail__*` de Ghost (Ghost ne lit que `mail__*` ; sans ce mappage, il utilise la livraison "Directe" non authentifiée sur le port 25, que l'égresse Cloud Run/GKE bloque, et même l'e-mail de connexion de l'administrateur de Ghost 6 reste bloqué jusqu'à l'expiration de la requête).
4.  **Validation de la configuration.** Avertit lorsque `database__client` n'est pas défini (Ghost utiliserait SQLite) et vérifie la connectivité MySQL avant de démarrer Ghost.
5.  **Auto-réparation du verrou de migration périmé.** Étant donné que ce module exécute un seul réplica Ghost, toute ligne `migrations_lock` encore détenue plus de 120 secondes après le démarrage ne peut pas appartenir à une migration légitimement en cours — il s'agit d'un reste d'un pod tué en pleine migration (apply interrompu, OOM, éviction de nœud). Le point d'entrée ne supprime que ces verrous périmés avant le démarrage de Ghost, évitant ainsi la boucle de crash permanente ("Migration lock was never released") qui nécessitait autrement une intervention manuelle sur la base de données pour la récupérer.
6.  **Lancement de Ghost.** Délègue à `docker-entrypoint.sh "$@"` — la séquence de démarrage officielle de Ghost.

Pour explorer la configuration en cours d'exécution :

```bash
# Cloud Run — check what URL Ghost detected
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep -E "URL:|Starting Ghost"

# GKE — check the Ghost pod startup output
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "URL:|Database|Starting"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Ghost nécessite **MySQL 8.0** ; le moteur est fixé à `MYSQL_8_0` à l'intérieur de `Ghost_Common` et ne peut pas être changé en PostgreSQL. Lors du premier déploiement, un job `db-init` ponctuel se connecte à Cloud SQL via le proxy d'authentification et de manière idempotente :

1.  Crée la base de données Ghost avec `CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` (la valeur par défaut de MySQL 8.0, requise par Ghost 6.x).
2.  Crée l'utilisateur de l'application.
3.  Accorde tous les privilèges sur la base de données Ghost plus `CREATE`, `ALTER`, `DROP`, `INDEX`, `REFERENCES` pour les migrations.
4.  Envoie un signal d'arrêt `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le job Kubernetes se termine proprement.

Le job s'exécute à chaque apply (`execute_on_apply = true`) et est idempotent. Inspectez directement la base de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Paramètres d'application principaux {#4-core-application-settings}

`Ghost_Common` établit l'environnement Ghost de base afin que l'application démarre correctement au premier lancement :

-   **Client de base de données** — `database__client = "mysql"` est injecté via le point d'entrée. Sans cela, Ghost utilise silencieusement SQLite, même lorsque toutes les autres variables de connexion à la base de données sont présentes.
-   **Migrations au démarrage** — Ghost exécute automatiquement ses migrations de base de données à chaque démarrage, de sorte que les mises à niveau de version appliquent les modifications de schéma sans étape manuelle.
-   **Connaissance de l'URL** — le point d'entrée découvre et exporte l'URL du service au démarrage afin que Ghost génère des liens absolus corrects dans les newsletters et la navigation d'administration. Ceci est essentiel lors de l'utilisation de domaines personnalisés ou de l'URL dynamique `run.app` de Cloud Run.
-   **Pré-remplissage SMTP** — le module d'application appelant pré-remplit `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, et `EMAIL_FROM` comme variables d'environnement par défaut. Définissez de vraies valeurs SMTP avant d'inviter des membres — sans une configuration SMTP fonctionnelle, Ghost ne peut pas envoyer de confirmations d'inscription, de réinitialisations de mot de passe ou de newsletters.

---

## 5. Comportement de la sonde de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le chemin racine de Ghost (`/`), qui renvoie HTTP 200 seulement une fois l'application entièrement initialisée, avec un délai de démarrage généreux pour permettre les migrations de base de données au premier démarrage et la compilation des thèmes.

-   **Sonde de démarrage** — HTTP `/`, délai initial 90 s, période 10 s, seuil d'échec 10. Cela donne à Ghost jusqu'à 90 + (10 × 10) = 190 secondes à partir du démarrage du conteneur avant qu'il ne soit tué comme étant en mauvaise santé.
-   **Sonde de vivacité** — HTTP `/`, délai initial 60 s, période 30 s, seuil d'échec 3.
-   **Sonde de disponibilité** — HTTP `/`, délai initial 30 s, période 10 s, seuil d'échec 3.

GKE et Cloud Run utilisent tous deux des sondes HTTP contre `/`. Contrairement à Mautic (qui émet des redirections HTTP→HTTPS provoquant des échecs de sonde sur Cloud Run), Ghost sert son chemin racine directement sur HTTP sur le port 2368 sans redirection, de sorte que les sondes HTTP fonctionnent sur les deux plateformes.

Ne réduisez pas `initial_delay_seconds` en dessous de 60 secondes. Au premier démarrage, Ghost doit se connecter à MySQL, exécuter toutes les migrations en attente et compiler les thèmes par défaut avant de pouvoir répondre aux requêtes HTTP. Tuer Ghost pendant cette fenêtre produit une boucle de redémarrage.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `content`, par exemple `gcs-ghost<tenant>-content`) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Ce bucket est disponible pour le stockage de contenu via GCS Fuse ou un accès direct au SDK. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~ghost"
```

Combiné au volume Filestore (NFS) partagé, cela donne à Ghost un stockage de contenu durable et cohérent sur toutes les instances.

---

Pour la configuration spécifique à Ghost et destinée aux utilisateurs (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[Ghost_GKE](Ghost_GKE.md)** et **[Ghost_CloudRun](Ghost_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

-   [Ghost sur Google Cloud Run](Ghost_CloudRun.md) — cette configuration déployée sur Cloud Run.
-   [Ghost sur GKE Autopilot](Ghost_GKE.md) — cette configuration déployée sur GKE.
