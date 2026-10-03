---
title: "Stalwart Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Stalwart — paramètres de la couche application consommés par le déploiement GKE Autopilot."
---

<!-- translated-from: docs/modules/Stalwart_Common.md @ 2829548 sha256:90e5e9537042 -->

# Stalwart Common — Configuration d'application partagée {#stalwart-common--shared-application-configuration}

`Stalwart_Common` est la **couche d'application partagée** pour Stalwart Mail Server.
Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à
Stalwart sur laquelle [Stalwart_GKE](Stalwart_GKE.md) s'appuie. Il n'existe pas de
variante Cloud Run (voir [§6](#6-why-gke-only)). Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a pas ses propres entrées
d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans le guide de la plateforme.

Pour l'infrastructure qui provisionne et exécute Stalwart, consultez le guide de
la plateforme ([Stalwart_GKE](Stalwart_GKE.md)) et les guides de base
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Stalwart_Common | Où cela apparaît |
|---|---|---|
| Secrets d'application | **Aucun.** L'identifiant de la base de données est créé par la fondation ; l'administrateur de démarrage est fourni par l'opérateur comme `STALWART_RECOVERY_ADMIN` | Les sorties `secret_ids` / `secret_values` sont vides |
| Image de conteneur | Enveloppe l'image officielle `stalwartlabs/stalwart` (tag par défaut `v0.16.22`) avec un point d'entrée qui génère `config.json` ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Cloud SQL pour MySQL 8.0** (`database_type = "MYSQL_8_0"`), accessible via l'IP privée sans Auth Proxy (`enable_cloudsql_volume = false`) | §Base de données dans le guide de la plateforme |
| Démarrage de la base de données | **Aucun job.** L'étape `db-create` de la fondation crée la base de données et l'utilisateur ; Stalwart crée son propre schéma lors de la première connexion | `initialization_jobs` est vide sauf si vous fournissez des jobs |
| Stockage d'objets | Ne déclare **aucun** bucket | Sortie `storage_buckets` (vide) |
| Paramètres de base | `container_port = 443` ; `STALWART_PUBLIC_URL` (vide) et `STALWART_DATASTORE_TYPE` (`MySql`) | Comportement de l'application dans le guide de la plateforme |
| Vérifications de santé | Transmet les sondes qui lui sont données (le module de plateforme fournit des sondes TCP sur 443) | §Observabilité dans le guide de la plateforme |

---

## 2. Modèle de configuration de Stalwart {#2-stalwarts-configuration-model}

Stalwart divise sa configuration en deux :

- **`/etc/stalwart/config.json`** ne contient *que* l'objet **DataStore** — le fichier
  *est* cet objet, indexé par un discriminateur `@type` (`MySql`, `PostgreSql`, et
  d'autres variantes que ce module n'utilise pas). Il n'est pas livré dans l'image.
- **Tout le reste** — domaines, écouteurs, TLS, le répertoire d'authentification —
  réside dans la base de données et est géré via l'API de Stalwart avec `stalwart-cli`.

Le `CMD` de l'image est `--config /etc/stalwart/config.json`. Parce que `App_GKE` n'a
aucun moyen de monter un ConfigMap dans le conteneur de l'application, Terraform ne peut pas projeter
le fichier, donc cette couche construit une image wrapper mince qui le **génère** au
démarrage du conteneur.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

Le Dockerfile est `FROM stalwartlabs/stalwart:${STALWART_VERSION}`. L'argument de construction
est spécifique à l'application (le générique `APP_VERSION` que la fondation injecte n'est pas
utilisé) ; le tag par défaut est `v0.16.22`, et le `application_version` propre au module de plateforme
est la valeur qui prend effet. Le Dockerfile passe en root uniquement pour copier le point d'entrée,
revient à l'utilisateur non privilégié `stalwart` de l'image (uid 2000, qui possède `/etc/stalwart` et `/var/lib/stalwart`),
définit le nouveau `ENTRYPOINT`, et **redéfinit `CMD ["--config", "/etc/stalwart/config.json"]`** —
Docker réinitialise un `CMD` hérité chaque fois qu'un Dockerfile définit `ENTRYPOINT`, et un
Stalwart démarré sans son argument de configuration ouvre le port 8080 en mode bootstrap.

`scripts/entrypoint.sh` (POSIX `sh`, nu `set -e`) alors :

1. **Refuse de démarrer sans les paramètres de la base de données.** `DB_IP`, `DB_NAME`,
   `DB_USER` et `DB_PASSWORD` doivent tous être non vides ; sinon, il se termine avec un
   message `FATAL`. Démarrer sans fichier de configuration ne ferait pas échouer — il ouvrirait
   8080 et semblerait sain pour le `HEALTHCHECK` propre à l'image.
2. **Crée `/var/log/stalwart`** de manière défensive. Le binaire y fait référence mais l'image
   ne le crée jamais ; la journalisation reste sur stdout, où Cloud Logging la collecte.
3. **Sélectionne le type de DataStore** à partir de `STALWART_DATASTORE_TYPE` — `MySql`
   (port par défaut 3306) ou `PostgreSql` (5432) — et se termine sur toute autre valeur.
4. **Écrit `config.json`** (`umask 077`), par exemple :

   ```json
   {
     "@type": "MySql",
     "host": "10.x.x.x",
     "port": 3306,
     "database": "<database>",
     "authUsername": "<user>",
     "authSecret": { "@type": "EnvironmentVariable", "variableName": "DB_PASSWORD" },
     "useTls": false,
     "allowInvalidCerts": false
   }
   ```

   `host` est `DB_IP`, l'IP privée brute de Cloud SQL (`DB_HOST` n'est pas utilisable : sa
   forme de répertoire de socket n'est pas un hôte TCP). `port` est `DB_PORT` lorsqu'il est défini.
   `useTls` et `allowInvalidCerts` proviennent de `STALWART_DB_USE_TLS` et
   `STALWART_DB_ALLOW_INVALID_CERTS`, tous deux par défaut à `false`. **Aucun identifiant n'est
   écrit dans le fichier** — `authSecret` nomme la variable d'environnement `DB_PASSWORD`,
   que Stalwart lit à l'exécution.
5. **Journalise ce qu'il a fait** — la cible du DataStore, si `STALWART_RECOVERY_ADMIN`
   est défini, et un rappel que 443 (pas 8080) est l'écouteur attendu — et
   `exec` `/usr/local/bin/stalwart` avec les arguments de l'image.

Le fichier est réécrit à chaque démarrage. `/etc/stalwart` n'est délibérément pas
persisté : le fichier est entièrement dérivé des variables de la plateforme, et une
copie persistée ne pourrait que dériver de la base de données réellement provisionnée.

---

## 4. Moteur de base de données {#4-database-engine}

`STALWART_DATASTORE_TYPE` est dérivé du `database_type` de cette couche : toute variante MySQL
(`MYSQL`, `MYSQL_5_6`, `MYSQL_5_7`, `MYSQL_8_0`, `MYSQL_8_4`) rend
`MySql` ; tout le reste rend `PostgreSql`. La valeur par défaut — et, parce que le wrapper GKE
ne transmet pas son propre `database_type`, la valeur toujours en vigueur
— est **`MYSQL_8_0`**, le moteur contre lequel le module a été déployé et vérifié
(Stalwart a créé 27 tables lors de la première connexion).

`enable_cloudsql_volume` est fixé à `false` : le DataStore prend un hôte TCP simple,
donc un sidecar Auth Proxy ne serait jamais appelé — et dans le chemin du job, un qui
ne se termine jamais bloquerait `db-create` jusqu'à sa date limite.

Aucun job d'initialisation n'est défini. Fournir `initialization_jobs` ajoute vos propres
jobs ; aucun n'est nécessaire pour Stalwart lui-même.

---

## 5. Accès administrateur, secrets et réplicas {#5-administrator-access-secrets-and-replicas}

- **Administrateur.** `STALWART_RECOVERY_ADMIN`, avec la valeur `username:password`,
  appartient à `secret_environment_variables` (de Secret Manager). S'il n'est pas défini,
  Stalwart génère un mot de passe administrateur aléatoire et l'imprime une fois dans le
  journal du conteneur. Les entrées `admin_username` et `admin_email` de cette couche
  sont uniquement informatives.
- **Secrets.** Cette couche ne crée aucun secret et n'active aucune API.
- **URL publique.** `STALWART_PUBLIC_URL` est l'URL de base que Stalwart publie pour
  la découverte OAuth, OIDC et JMAP. Elle est vide par défaut à dessein — une mauvaise valeur
  est transmise aux clients dans les documents de découverte.
- **Réplica unique.** L'exécution de plusieurs réplicas Stalwart nécessite son
  coordinateur, qui a besoin de Redis. La connexion Redis de Stalwart est une URL
  (`redis://user:pass@host:port`), donc une chaîne AUTH Memorystore devrait être
  encodée en pourcentage ; le module ne le fait pas et est conçu pour exécuter un
  réplica. (Cette couche transmet `max_instance_count` sans modification, donc la
  valeur du module de plateforme décide.)

---

## 6. Pourquoi GKE uniquement {#6-why-gke-only}

- **Protocole.** SMTP, IMAP, POP3 et ManageSieve sont des protocoles ligne par ligne ; Cloud Run
  ne transmet que HTTP/gRPC.
- **Le contrat `$PORT` est inversé.** Stalwart sert normalement sur le port **443**. Le port
  **8080** s'ouvre dans exactement deux états anormaux — "Aucun fichier de configuration n'a été trouvé.
  Le port 8080 est ouvert pour la configuration initiale" et "Le démarrage a échoué. Le port 8080 est ouvert pour
  le dépannage et la récupération." Un conteneur Cloud Run satisferait `$PORT=8080`
  précisément lorsqu'il n'était pas configuré ou qu'il avait planté.

---

## 7. Comportement de la sonde de santé {#7-health-probe-behaviour}

Le `HEALTHCHECK` de l'image est
`curl -fsSk https://127.0.0.1:443/healthz/live || curl -fsS http://127.0.0.1:8080/healthz/live`,
il signale donc un serveur bloqué sur 8080 comme étant sain. Cette couche définit `container_port =
443`, et le module de plateforme fournit des sondes **TCP** contre celui-ci :

- Un serveur qui a **échoué au démarrage** ne lie que 8080, donc la vérification TCP sur 443 échoue —
  correctement.
- Un serveur qui a démarré avec son DataStore connecté mais **sans configuration de serveur**
  lie également 443 (les deux 443 et 8080 ont répondu 200 sur le déploiement vérifié),
  donc la sonde passe. Le signe est que 8080 est toujours ouvert, ce qu'aucune
  sonde Kubernetes ne peut exprimer ; vérifiez-le manuellement (voir le guide de la plateforme).

Une sonde HTTP n'est pas une option : la sonde HTTP de `App_GKE` n'a pas de champ `scheme` et
ne peut pas vérifier un port HTTPS. Ne redirigez jamais une sonde défaillante vers 8080.

---

## 8. Ce qui n'est pas câblé {#8-what-is-not-wired}

**Domaines, écouteurs et TLS.** Le chemin déclaratif du fournisseur est : écrire
`config.json`, démarrer avec `STALWART_RECOVERY_MODE=1` et `STALWART_RECOVERY_ADMIN`,
exécuter `stalwart-cli apply` avec un plan JSON, puis redémarrer sans les
variables de récupération. `stalwart-cli` est un binaire séparé publié comme sa propre image
(`ghcr.io/stalwartlabs/cli`), donc cette étape serait un job d'initialisation utilisant
cette image. Il n'est pas câblé, car chaque valeur d'un tel plan concerne un vrai
domaine de messagerie. Tant qu'il n'est pas appliqué, le serveur fonctionne avec son DataStore configuré et
ses valeurs par défaut pour tout le reste.

**Envoi de courrier.** Google Cloud bloque le port TCP 25 sortant de chaque VM et pod, donc
la livraison MX directe est impossible ; le courrier sortant nécessite un hôte intelligent sur 587. Le port
25 entrant n'est pas affecté. Un déploiement de production nécessite également un domaine avec des enregistrements MX,
DNS direct et inverse, et SPF/DKIM/DMARC.

---

Pour la configuration spécifique à Stalwart et destinée à l'utilisateur (variables par groupe, la carte des ports, les sorties et comment explorer chaque service depuis la Console et la CLI), consultez le guide de la plateforme : **[Stalwart_GKE](Stalwart_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Stalwart sur GKE Autopilot](Stalwart_GKE.md) — cette configuration déployée sur GKE.
