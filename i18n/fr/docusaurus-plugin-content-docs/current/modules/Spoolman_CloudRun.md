---
title: "Spoolman sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Spoolman sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Spoolman_CloudRun.md @ 1665a43e sha256:705f9b9ca9d9 -->

# Spoolman sur Google Cloud Run {#spoolman-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Spoolman_CloudRun.png" alt="Spoolman sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Spoolman est un outil de suivi d'inventaire et d'utilisation de bobines de
filament pour l'impression 3D, gratuit et open source — fournisseurs,
matériaux, poids restant, coût par bobine et consommation par impression. Il
est livré sous la forme d'un backend Python/FastAPI à processus unique avec un
frontend statique Vue/Quasar intégré. Ce module déploie Spoolman sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Spoolman et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Spoolman sur RAD, et comment cela se compare {#what-spoolman-costs-on-rad-and-how-that-compares}

**Spoolman sur le module Cloud Run de RAD coûte environ 67,80 US$ par mois dans un projet Google Cloud que vous possédez, avec les frais de module facturés une fois en crédits RAD.** Spoolman est un traqueur léger, donc la majeure partie de ce coût provient de la base de données gérée dans laquelle il conserve son inventaire de bobines, et non du calcul lui-même. Pour un coût de fonctionnement le plus bas, cela reste sur Cloud Run ; GKE Autopilot ne vaut la peine que si Spoolman doit être placé à côté d'autres charges de travail Kubernetes — voir le [guide GKE](Spoolman_GKE.md) pour cette option, à environ 91,31 US$ par mois à la place. Si vous n'avez besoin de Spoolman qu'occasionnellement — entre les travaux d'impression, ou pendant que vous l'essayez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **67,80 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **67,80 US$** |

### Comment cela se compare {#how-it-compares}

- Spoolman n'a pas de SaaS commercial hébergé propre — il est distribué uniquement en tant que logiciel open source auto-hébergé, Docker-first, pour que les ateliers d'impression 3D puissent le gérer eux-mêmes.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — toutes ces machines sont considérablement plus puissantes que ce dont Spoolman a besoin (1 vCPU / 0,5 GiB) ; une micro-instance à vCPU partagé à 5-6 $/mois de l'un des mêmes fournisseurs la ferait fonctionner confortablement, plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- La majeure partie du coût de fonctionnement de RAD dans son propre projet est l'instance PostgreSQL gérée, et non le calcul propre de Spoolman — la même base de données dont Spoolman aurait besoin sur un VPS nu, mais non gérée là-bas.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Spoolman s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — une suppression logique récupérable de 30 jours propre à Google. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL ou la ressource de calcul un par un : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et la suppression logique de Cloud Storage est explicitement désactivée pour ce bucket, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données de Spoolman et que vous souhaitez les conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Spoolman purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 45 crédits (environ 4,50 US$) dans votre propre projet, ou 41 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Spoolman resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement quotidien — par rapport au total du projet propre ci-dessus (environ 2,26 US$ par jour), cela représente environ 2 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (26 crédits par jour). La majeure partie du coût de fonctionnement ici est la base de données ; elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Spoolman alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Il n'existe pas de SaaS commercial hébergé actuellement vérifié pour Spoolman, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

Spoolman s'exécute en tant que conteneur Python/FastAPI unique sur Cloud Run v2
— il n'y a pas de service frontend séparé ; l'interface utilisateur Vue/Quasar
est regroupée et servie à partir du même processus. Le déploiement relie un
ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Image `ghcr.io/donkie/spoolman` pré-construite, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — ce module standardise sur Postgres (Spoolman prend également en charge MySQL/SQLite/CockroachDB en amont) |
| Stockage d'objets | Aucun | Spoolman conserve tout l'état dans Postgres ; aucun bucket GCS n'est provisionné |
| Cache | Aucun | Spoolman n'a pas d'intégration Redis/cache |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données auto-généré — Spoolman n'a pas de secret d'amorçage d'administrateur/clé API propre |
| Ingress | URL Cloud Run | URL `run.app` par défaut, publique par défaut (`ingress_settings = "all"`) |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est le seul moteur pris en charge dans ce module.** `database_type`
  est corrigé par `Spoolman_Common` ; Spoolman en amont prend également en charge MySQL et
  CockroachDB via des variables d'environnement, mais ce module n'expose pas ce choix.
- **Pas de build personnalisé.** `container_image_source = "prebuilt"` déploie
  `ghcr.io/donkie/spoolman` directement — il n'y a pas de Dockerfile, pas d'étape Cloud Build,
  et pas de risque de blocage `application_version` dû à une classe de bug d'image de base
  `latest`-tag.
- **Pas de job d'initialisation.** La fondation crée automatiquement le rôle et la base de données Postgres ;
  Spoolman exécute ses propres migrations Alembic automatiquement à chaque démarrage du conteneur.
  Il n'y a rien à attendre au-delà du conteneur qui devient sain.
- **Pas de secrets d'application.** Spoolman est livré **sans aucune authentification** —
  quiconque peut atteindre l'URL a un accès complet en lecture/écriture à l'inventaire. Il
  n'y a pas de portail de connexion à amorcer et rien n'est généré dans Secret Manager au-delà
  du mot de passe de la base de données. Si cela n'est pas acceptable pour votre déploiement, placez le
  service derrière IAP (`enable_iap = true`) ou une liste blanche d'adresses IP Cloud Armor.
- **La mise à l'échelle à zéro est la valeur par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated` hérite de la valeur par défaut basée sur les requêtes de la fondation).
  Spoolman n'effectue aucun travail en arrière-plan — pas de planificateur, pas de file d'attente, pas de WebSocket — il
  n'y a donc aucune raison de modifier l'un ou l'autre de ces paramètres.
- **Les connexions utilisent le socket Unix Cloud SQL, pas TCP.** La couche SQLAlchemy de Spoolman
  construit sa connexion via `URL.create()` (un objet structuré, pas
  une concaténation de chaînes), de sorte que le chemin du répertoire du socket — qui contient des deux-points
  dans le nom de connexion de l'instance Cloud SQL — passe proprement sans
  problème d'analyse d'URL. Aucune configuration TLS/`sslmode` n'est nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Spoolman {#a-cloud-run--the-spoolman-service}

Spoolman s'exécute en tant que service Cloud Run v2 unique. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Spoolman stocke toutes les données d'inventaire (bobines, filaments, fournisseurs, historique d'utilisation)
dans une instance Cloud SQL gérée pour PostgreSQL 15. Le service se connecte
privément via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique
n'est exposée. Il n'y a pas de job d'initialisation — Spoolman applique ses propres migrations de schéma
à chaque démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le mot de passe de la base de données auto-généré réside dans Secret Manager — Spoolman
n'a pas de compte administrateur ou de clé API propre à amorcer.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
  gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut
(`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peut être superposé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers
Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Spoolman {#3-spoolman-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.** Contrairement à la plupart des modules d'application de ce catalogue, Spoolman n'a pas besoin de job `db-init` — la fondation crée le rôle et la base de données Postgres, et les propres migrations Alembic de Spoolman s'exécutent automatiquement à chaque démarrage du conteneur (y compris le tout premier démarrage).
- **Pas d'authentification.** Il n'y a pas de page de connexion, pas de compte administrateur et pas de portail de clé API. Quiconque peut atteindre l'URL du service peut consulter et modifier l'intégralité de l'inventaire. Décidez de votre approche de contrôle d'accès (IAP, liste blanche Cloud Armor, ou accepter la lecture/écriture publique) avant de partager l'URL.
- **Chemin de santé.** `/api/health` est public et non authentifié, renvoyant un statut JSON 200/OK une fois que le serveur (et sa connexion DB) est opérationnel. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.
- **Moteur de base de données verrouillé sur Postgres.** La variable d'environnement `SPOOLMAN_DB_TYPE` de Spoolman sélectionne le moteur ; ce module la définit toujours sur `postgres`. Ne la désactivez jamais via `environment_variables` — sans elle, Spoolman revient silencieusement à un fichier SQLite local au conteneur jetable sans aucune erreur (une classe d'échec documentée dans ce catalogue — voir le tableau des pièges du Guide de configuration).
- **Inspecter la connectivité Cloud SQL :**
  ```bash
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)' | tr ';' '\n' | grep -i spoolman_db
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Spoolman sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `spoolman` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Spoolman` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image tiré de `ghcr.io/donkie/spoolman`. Véritablement pré-construit — pas de préoccupations de Dockerfile/build-arg. |
| `application_database_name` / `application_database_user` | `spoolman` / `spoolman` | Immuable après le premier déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Transféré à la Fondation — requis, sinon la valeur par défaut `"custom"` déclenche silencieusement une tentative Kaniko/Cloud Build sans Dockerfile. |
| `container_port` | `8000` | Port d'écoute par défaut de Spoolman. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Amplement suffisant pour un traqueur de filament mono-locataire ; augmenter pour un grand inventaire multi-utilisateurs. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | La mise à l'échelle à zéro est sûre — Spoolman n'a pas de travail en arrière-plan. |
| `enable_cloudsql_volume` | `true` | Monte le socket Unix du Cloud SQL Auth Proxy. Requis pour la construction du DSN décrite au §1. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_host_env_var_name` | `SPOOLMAN_DB_HOST` | Alias de `DB_HOST` de la fondation (le répertoire de socket Cloud SQL sur Cloud Run). |
| `db_user_env_var_name` | `SPOOLMAN_DB_USERNAME` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `SPOOLMAN_DB_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `SPOOLMAN_DB_NAME` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `SPOOLMAN_DB_PORT` | Alias de `DB_PORT`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Pas de bucket GCS nécessaire — tout l'état réside dans Cloud SQL. |
| `enable_nfs` | `false` | Pas de système de fichiers partagé nécessaire. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 10s | Public, non authentifié. |
| `liveness_probe` | HTTP `/api/health`, période de 30s | Public, non authentifié. |

Toutes les autres entrées (CI/CD, sauvegardes, VPC-SC, Cloud Armor, IAP, Redis) sont héritées
de [App_CloudRun](App_CloudRun.md) avec un comportement standard — Spoolman n'en utilise
aucune par défaut.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — Spoolman n'a pas besoin de bucket GCS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry (lorsque la mise en miroir est activée). |
| `monitoring_enabled` / `uptime_check_names` | Statut de surveillance et vérifications de disponibilité. |
| `initialization_jobs` | Toujours vide — Spoolman n'a pas besoin de job d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Pas d'authentification (intégrée) | Protéger avec IAP ou Cloud Armor si nécessaire | Critique | Toute personne ayant l'URL peut lire et modifier l'intégralité de l'inventaire de filaments — il n'y a pas de portail de connexion à désactiver. |
| `SPOOLMAN_DB_TYPE` (auto-injecté `postgres`) | Ne jamais désactiver via `environment_variables` | Critique | Le désactiver revient silencieusement à un fichier SQLite local au conteneur jetable — aucune erreur, et toutes les données sont perdues à chaque redémarrage. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (ne pas remplacer par `custom`) | Critique | La définition de `"custom"` déclenche une tentative Kaniko/Cloud Build contre un module sans Dockerfile — le build échoue purement et simplement. |
| `enable_cloudsql_volume` | `true` | Élevé | Le désactiver supprime le socket Unix dont dépend `SPOOLMAN_DB_HOST` de Spoolman pour le chemin de connexion sans TLS documenté. |
| `SPOOLMAN_DB_QUERY` | Laisser vide sauf en cas de dépannage | Moyen | C'est une échappatoire pour un fallback TCP + `sslmode` — nécessaire uniquement si le chemin de connexion basé sur le socket s'avère un jour peu fiable sur un déploiement en production ; non requis pour un fonctionnement normal. |
| `ingress_settings` | `all` (par défaut) | Moyen | La restriction à `internal` rend le service inaccessible depuis un navigateur à moins d'être précédé d'un équilibreur de charge. |
| `min_instance_count` | `0` (par défaut) | Faible | Spoolman n'a pas de travail en arrière-plan, donc la mise à l'échelle à zéro est sûre ; n'augmenter que pour éviter la latence de démarrage à froid pour une utilisation interactive. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Spoolman
partagée avec la variante GKE est décrite dans
**[Spoolman_Common](Spoolman_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Spoolman sur Cloud Run](../labs/Spoolman_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Spoolman sur GKE Autopilot](Spoolman_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Spoolman Common — Configuration d'application partagée](Spoolman_Common.md) — la configuration partagée par les deux cibles de déploiement.
