---
title: "Healthchecks sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Healthchecks sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Healthchecks_CloudRun.md @ e69407af sha256:8590493afbe0 -->

# Healthchecks sur Google Cloud Run {#healthchecks-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Healthchecks_CloudRun.png" alt="Healthchecks sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Healthchecks est un service open-source d'auto-hébergement pour la surveillance
des tâches cron et des battements de cœur : les tâches planifiées le "pingent"
en cas de succès (ou une tâche le pinge périodiquement et Healthchecks surveille
un ping manqué), et il vous alerte par e-mail, Slack, SMS ou plus de 100 autres
intégrations lorsqu'un ping est en retard ou manquant. Ce module déploie
Healthchecks sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Healthchecks et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Healthchecks sur RAD, et comment cela se compare {#what-healthchecks-costs-on-rad-and-how-that-compares}

**L'exécution de Healthchecks sur Cloud Run dans votre propre projet Google Cloud coûte environ 115,17 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une fois au moment du déploiement. Healthchecks est l'une des rares applications de cette liste à disposer d'un SaaS hébergé officiel géré par le même projet — Healthchecks.io — ce qui rend possible une comparaison directe et nommée. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut pas égaler — ou voir le [guide GKE](Healthchecks_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une fois) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 115,17 $/mois, facturé par Google au prix catalogue | ~54 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (toujours actif) | 44,72 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **115,17 $** |

### Comment cela se compare {#how-it-compares}

- **Les propres tarifs de Healthchecks.io (vérifiés sur sa page de tarifs, 8 octobre 2026) : Hobbyist est à 0 $/mois, Supporter à 5 $/mois, Business à 20 $/mois et Business Plus à 80 $/mois** (les deux plans payants offrent également une réduction de 20 % en cas de paiement annuel).
- Le coût d'exécution du projet propre à RAD inclut ici une instance Cloud SQL Postgres dédiée et un petit serveur de fichiers NFS, que les niveaux hébergés de Healthchecks.io intègrent dans leur propre infrastructure au lieu de vous les facturer séparément.
- Une alternative VPS auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — moins cher que la pile gérée de RAD et que le niveau Business de Healthchecks.io, mais sans aucune des sauvegardes gérées, des correctifs ou de la surveillance que les deux autres options incluent.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais
les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google affirme que la plupart
des services sont entièrement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Healthchecks et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et la remise en service de Healthchecks signifie un redéploiement
à partir de zéro. Cela coûte environ 78-81 crédits (les frais de module de 75 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Healthchecks restait inutilisé suffisamment longtemps pour compenser
ce coût de redéploiement par rapport à son propre coût d'exécution — pour Healthchecks, cela représente environ 3 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de laboratoire, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [https://healthchecks.io/pricing/](https://healthchecks.io/pricing/) pour les chiffres de Healthchecks.io cités ci-dessus, vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Healthchecks s'exécute en tant que conteneur Django/uWSGI sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service uWSGI, 1 vCPU / 512 Mio par défaut, toujours actif (pas de mise à l'échelle à zéro) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — la variable d'environnement `DB` est explicitement définie sur `postgres`, annulant le repli SQLite de l'image |
| Secrets | Secret Manager | `SECRET_KEY` auto-généré et mot de passe administrateur initial ; mot de passe de la base de données |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire**, et `DB = "postgres"` est défini explicitement. L'image
  amont, sans cela, se replie silencieusement sur une base de données SQLite
  jetable, locale au conteneur, sans erreur — le même type de piège déjà
  documenté dans ce catalogue pour Wallabag.
- **L'image du conteneur est véritablement pré-construite** (`healthchecks/healthchecks`) —
  `container_image_source` est par défaut `"prebuilt"` et aucune étape Cloud Build n'est exécutée.
- **`cpu_always_allocated = true` et `min_instance_count = 1` par défaut** — la
  boucle d'arrière-plan `sendalerts`/`sendreports` qui détecte les
  enregistrements manqués et déclenche les alertes est colocalisée dans le même
  conteneur et s'exécute en continu, indépendamment des requêtes HTTP entrantes
  (la même forme que n8n/Kestra). Dans le cadre de la facturation basée sur les
  requêtes que ce catalogue utilise par défaut pour la plupart des applications,
  cette boucle serait ralentie à presque zéro entre les requêtes et pourrait
  cesser silencieusement de détecter les enregistrements manqués.
- **Pas de point de terminaison de santé dédié.** Les sondes de démarrage/vivacité ciblent `/` (la
  page de connexion publique). `ALLOWED_HOSTS = "*"` est défini de sorte que l'en-tête Host de la propre
  sonde interne de la plateforme ne soit jamais rejeté par la validation d'hôte de Django.
- **Le compte administrateur initial est amorcé une seule fois**, non auto-réparateur. Un
  job d'initialisation `admin-bootstrap` exécute les migrations et crée le superutilisateur
  (`admin_email` / un mot de passe Secret Manager généré) via le
  `createsuperuser --noinput` standard de Django. Réexécuter le job est une opération
  sûre et sans effet si le compte existe déjà.
- **L'e-mail sortant est un espace réservé par défaut.** `DEFAULT_FROM_EMAIL` est par défaut
  `healthchecks@example.org`. Configurez de vrais `EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` après le déploiement, sinon les alertes ne seront pas réellement
  livrées.
- **Pas de Redis, pas de stockage d'objets.** Healthchecks stocke tout l'état — vérifications,
  pings, utilisateurs, configuration d'alerte — uniquement dans PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Healthchecks {#a-cloud-run--the-healthchecks-service}

Healthchecks s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Healthchecks stocke toutes les données d'application (vérifications, pings, intégrations, utilisateurs,
historique des alertes) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service
se connecte en privé via le **proxy d'authentification Cloud SQL** via un socket Unix ; aucune
adresse IP publique n'est exposée. Lors du premier déploiement, les jobs d'initialisation créent la
base de données/rôle de l'application et amorcent le compte administrateur initial.

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

Deux valeurs cryptographiques sont générées automatiquement et stockées dans Secret
Manager : `SECRET_KEY` (clé de signature de session/CSRF Django) et `ADMIN_PASSWORD`
(le mot de passe initial du superutilisateur, amorcé une seule fois). Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs (y compris les workers d'arrière-plan `sendalerts`/`sendreports`,
qui se connectent au même flux stdout que le serveur web) sont acheminés vers Cloud Logging ;
les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Healthchecks {#3-healthchecks-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Le job d'initialisation `db-init` s'exécute à l'aide de
  `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL et
  crée de manière idempotente le rôle et la base de données de l'application. Le job peut être
  réexécuté en toute sécurité.
- **Amorçage du compte administrateur.** Le job `admin-bootstrap` (utilisant l'image Healthchecks
  elle-même) exécute `manage.py migrate --noinput`, puis `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (mot de passe
  provenant d'un secret Secret Manager généré). Parce que les jobs d'initialisation Cloud Run s'exécutent
  strictement avant la création du service principal — et parce qu'un job invoque la
  commande du conteneur directement, contournant la chaîne de démarrage `uwsgi.ini` de l'image
  — le job exécute d'abord sa propre migration plutôt que de supposer que le schéma existe déjà.
- **Les migrations de base de données s'exécutent également à chaque démarrage normal du conteneur** du service principal
  (le `uwsgi.ini` de l'image a `hook-pre-app = exec:./manage.py migrate`
  intégré), de sorte que la mise à niveau de `application_version` applique les modifications de schéma
  automatiquement.
- **La boucle d'arrière-plan `sendalerts`/`sendreports` est colocalisée dans le même
  conteneur**, démarrée automatiquement par le `uwsgi.ini` de l'image
  à côté du serveur web (entrées `attach-daemon`) — aucun service de worker séparé n'est
  déployé. C'est cette boucle qui détecte réellement les enregistrements manqués et envoie
  les alertes, et elle a besoin que le conteneur soit à la fois en cours d'exécution (`min_instance_count =
  1`) et alloué en CPU (`cpu_always_allocated = true`) pour fonctionner de manière fiable.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — Healthchecks n'a pas
  de point de terminaison de santé dédié ; la page de connexion racine répond toujours sans authentification
  et renverrait une erreur 500 (ne s'afficherait pas) si la connexion à la base de données était interrompue.
- **Connexion, pas inscription.** Healthchecks n'a pas de flux d'inscription public en libre-service
  par défaut ; le seul compte est celui amorcé par `admin-bootstrap`.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Healthchecks sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `healthchecks` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Healthchecks` | Nom lisible par l'homme affiché dans la console. |
| `admin_email` | `admin@techequity.cloud` | E-mail/nom d'utilisateur du superutilisateur initial, amorcé une seule fois. |
| `default_from_email` | `healthchecks@example.org` | Adresse d'expéditeur de remplacement jusqu'à ce que le SMTP réel soit configuré. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | L'image officielle n'a pas besoin de build personnalisé. |
| `container_image` | `""` | Laisser vide pour utiliser `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | Le serveur uWSGI de l'image amont se lie ici (`docker/uwsgi.ini`). |
| `min_instance_count` | `1` | Maintient la boucle d'alerte toujours active. La définition de `0` risque des alertes manquées pendant l'inactivité. |
| `max_instance_count` | `1` | Une seule instance est suffisante ; la boucle d'alerte n'est pas conçue pour la coordination multi-instances. |
| `cpu_always_allocated` | `true` | Requis pour que la boucle d'alerte intégrée s'exécute de manière fiable entre les requêtes. |
| `enable_cloudsql_volume` | `true` | Socket Unix du proxy d'authentification Cloud SQL — `DB_HOST` est un paramètre libpq/psycopg discret, donc le répertoire du socket fonctionne tel quel. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configurez `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_HOST_USER` ici pour une livraison réelle des alertes. Ne définissez pas `DB`, `SECRET_KEY` ou `DB_*` — injectés automatiquement. |
| `secret_environment_variables` | `{}` | Utilisez pour `EMAIL_HOST_PASSWORD` ou d'autres identifiants SMTP sensibles. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Valeur par défaut héritée. Healthchecks n'a pas besoin de système de fichiers partagé, donc définissez-le sur `false` lors du déploiement. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Valeur par défaut générique de la fondation ; inutilisée par l'application elle-même. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; MySQL/SQLite ne sont pas câblés via ce module. |
| `application_database_name` | `healthchecks_db` | Immuable après le premier déploiement. |
| `application_database_user` | `healthchecks_user` | Mot de passe auto-généré dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `db-init` + `admin-bootstrap`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai | Aucun point de terminaison de santé dédié n'existe ; `/` est la page de connexion publique. |
| `liveness_probe` | HTTP `/` 30s de délai | Même raisonnement. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé — Healthchecks n'a pas d'intégration Redis documentée. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `DB` (auto-défini) | `"postgres"` | Critique | Si, pour une raison quelconque, il n'est pas défini, l'application utilise silencieusement une base de données SQLite locale jetable — les vérifications et l'historique des alertes disparaissent à chaque redémarrage, sans erreur. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | Élevé | La mise à l'échelle à zéro ou le passage à la facturation basée sur les requêtes ralentit la boucle `sendalerts` colocalisée entre les requêtes, de sorte que les enregistrements manqués peuvent passer inaperçus. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer une fois, faire pivoter via l'interface utilisateur après | Moyen | Le mot de passe amorcé n'est défini que lors de la PREMIÈRE exécution réussie de `admin-bootstrap` ; la réexécution du job ne le met pas à jour. |
| `DEFAULT_FROM_EMAIL` / variables SMTP | Configurer un vrai SMTP après le déploiement | Élevé | Laissé à la valeur par défaut de l'espace réservé, `sendalerts` enregistre les erreurs de livraison au lieu de notifier réellement quiconque d'un enregistrement manqué. |
| `ALLOWED_HOSTS` (auto-défini sur `"*"`) | Laisser tel quel, sauf raison spécifique | Faible | La désactivation complète de la validation de l'en-tête Host de Django est un compromis accepté ici pour maintenir le fonctionnement des sondes de santé de la plateforme ; Healthchecks n'a pas d'autre modèle de sécurité basé sur l'hôte. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` | Critique | Le passage à `custom` sans Dockerfile dans `Healthchecks_Common/scripts` échoue le build — Healthchecks n'a pas de script de build personnalisé par conception. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Healthchecks
partagée avec la variante GKE est décrite dans
**[Healthchecks_Common](Healthchecks_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Healthchecks sur Cloud Run](../labs/Healthchecks_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Healthchecks sur GKE Autopilot](Healthchecks_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Healthchecks Common — Configuration d'application partagée](Healthchecks_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md), [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) dans la solution **Surveillance et réponse de sécurité**.
