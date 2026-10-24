---
title: "Healthchecks sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Healthchecks sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Healthchecks_GKE.md @ e69407af sha256:aff8732b216f -->

# Healthchecks sur GKE Autopilot {#healthchecks-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Healthchecks_GKE.png" alt="Healthchecks sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Healthchecks est un service open-source et auto-hébergé de surveillance des
tâches cron et des battements de cœur : les tâches planifiées le « pingent »
en cas de succès, et il vous alerte par e-mail, Slack, SMS ou plus de 100
autres intégrations lorsqu'un ping est en retard ou manquant. Ce module
déploie Healthchecks sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Healthchecks et sur
la manière de les explorer et de les opérer depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Healthchecks sur RAD, et comment cela se compare {#what-healthchecks-costs-on-rad-and-how-that-compares}

**L'exécution du pod Healthchecks sur GKE Autopilot dans votre propre projet
Google Cloud coûte environ 106,53 $/mois en frais Google Cloud**, en plus
d'un frais de module RAD unique de 75 crédits facturé une seule fois au
moment du déploiement. Healthchecks est l'une des rares applications de cette
liste à disposer d'un SaaS hébergé officiel géré par le même projet —
Healthchecks.io — ce qui rend possible une comparaison directe et nommée. Dans
un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de
moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être
facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous pour le seul avantage d'un projet géré par RAD qu'un VPS
auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Healthchecks_CloudRun.md)
pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 106,53 $/mois, facturé par Google au prix catalogue | ~93 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **106,53 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils
sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la
seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous
exécutez.*

### Comment cela se compare {#how-it-compares}

- **Prix de Healthchecks.io (vérifié sur sa page de tarification, 8 octobre
  2026) : Hobbyist est à 0 $/mois, Supporter à 5 $/mois, Business à 20 $/mois
  et Business Plus à 80 $/mois** (les deux plans payants offrent également une
  réduction de 20 % en cas de paiement annuel).
- Le coût d'exécution de RAD pour un projet propre inclut une instance Cloud
  SQL Postgres dédiée et un petit serveur de fichiers NFS, que les niveaux
  hébergés de Healthchecks.io intègrent dans leur propre infrastructure au
  lieu de vous les facturer séparément.
- Une alternative VPS auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ
  24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24
  $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ
  49 $/mois — moins cher que la pile gérée par RAD et que le niveau Business
  de Healthchecks.io, mais sans les sauvegardes gérées, les correctifs ou la
  surveillance que les deux autres options incluent.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD dissocie
d'abord sa facturation, puis demande à Google de supprimer le projet
définitivement — la suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un seul module, cela ne démantèle **pas**
Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
éléments.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et la suppression logicielle de Cloud Storage est
explicitement désactivée pour ce bucket, il est donc très probable qu'il
disparaisse dès que vous supprimez le projet — même si le projet lui-même est
récupérable pendant 30 jours. Si vous avez personnalisé Healthchecks et que
vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive
ou un bucket en dehors du projet) avant de supprimer. Pour une installation par
défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un
projet géré par RAD, il n'y a pas de pause gratuite — la suppression supprime
définitivement les ressources, et ramener Healthchecks signifie le redéployer
à partir de zéro. Cela coûte environ 78-81 crédits (les frais de module de 75
crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Healthchecks devait
rester inutilisé suffisamment longtemps pour compenser ce coût de redéploiement
par rapport à son propre coût d'exécution — pour Healthchecks, cela représente
environ 3 jours ou plus. La majeure partie de ce coût d'exécution est
généralement la base de données (et, lorsque ce module en utilise un, la VM du
serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que
lorsque rien d'autre dans le projet ne les utilise, donc la suppression de
cette application alors que quelque chose d'autre partage le projet ne permet
d'économiser que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket
à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il
finance, et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, afin que personne ne
reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les
déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ;
[https://healthchecks.io/pricing/](https://healthchecks.io/pricing/) pour les
chiffres de Healthchecks.io cités ci-dessus, vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Healthchecks s'exécute en tant que Pod Django/uWSGI. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | pod uWSGI, 1 vCPU / 512 Mio par défaut, réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — la variable d'environnement `DB` est explicitement définie sur `postgres`, annulant le repli SQLite de l'image |
| Secrets | Secret Manager | `SECRET_KEY` auto-généré et mot de passe administrateur initial ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire**, et `DB = "postgres"` est défini
  explicitement. L'image en amont se replie sinon silencieusement sur une
  base de données SQLite locale jetable sans erreur.
- **L'image du conteneur est véritablement pré-construite** (`healthchecks/healthchecks`)
  — `container_image_source` est par défaut `"prebuilt"`, vérifié à la fois
  dans sa propre valeur par défaut ET dans le `main.tf` (un module qui
  se trompe sur l'un ou l'autre construit à partir d'un Dockerfile
  inexistant ou déploie silencieusement la mauvaise image — voir le
  précédent Prowlarr_GKE dans ce catalogue).
- **Pas de mise à l'échelle à zéro nécessaire sur GKE.** Contrairement à la
  variante Cloud Run, un déploiement GKE exécute simplement son nombre de
  réplicas configuré en continu, de sorte que la boucle d'alerte
  `sendalerts`/`sendreports` co-localisée est toujours active sans
  configuration supplémentaire — il n'y a pas d'équivalent GKE de
  `cpu_always_allocated`.
- **Pas de point de terminaison de santé dédié.** Les sondes de démarrage/vivacité
  ciblent `/` (la page de connexion publique). `ALLOWED_HOSTS = "*"`
  est défini de sorte que l'en-tête Host de la sonde interne du kubelet ne soit
  jamais rejeté par la validation d'hôte de Django.
- **Le compte administrateur initial est amorcé une seule fois**, non
  auto-réparateur. Un Job d'initialisation `admin-bootstrap` exécute les
  migrations et crée le superutilisateur (`admin_email` / un mot de passe
  Secret Manager généré) via le `createsuperuser --noinput` standard de Django.
  Étant donné que l'ordre des jobs d'initialisation de GKE n'est pas aussi
  strict que celui de Cloud Run (un job peut être planifié avant le premier
  démarrage du déploiement principal), le job exécute sa propre migration en
  premier plutôt que de supposer que le schéma existe déjà.
- **L'e-mail sortant est un espace réservé par défaut.** `DEFAULT_FROM_EMAIL`
  est par défaut `healthchecks@example.org`. Configurez de vrais
  `EMAIL_HOST`/`EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` après le
  déploiement, sinon les alertes ne seront pas réellement livrées.
- **Pas de Redis, pas de stockage d'objets.** Healthchecks stocke tout l'état
  — vérifications, pings, utilisateurs, configuration d'alerte — uniquement
  dans PostgreSQL.
- **`service_type = LoadBalancer` et `reserve_static_ip = true`** — Healthchecks est une
  interface utilisateur web orientée navigateur, il obtient donc une IP
  publique stable par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms
et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Healthchecks {#a-gke-autopilot--the-healthchecks-workload}

Healthchecks s'exécute en tant que déploiement à réplica unique sur Autopilot,
qui facture le CPU/la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Healthchecks pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la planification Autopilot et le type de
charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Healthchecks stocke toutes les données de l'application (vérifications, pings,
intégrations, utilisateurs, historique des alertes) dans une instance Cloud SQL
pour PostgreSQL 15 gérée. Les pods l'atteignent en privé via le sidecar
**Cloud SQL Auth Proxy** sur `127.0.0.1`. Lors du premier déploiement, les
Jobs d'initialisation créent la base de données/rôle de l'application et
amorcent le compte administrateur initial.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Deux valeurs cryptographiques sont générées automatiquement et stockées dans
Secret Manager : `SECRET_KEY` (clé de signature de session/CSRF Django) et
`ADMIN_PASSWORD` (le mot de passe initial du superutilisateur, amorcé une
fois). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing, réservée en tant qu'IP statique afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés et les détails de
l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (y compris les workers en arrière-plan
`sendalerts`/`sendreports` co-localisés) sont acheminées vers Cloud Logging ;
les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Healthchecks {#3-healthchecks-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job
  d'initialisation `db-init` s'exécute en utilisant `postgres:15-alpine`,
  se connectant via le Cloud SQL Auth Proxy pour créer de manière
  idempotente le rôle et la base de données de l'application.
- **Amorçage du compte administrateur.** Le Job `admin-bootstrap` (utilisant
  l'image Healthchecks elle-même) exécute `manage.py migrate --noinput`, puis
  `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (mot de passe provenant d'un secret Secret Manager
  généré). Le paramètre `execute_on_apply` de GKE ne fait que contrôler
  si Terraform *attend* le job, pas si Kubernetes le planifie
  immédiatement — le job réplique donc l'étape de migration elle-même
  plutôt que de supposer que le déploiement principal a déjà démarré et
  migré.
- **Les migrations de base de données s'exécutent également à chaque démarrage
  normal du conteneur** du déploiement principal (le `uwsgi.ini` de
  l'image a `hook-pre-app = exec:./manage.py
  migrate` intégré), de sorte que la mise à niveau
  `application_version` applique automatiquement les modifications de schéma.
- **La boucle d'arrière-plan `sendalerts`/`sendreports` est
  co-localisée dans le même conteneur**, démarrée automatiquement par le
  `uwsgi.ini` de l'image aux côtés du serveur web — il n'existe pas de
  déploiement de worker séparé. Étant donné que les déploiements GKE ne
  se mettent pas à l'échelle à zéro d'eux-mêmes, cette boucle s'exécute en
  continu tant que le déploiement a au moins un réplica (la valeur par
  défaut).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/` — Healthchecks n'a pas de point de terminaison de santé
  dédié ; la page de connexion racine répond toujours sans
  authentification et renverrait une erreur 500 (ne s'afficherait pas) si la
  connexion à la base de données était interrompue.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Healthchecks sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `healthchecks` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `admin_email` | `admin@techequity.cloud` | E-mail/nom d'utilisateur du superutilisateur initial, amorcé une fois. |
| `default_from_email` | `healthchecks@example.org` | Adresse d'expéditeur de remplacement jusqu'à ce qu'un SMTP réel soit configuré. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | L'image officielle n'a pas besoin de build personnalisé. |
| `container_image` | `""` | Laisser vide pour utiliser `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | Le serveur uWSGI de l'image en amont se lie ici (`docker/uwsgi.ini`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — `DB_HOST` se résout en `127.0.0.1`, que la variable d'environnement discrète accepte tel quel. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interface utilisateur web publique — exposée en externe par défaut. |
| `workload_type` | `null` (effectif : `Deployment`) | Sans état — tout l'état réside dans PostgreSQL. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Valeur par défaut héritée. Healthchecks n'a pas besoin de système de fichiers partagé, donc définissez-le sur `false` lors du déploiement. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé — Healthchecks n'a pas d'intégration Redis documentée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe ; MySQL/SQLite ne sont pas câblés via ce module. |
| `application_database_name` | `healthchecks_db` | Immuable après le premier déploiement. |
| `application_database_user` | `healthchecks_user` | Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `service_url` | URL pour atteindre Healthchecks. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `DB` (auto-défini) | `"postgres"` | Critique | Si, pour une raison quelconque, il n'est pas défini, l'application utilise silencieusement une base de données SQLite locale jetable — les vérifications et l'historique des alertes disparaissent à chaque redémarrage, sans erreur. |
| `container_image_source` | `prebuilt` | Critique | Passer à `custom` sans Dockerfile dans `Healthchecks_Common/scripts` fait échouer le build Kaniko. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer une fois, faire pivoter via l'interface utilisateur après | Moyen | Le mot de passe amorcé n'est défini qu'à la PREMIÈRE exécution réussie de `admin-bootstrap` ; la réexécution du job ne le met pas à jour. |
| `DEFAULT_FROM_EMAIL` / variables SMTP | Configurer un SMTP réel après le déploiement | Élevé | Laissé à la valeur par défaut de l'espace réservé, `sendalerts` enregistre les erreurs de livraison au lieu de notifier réellement quiconque d'un enregistrement manqué. |
| `ALLOWED_HOSTS` (auto-défini sur `"*"`) | Laisser tel quel, sauf raison spécifique | Faible | Désactiver entièrement la validation de l'en-tête Host de Django est un compromis accepté ici pour maintenir le fonctionnement des sondes de santé de la plateforme. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Healthchecks partagée avec la variante Cloud Run est décrite dans
**[Healthchecks_Common](Healthchecks_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Healthchecks sur GKE Autopilot](../labs/Healthchecks_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Healthchecks Common — Configuration d'application partagée](Healthchecks_Common.md) — la configuration partagée par les deux cibles de déploiement.
