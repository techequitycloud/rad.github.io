---
title: "SimpleRisk Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module SimpleRisk — paramètres de la couche application consommés par le déploiement Google Cloud Run."
---

<!-- translated-from: docs/modules/SimpleRisk_Common.md @ 2829548 sha256:3aef391c55cd -->

# SimpleRisk Common — Configuration d'application partagée {#simplerisk-common--shared-application-configuration}

`SimpleRisk_Common` est la **couche d'application partagée** pour SimpleRisk. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à SimpleRisk
sur laquelle [SimpleRisk_CloudRun](SimpleRisk_CloudRun.md) s'appuie. (Il n'existe
actuellement pas de variante GKE de SimpleRisk.) Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a pas d'entrées d'interface
utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans le guide de la plateforme.

Pour l'infrastructure qui provisionne et exécute SimpleRisk, consultez le
guide de la plateforme ([SimpleRisk_CloudRun](SimpleRisk_CloudRun.md)) et les
guides de base ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par SimpleRisk_Common | Où cela apparaît |
|---|---|---|
| Secrets d'application | **Aucun** — le seul identifiant de SimpleRisk est le mot de passe de la base de données, que la fondation génère | Les sorties `secret_ids` / `secret_values` sont vides |
| Image de conteneur | Enveloppe l'image officielle `simplerisk/simplerisk` avec un point d'entrée de remplacement et un vhost Apache réécrit ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** (`database_type = "MYSQL_8_0"`) et désactive le socket du proxy d'authentification (`enable_cloudsql_volume = false`) | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Définit deux jobs ordonnés : `db-init` (base de données, utilisateur, autorisations) et `schema-load` (charge le schéma de SimpleRisk) | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket `storage` et, par défaut, le monte avec GCS-FUSE à `/var/www/simplerisk/files` | Sortie `storage_buckets` |
| Paramètres de base | Définit `DB_PORT = "3306"` et `memory_limit` (à partir de `php_memory_limit`) ; le port du conteneur est 80 | Comportement de l'application dans le guide de la plateforme |
| Vérifications de santé | Transmet les sondes de démarrage/vivacité HTTP sur `/` | §Observabilité dans le guide de la plateforme |

---

## 2. Pourquoi l'image du fournisseur est enveloppée {#2-why-the-vendor-image-is-wrapped}

`simplerisk/simplerisk` est une appliance tout-en-un, pas une application à douze facteurs. Son
propre point d'entrée :

- code en dur `127.0.0.1` / `simplerisk` / `simplerisk` comme hôte, utilisateur
  et base de données — des littéraux dans le script, pas des lectures d'environnement,
  donc aucune base de données externe ne peut être injectée ;
- génère un mot de passe de base de données aléatoire dans `/passwords/` au premier démarrage ;
- démarre un serveur MySQL **à l'intérieur du conteneur** et y charge `/simplerisk.sql` ;
- conserve tout cela dans des volumes Docker `VOLUME` (`/passwords`, `/configurations`,
  `/var/lib/mysql`).

Sur Cloud Run, chacun de ces chemins est éphémère. L'image de base démarrerait,
créerait une base de données vide, servirait normalement — et perdrait tout le
registre des risques au prochain démarrage à froid, sans erreur. L'image
d'enveloppe **remplace** donc le point d'entrée du fournisseur (elle ne lui
délègue pas) et pointe SimpleRisk vers l'instance Cloud SQL de la fondation.

L'image est construite `FROM simplerisk/simplerisk:${SIMPLERISK_VERSION}`. L'argument de construction
est spécifique à l'application car les tags SimpleRisk sont des **ID de build
datés** (par exemple `20260909-001`), pas des semver — le générique `APP_VERSION` que la fondation
injecte résoudrait un tag qui n'existe pas. La valeur par défaut `application_version` de cette
couche est `latest`, mais le module de la plateforme transmet sa propre
valeur épinglée (`20260909-001`), qui est celle qui prend effet.

---

## 3. Le point d'entrée {#3-the-entrypoint}

`scripts/entrypoint.sh` s'exécute à chaque démarrage de conteneur et :

1. **Vérifie ses entrées.** Il se termine si `DB_IP`, `DB_NAME`, `DB_USER` ou
   `DB_PASSWORD` n'est pas défini, ou si `includes/config.sample.php` est manquant dans l'image
   (un signe que la disposition de l'image a changé).
2. **Rend `config.php`** à `/var/www/simplerisk/includes/config.php` à partir du
   fichier `config.sample.php` du fournisseur, en remplaçant ses espaces réservés
   `__DB_HOSTNAME__`, `__DB_PORT__`, `__DB_USERNAME__`, `__DB_PASSWORD__` et `__DB_DATABASE__` par
   `DB_IP`, `DB_PORT` (par défaut `3306`), `DB_USER`, `DB_PASSWORD` et `DB_NAME`.
   La substitution utilise PHP `str_replace` plutôt que `sed`, car un mot de passe
   généré contenant `/`, `&` ou `\` casserait un remplacement `sed`. Le fichier est
   rendu à **chaque** démarrage — le fournisseur protégeait cela avec un fichier
   marqueur sur un chemin éphémère, qui ne peut jamais être vu lors d'un démarrage
   à froid ultérieur.
3. **Stocke les sessions dans la base de données** en définissant `__USE_DATABASE_FOR_SESSIONS__`
   sur `true`. Les sessions basées sur des fichiers déconnecteraient les
   utilisateurs chaque fois qu'une requête atterrit sur une instance différente.
4. **Démarre Apache** (`/etc/apache2/foreground.sh`, la commande que le supervisord du
   fournisseur utilisait pour httpd).

`DB_IP` — l'IP privée brute de Cloud SQL — est utilisée plutôt que `DB_HOST`, car
`config.php` prend un hôte simple et la forme de répertoire de socket de `DB_HOST`
contient des deux-points. C'est pourquoi le module de la plateforme définit
`db_host_env_var_name = "DB_IP"` et laisse `enable_cloudsql_volume = false`.

---

## 4. Image de conteneur et Apache {#4-container-image-and-apache}

Le Dockerfile apporte trois modifications à l'image du fournisseur :

- **Le port 80 sert l'application.** Le virtual host du port 80 du fournisseur
  n'a pas de `DocumentRoot` et ne fait que rediriger vers HTTPS ; l'application n'est
  servie que sur 443. Derrière une plateforme de terminaison TLS, c'est d'abord
  une boucle de redirection infinie, puis la page par défaut d'Apache. L'enveloppe
  réécrit le vhost du port 80 pour servir `/var/www/simplerisk`, en reprenant le bloc
  `Directory` et les en-têtes de sécurité du fournisseur. **HSTS n'est
  délibérément pas repris** — le conteneur ne voit jamais la connexion TLS. Le
  vhost 443 (avec son certificat auto-signé de remplacement) est supprimé.
- **Apache seulement.** Le `CMD` du fournisseur exécutait supervisord avec
  `mysqld_safe`, `httpd`, `rsyslog` et `cron`. L'enveloppe
  exécute Apache seul : la base de données est Cloud SQL, les logs vont vers
  stdout, et `cron` n'est pas démarré — donc les tâches planifiées de
  SimpleRisk (rapports, notifications) ne s'exécutent pas à l'intérieur du
  conteneur.
- **Le point d'entrée de remplacement** décrit ci-dessus.

---

## 5. Moteur de base de données et amorçage {#5-database-engine-and-bootstrap}

SimpleRisk utilise toujours **MySQL 8.0** sur Cloud SQL géré. Lorsque
`initialization_jobs` est laissé vide, deux jobs s'exécutent dans l'ordre :

| Job | Image | Ce qu'il fait |
|---|---|---|
| `db-init` | `mysql:8.0-debian` (délai 600s, 3 tentatives) | Attend MySQL sur 3306, crée (ou réinitialise le mot de passe avec `ALTER USER`) l'utilisateur de l'application, crée la base de données, accorde tous les privilèges sur celle-ci, et vérifie que l'utilisateur de l'application peut se connecter. Utilise `--get-server-public-key` là où le client le supporte, pour `caching_sha2_password` sur TCP simple. |
| `schema-load` | L'**image de l'application** (délai 900s, 2 tentatives ; dépend de `db-init`) | Compte les tables dans la base de données. S'il n'y en a pas, charge `/simplerisk.sql` et compte à nouveau, échouant si le chargement n'a laissé aucune table. Si des tables existent déjà, il ne fait rien. |

`schema-load` doit s'exécuter sur l'image de l'application car `simplerisk.sql` est livré à
l'intérieur de `simplerisk/simplerisk` et n'est publié nulle part ailleurs. Il s'exécute
en tant que job plutôt que dans le point d'entrée car plusieurs instances Cloud
Run peuvent démarrer à froid en même temps, et deux d'entre elles chargeant le
même schéma simultanément laisseraient un schéma à moitié chargé sans erreur. Les
deux scripts utilisent `set -e` nu (pas de `pipefail`), car l'exécuteur de
jobs les invoque avec `sh`.

Fournir une liste `initialization_jobs` remplace les deux jobs.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes ciblent `/` via HTTP — le même chemin que le propre
`HEALTHCHECK` de l'image du fournisseur utilise. Le démarrage est rapide car le
point d'entrée ne rend que `config.php` avant de démarrer Apache. Les valeurs par
défaut du module de la plateforme sont un délai initial de 30s, une période de
15s et 20 échecs pour le démarrage, et un délai de 60s, une période de 30s et 3
échecs pour la vivacité. La page à `/` se rend sans la base de données,
donc une sonde réussie ne prouve pas la connectivité de la base de données.

---

## 7. Stockage d'objets {#7-object-storage}

Cette couche déclare un bucket, `storage` (classe standard, prévention
d'accès public appliquée, `force_destroy = true`, pas de versioning). Avec
`enable_gcs_storage_volume = true` (la valeur par défaut), il est monté avec GCS FUSE à
`/var/www/simplerisk/files`, où SimpleRisk conserve les fichiers téléchargés. Tout
le reste que SimpleRisk stocke est dans MySQL.

Le chiffrement des données au repos, un Extra SimpleRisk, est délibérément hors
de portée : il introduit un fichier clé sous `/var/www/simplerisk`, qui serait
éphémère sur Cloud Run.

---

## 8. Limites connues {#8-known-limits}

- **Le premier visiteur devient administrateur.** SimpleRisk ne fournit pas
  d'identifiants par défaut ; il affiche un formulaire de *Création de compte
  administrateur par défaut* lors du premier accès. Cette couche ne crée pas
  d'administrateur — les entrées `admin_username` et `admin_email` ne sont pas
  utilisées par sa configuration. Créez le compte immédiatement après le
  déploiement, ou restreignez d'abord l'accès (voir le guide de la plateforme).
- **Les tâches planifiées ne s'exécutent pas dans le conteneur**, car `cron`
  n'est pas démarré.
- **Épinglez un tag d'image exact.** Une reconstruction sous un tag inchangé ne
  produit pas de diff Terraform et donc pas de nouvelle révision.

---

Pour la configuration spécifique à SimpleRisk et destinée aux utilisateurs
(variables par groupe, sorties, et comment explorer chaque service depuis la
Console et la CLI), consultez le guide de la plateforme :
**[SimpleRisk_CloudRun](SimpleRisk_CloudRun.md)**.

## Guides associés {#related-guides}

- [SimpleRisk sur Google Cloud Run](SimpleRisk_CloudRun.md) — cette configuration déployée sur Cloud Run.
