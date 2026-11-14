---
title: "Castopod sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Castopod sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Castopod_CloudRun.md @ 40c83c3f sha256:7ff3ad530241 -->

# Castopod sur Google Cloud Run {#castopod-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_CloudRun.png" alt="Castopod sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod est une plateforme d'hébergement de podcasts open source, native d'ActivityPub,
construite sur CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy. Ce module déploie
Castopod sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Castopod et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte Castopod sur RAD, et comment cela se compare {#what-castopod-costs-on-rad-and-how-that-compares}

**Castopod sur le module Cloud Run de RAD coûte environ 84 $ US par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — Castopod est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **67 crédits par jour** (environ 2 010 par mois, soit environ 201 $ US au prix de la recharge). Ou consultez le [guide GKE](Castopod_GKE.md) pour une capacité toujours active sur les pods. Si vous n'avez besoin de Castopod qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires, de sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Castopod est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, environ 2 010 par mois (environ 201 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant des frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un forfait mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 84 $ US** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes en africa-south1 (Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **La mise à l'échelle à zéro est la valeur par défaut sur Cloud Run.** Le chiffre ci-dessus suppose une utilisation quotidienne modeste ; définissez `min_instance_count ≥ 1` pour le maintenir toujours chaud (et éviter les démarrages à froid), ce qui augmente la ligne Cloud Run mais pas le reste du tableau.

### Comment cela se compare, pour un podcast indépendant {#how-it-compares-for-an-independent-podcast}

L'équipe de Castopod vend son propre hébergement officiel sur castopod.com :

| Forfait | Par mois | Stockage |
|---|---|---|
| Starter | 9,96 € (environ 11 $ US) | 5 Go |
| Podcaster | 24 € (environ 26 $ US) | plus de stockage et de bande passante |
| Network | 96 € (environ 104 $ US) | jusqu'à 500 Go, plusieurs émissions |

(Les chiffres en USD sont une conversion approximative ; les forfaits sont facturés en euros.) Les niveaux d'hébergement de Castopod sont basés sur le stockage et la bande passante plutôt que sur la taille de calcul, ce n'est donc pas une comparaison directe avec le tableau ci-dessus — le module de RAD vous offre le même Castopod open source sur une infrastructure facturée en fonction de l'utilisation réelle de Google Cloud, plus Cloud SQL géré, Secret Manager et Cloud Monitoring.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Castopod s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet. Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de récupérer le projet et de rattacher son compte de facturation, puis d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et effacer à nouveau le seuil d'admission du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a quelque chose à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) : 110 crédits (11,00 $ US) au prix de la recharge. La suppression ne permet d'économiser de l'argent que si Castopod resterait inutilisé pendant environ **4 jours ou plus** — dans votre propre projet, cela représente environ 2,79 $ US par jour, et dans un projet géré par RAD, c'est 67 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Castopod alors qu'une autre application partage le projet n'économise que la partie de calcul propre à Castopod.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde concernant le bucket de sauvegarde ; [Hébergement Castopod](https://castopod.com/) ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Castopod s'exécute en tant que conteneur PHP/FrankenPHP sur Cloud Run v2, écoutant sur le port 8080.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service FrankenPHP/Caddy, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — Castopod ne prend pas en charge PostgreSQL ou d'autres moteurs |
| Stockage média | Cloud Storage + Cloud Filestore (NFS) | Un bucket `media` est provisionné ; NFS est activé par défaut pour persister les téléchargements après les redémarrages |
| Cache | Redis (facultatif) | Le cache de fichiers (`CP_CACHE_HANDLER = file`) est la valeur par défaut ; Redis est optionnel |
| Secrets | Secret Manager | `CP_ANALYTICS_SALT` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé (`database_type = "MYSQL_8_0"`)
  par le module ; la sélection de PostgreSQL ou de tout autre moteur interrompt le démarrage.
- **La configuration de la base de données est écrite dans le `.env` de Castopod, pas dans les variables d'environnement.** Castopod
  (CodeIgniter 4) lit les clés notées par points (`database.default.hostname` …) qui ne peuvent pas être
  des noms de variables d'environnement Cloud Run. Le point d'entrée du conteneur les matérialise dans `.env` à partir
  des variables `DB_*` injectées, et résout un hôte TCP (`DB_IP`) car le pilote `mysqli` de CI4
  ne peut pas utiliser le répertoire de socket Cloud SQL.
- **`CP_ANALYTICS_SALT` est généré automatiquement** et stocké dans Secret Manager. Gardez-le
  stable — il anonymise les analyses d'écouteurs, et le modifier rompt la continuité de la déduplication
  pour les auditeurs précédemment enregistrés.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les démarrages à froid ajoutent quelques
  secondes de latence à la première requête après l'inactivité. Définissez `min_instance_count = 1`
  pour maintenir Castopod toujours chaud.
- **`max_instance_count = 1` par défaut.** Ne pas dépasser une instance à moins que le
  système de fichiers multimédia partagé (NFS/GCS) et un cache partagé ne soient confirmés comme étant sûrs pour plusieurs instances.
- **NFS est activé par défaut** (`enable_nfs = true`) pour persister les médias téléchargés après
  les redémarrages du conteneur. Castopod stocke l'audio et les illustrations des épisodes sur le système de fichiers, pas
  dans la base de données.
- **L'URL de base est dérivée automatiquement.** Le point d'entrée définit `CP_BASEURL` à partir de l'exécution
  `CLOUDRUN_SERVICE_URL`, de sorte que les URL des flux de podcast et des médias reflètent la véritable
  adresse du service.
- **Les migrations CodeIgniter s'exécutent au démarrage du conteneur** — il n'y a pas de job de migration séparé,
  car le point d'entrée du wrapper de la plateforme (`Castopod_Common/scripts/entrypoint.sh`)
  exécute explicitement `php spark migrate --all` à chaque démarrage ; l'image de base `castopod/castopod`
  ne le fait **pas** automatiquement. Le schéma est créé au premier démarrage après que le job `db-init`
  a provisionné la base de données et l'utilisateur (voir §3 ci-dessous).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Castopod {#a-cloud-run--the-castopod-service}

Castopod s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~castopod"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Castopod stocke toutes les données de l'application (podcasts, épisodes, utilisateurs, analyses) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le service se connecte en privé — le point d'entrée compose l'adresse IP privée de Cloud SQL via TCP (le pilote `mysqli` de CodeIgniter ne peut pas utiliser le répertoire de socket du proxy d'authentification) ; aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs).
Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et persistance des médias {#c-cloud-storage--media-persistence}

Un bucket **Cloud Storage** `media` dédié est provisionné automatiquement. Comme
Castopod écrit l'audio et les illustrations téléchargés dans le système de fichiers du conteneur sous
`/var/www/html/public/media`, **Cloud Filestore (NFS)** est activé par défaut
(`enable_nfs = true`, monté à `nfs_mount_path`) afin que ces fichiers survivent aux redémarrages.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~media"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis est **désactivé par défaut** — Castopod utilise un cache de système de fichiers
(`CP_CACHE_HANDLER = file`). Lorsque `enable_redis = true`, le module injecte `REDIS_HOST`
et `REDIS_PORT` pour le cache d'objets de Castopod. Lorsque `redis_host` est laissé vide et
`enable_nfs` est vrai, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected cache/redis env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`CP_ANALYTICS_SALT` (utilisé pour anonymiser les analyses d'écouteurs de podcast). Le mot de passe de la base de données
est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet un accès public requis pour les flux de podcasts publics et les téléchargements de médias. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des stratégies d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Castopod {#3-castopod-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte via le socket du proxy d'authentification Cloud SQL (ou le repli TCP IP privée) et crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges et vérifie que l'utilisateur de l'application peut se connecter. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage du conteneur — via le point d'entrée de la plateforme, pas l'image de base.** L'image `castopod/castopod` (construite sur `serversideup/php`) n'a pas de
  hook de migration CodeIgniter propre ; son seul comportement de migration automatique est
  spécifique à Laravel (`php artisan migrate`, protégé par `AUTORUN_ENABLED`, par défaut
  `false`) et n'exécuterait pas `spark migrate` de CI4 même s'il était activé. Le point d'entrée du wrapper de la plateforme (`Castopod_Common/scripts/entrypoint.sh`) exécute explicitement `php
  spark migrate --all` — idempotent, sûr à chaque démarrage — une fois la connectivité `.env`/DB
  écrite, de sorte que le schéma est créé au premier démarrage et la mise à niveau de la version de l'application
  applique les modifications de schéma au démarrage suivant, sans job de migration séparé.
  Si cet appel explicite est jamais supprimé, chaque requête renvoie 500 avec
  `Table '...' doesn't exist` même si `db-init` a réussi — vérifiez `entrypoint.sh`
  en premier lors du débogage de ce symptôme.
- **La configuration de la base de données se trouve dans `.env`, injectée au moment de l'exécution.** Le point d'entrée écrit
  `database.default.hostname|database|username|password|port` et `app.baseURL` dans
  le `.env` de Castopod à partir des valeurs `DB_*` et `CLOUDRUN_SERVICE_URL` injectées par la fondation.
  Il résout l'hôte de la base de données à l'adresse TCP IP privée car le pilote `mysqli` de CI4
  ne peut pas utiliser le répertoire de socket Cloud SQL.
- **`CP_ANALYTICS_SALT` doit être stable après le premier démarrage.** Il est généré une fois et
  écrit dans Secret Manager ; le modifier rompt la continuité de la déduplication pour les auditeurs
  précédemment enregistrés. Ne le faites pivoter que délibérément.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port du conteneur et la sonde de vivacité
  est **HTTP `GET /`** — la page d'accueil non authentifiée de Castopod renvoie 200 une fois démarrée
  et connectée à MySQL. Prévoyez plusieurs minutes au premier démarrage pour que les migrations CodeIgniter
  se terminent (la sonde de démarrage fournit un délai initial de 30 secondes plus une fenêtre de 20 tentatives).
- **Configuration initiale.** Après le déploiement, ouvrez l'URL du service et complétez l'assistant d'installation web de Castopod pour créer le premier compte super-administrateur et définir le nom de l'instance et les valeurs par défaut du podcast. Les téléchargements de médias persistent ensuite dans le répertoire de médias sauvegardé par NFS.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Castopod sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `castopod` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Castopod` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Castopod ; `latest` est épinglé à la version stable actuelle (`1.15.5`). Épinglez explicitement en production. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; Castopod nécessite un minimum de 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 512 Mio, 2 Gio recommandés pour les grandes bibliothèques multimédias. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour maintenir Castopod toujours chaud. |
| `max_instance_count` | `1` | Maintenez à 1 sauf si le média/cache partagé est confirmé comme sûr pour plusieurs instances. |
| `container_port` | `8080` | FrankenPHP/Caddy écoute sur le port 8080. |
| `enable_cloudsql_volume` | `false` | Laissez désactivé — le point d'entrée se connecte via TCP IP privée pour MySQL, pas le socket du proxy d'authentification Cloud SQL. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les flux de podcasts publics et les téléchargements de médias. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Cloud Filestore pour persister les médias téléchargés après les redémarrages ; requis pour les médias durables. |
| `nfs_mount_path` | `/var/www/html/public/media` | Chemin de montage du volume NFS dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse facultatifs (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur MySQL 8.0 fixe. Ne pas modifier — Castopod ne prend pas en charge PostgreSQL. |
| `db_name` | `castopod` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `castopod` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s | Sonde de démarrage TCP sur le port du conteneur ; la fenêtre de 20 tentatives couvre les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/` délai de 300s | Sonde de vivacité contre la page d'accueil non authentifiée de Castopod (renvoie 200 une fois démarrée). |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Bascule le cache d'objets de Castopod vers Redis ; injecte `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Castopod est uniquement MySQL ; tout autre moteur interrompt le démarrage et les migrations. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données du podcast. |
| `enable_nfs` | `true` | Critique | Avec NFS désactivé, l'audio et les illustrations des épisodes téléchargés résident sur un disque éphémère et sont perdus à chaque redémarrage/redéploiement. |
| `CP_ANALYTICS_SALT` (auto-généré) | Ne pas modifier après le premier démarrage | Élevé | Le modifier rompt la continuité de la déduplication des auditeurs pour les analyses précédemment enregistrées. |
| `max_instance_count` | `1` sauf si l'état partagé est confirmé | Élevé | La mise à l'échelle au-delà de 1 sans système de fichiers multimédia et cache partagés entraîne des médias et un cache incohérents entre les instances. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, Castopod (PHP 8) ne démarre pas ; les grandes bibliothèques multimédias nécessitent plus de marge. |
| `ingress_settings` | `all` | Élevé | `internal` bloque l'accès public aux flux de podcasts et aux médias. |
| `enable_iap` | uniquement pour les instances privées | Élevé | IAP bloque tout accès non authentifié, y compris les flux RSS publics et les téléchargements de médias. |
| `CP_BASEURL` (auto-dérivé) | URL réelle du service | Élevé | Une URL de base incorrecte produit des liens de flux/médias cassés ; le point d'entrée la dérive de `CLOUDRUN_SERVICE_URL`. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur publique et l'administration sont accessibles sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**.
La configuration d'application spécifique à Castopod partagée avec la variante GKE est décrite dans
**[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Castopod sur Cloud Run](../labs/Castopod_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Castopod sur GKE Autopilot](Castopod_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Castopod Common — Configuration d'application partagée](Castopod_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Création et publication de médias**.
