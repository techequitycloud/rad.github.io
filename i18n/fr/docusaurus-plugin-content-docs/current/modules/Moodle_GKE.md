---
title: "Moodle sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Moodle sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Moodle_GKE.md @ e69407af sha256:bcb451d11542 -->

# Moodle sur GKE Autopilot {#moodle-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Moodle_GKE.png" alt="Moodle sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Moodle est le système de gestion de l'apprentissage (LMS) open source le plus
populaire au monde, utilisé par les universités, les écoles, les entreprises et
les fournisseurs de formation en ligne du monde entier. Ce module déploie Moodle
sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Moodle utilise et sur la façon
de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Moodle sur RAD, et comment cela se compare {#what-moodle-costs-on-rad-and-how-that-compares}

**L'exécution de Moodle dans votre propre projet GCP coûte environ 149,81 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits uniques (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.** Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option la moins chère ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~149,81 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~116 crédits/jour, facturé à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour Moodle à comparer, donc la
  référence honnête est un VPS nu : Hetzner CPX22 (2 vCPU/4 Go) coûte environ
  **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**,
  et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois**
  — plus le temps de l'administrateur pour les sauvegardes, les correctifs de
  sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la
  surveillance gérés par RAD couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est
  généralement pas — pour le système de gestion de l'apprentissage d'une
  institution, le véritable argument est ce que RAD gère pour vous (sauvegardes,
  correctifs, secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit du système de gestion de l'apprentissage d'une
  institution, donc le coût d'exécution ci-dessus est ce qui génère réellement la
  facture, pas les frais de module — et ce coût d'exécution est celui que vous
  pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré
par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logique récupérable de 30 jours de
Google. Contrairement à la suppression d'un module, cela ne supprime pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
ne gère que la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de la supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Moodle
complètement et de le redéployer plus tard. Un redéploiement coûte à nouveau
les frais de module, plus les builds — environ 175 + 3-6 crédits de temps de
build.

La suppression ne permet d'économiser de l'argent que si Moodle reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son coût
d'exécution quotidien — par rapport au total du projet ci-dessus, cela
représente environ 4 jours ou plus. La majeure partie du coût d'exécution ici
est généralement la base de données et la VM de fichiers/cache partagés ; ils
ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
suppression de cette application pendant que quelque chose d'autre partage le
projet n'économise que la partie de calcul propre à cette application.

**Conserver les données d'abord :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant reçoit l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, afin que
  personne ne reçoive de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ;
https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les
mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Moodle fonctionne comme une charge de travail web PHP 8.3/Apache adossée à
PostgreSQL. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP 8.3/Apache, 2 vCPU / 4 Gio par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — Moodle ne prend pas en charge MySQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoire Moodle `moodledata` partagé entre toutes les répliques ; obligatoire |
| Stockage d'objets | Cloud Storage | Un bucket de données et tous les buckets supplémentaires définis par l'utilisateur |
| Cache et sessions | Redis | Activé par défaut ; revient à l'adresse IP de l'hôte NFS si aucun hôte Redis n'est donné |
| Secrets | Secret Manager | Mot de passe cron, mot de passe SMTP et mot de passe de base de données générés automatiquement |
| Planificateur | Cloud Scheduler | Tâche cron auto-provisionnée (toutes les minutes) pour `/admin/cron.php` |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe et
  `MOODLE_DB_TYPE =
  "pgsql"` est codé en dur ; la sélection de MySQL ou `NONE`
  interrompt le démarrage.
- **NFS est obligatoire.** Le répertoire Moodle `moodledata` doit être un
  système de fichiers partagé inscriptible accessible à toutes les répliques.
  `enable_nfs` est par défaut `true`.
- **Redis est activé par défaut.** Avec plus d'une réplique, un cache partagé
  est nécessaire pour maintenir la cohérence de la session PHP et de l'état de
  l'application Moodle entre les pods.
- **L'affinité de session est `ClientIP`.** Moodle s'appuie sur les
  sessions PHP, de sorte que les requêtes d'un navigateur sont épinglées à un
  pod.
- **Le domaine personnalisé est activé par défaut** (`enable_custom_domain = true`) afin que
  l'`wwwroot` de Moodle se résolve en une adresse stable plutôt qu'en
  une adresse IP de pod transitoire.
- **Une tâche Cloud Scheduler est auto-provisionnée.** Elle se déclenche toutes
  les minutes pour `/admin/cron.php` en utilisant un mot de passe cron sécurisé
  et auto-généré stocké dans Secret Manager.
- Le **mot de passe cron** et le **mot de passe SMTP** sont générés
  automatiquement et stockés dans Secret Manager ; vous ne les définissez
  jamais en texte clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Moodle {#a-gke-autopilot--the-moodle-workload}

Les pods Moodle sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Moodle pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle
et le type de charge de travail (Déploiement vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Moodle stocke toutes les données de l'application (cours, utilisateurs, notes,
journaux d'activité) dans une instance gérée de Cloud SQL pour PostgreSQL 15.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un
socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier
déploiement, une tâche d'initialisation crée la base de données et l'utilisateur
de l'application et active l'extension `pg_trgm` pour la recherche en texte
intégral de Moodle.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `moodledata` de Moodle est écrit sur un partage **Filestore
(NFS)** monté dans chaque pod afin que toutes les répliques voient les mêmes
fichiers téléchargés, les mêmes supports de cours et les mêmes soumissions
d'utilisateurs. Un bucket de données **Cloud Storage** dédié est également
provisionné ; le compte de service de la charge de travail se voit accorder un
accès automatique.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage →
  Buckets pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la gestion des sessions PHP de Moodle et le cache de
l'application. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est
activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison
Redis — ce qui convient pour le développement. Pour la production avec
plusieurs répliques, définissez `redis_host` sur une adresse IP d'instance
Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping           # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe cron de Moodle et le mot de passe SMTP sont générés
automatiquement par `Moodle_Common` et stockés en tant que secrets Secret
Manager. Le mot de passe de la base de données est généré et géré par la
fondation. Les trois sont injectés dans les pods au moment de l'exécution ; le
texte en clair n'apparaît jamais dans les fichiers de configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Après le déploiement, mettez à jour le secret du mot de
passe SMTP avec votre véritable identifiant SMTP :
```bash
echo -n "your-smtp-password" | \
  gcloud secrets versions add <smtp-password-secret> --data-file=- --project "$PROJECT"
```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### F. Cloud Scheduler {#f-cloud-scheduler}

Une tâche Cloud Scheduler est auto-provisionnée à chaque déploiement pour
piloter la file d'attente des tâches internes de Moodle. Elle se déclenche
toutes les minutes et s'authentifie à l'aide de l'`MOODLE_CRON_PASSWORD` auto-généré.

- **Console :** Cloud Scheduler → Tâches.
- **CLI :**
  ```bash
  gcloud scheduler jobs list --project "$PROJECT"
  gcloud scheduler jobs describe <job-name> --location "$REGION" --project "$PROJECT"
  # Manually trigger a cron run:
  gcloud scheduler jobs run <job-name> --location "$REGION" --project "$PROJECT"
  ```

### G. Réseau et ingress {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud
Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements. `enable_custom_domain` est par défaut `true`
afin que l'`wwwroot` de Moodle soit toujours résolvable en une adresse
stable.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Moodle {#3-moodle-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Deux tâches
  d'initialisation s'exécutent avant le démarrage de l'application. La tâche
  `db-init` crée la base de données et l'utilisateur Moodle, active
  l'extension `pg_trgm` et accorde les privilèges (idempotent, peut être
  réexécuté en toute sécurité). La tâche `nfs-init` crée les
  sous-répertoires Moodle requis (`filedir`, `temp`,
  `cache`, `localcache`) sur le partage NFS et définit la
  propriété `www-data`.
- **Planification cron automatique.** Une tâche Cloud Scheduler se déclenche
  toutes les minutes en ciblant `/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`. Cela pilote toutes les
  tâches planifiées de Moodle : sauvegardes de cours, notifications par e-mail,
  traitement des badges et achèvements d'activités. La tâche est toujours
  créée et ne peut pas être désactivée.
- **Chemin de santé.** Les sondes de disponibilité/vivacité utilisent
  `/health.php`, qui renvoie HTTP 200 lorsque PHP est opérationnel. La
  sonde de démarrage autorise jusqu'à 10 minutes pour la création du schéma au
  premier démarrage et l'enregistrement des plugins.
- **E-mail sortant SMTP.** Les paramètres SMTP sont injectés en tant que
  variables d'environnement. Remplacez les valeurs par défaut à l'aide de
  `environment_variables` (voir Groupe 5). Le mot de passe SMTP est
  auto-généré et stocké dans Secret Manager ; mettez à jour le secret avec
  votre véritable identifiant après le déploiement.
- **Résolution `wwwroot`.** L'`config.php` de Moodle résout
  `wwwroot` à partir de la variable d'environnement
  `APP_URL`, en revenant à `GKE_SERVICE_URL`. Les domaines
  personnalisés nécessitent `enable_custom_domain = true` (la valeur par défaut) pour
  produire une URL stable.
- **Connexion administrateur.** Le nom d'utilisateur et l'e-mail de
  l'administrateur initial sont configurables via `environment_variables`. Le mot de
  passe de l'administrateur est défini lors de la première installation de
  Moodle via `admin/cli/install_database.php`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Moodle sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `moodle` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Moodle LMS` | Nom convivial affiché dans la console. |
| `application_description` | `Moodle Learning Management System on GKE Autopilot` | Annotation de description de la charge de travail. |
| `description` | `Moodle LMS - Online learning and course management platform` | Transmis à `Moodle_Common` comme entrée `description` ; distinct de `application_description` ci-dessus. |
| `application_version` | `4.5.1` | Tag de version de l'image du conteneur ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour Moodle. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 Gio recommandés (évite les OOM PHP lors des importations). |
| `min_instance_count` | `0` | Répliques minimales. Définir sur `1` pour la production afin de maintenir les tâches planifiées en cours d'exécution. |
| `max_instance_count` | `5` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `8080` | Moodle/Apache écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Remplacez les valeurs par défaut SMTP auto-injectées ici (par exemple, `MOODLE_SMTP_HOST`, `MOODLE_ADMIN_EMAIL`). |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP de Moodle. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC pour le stockage persistant par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health.php`, 20 échecs × 30 s | Jusqu'à 10 minutes pour que Moodle termine la configuration du premier démarrage. |
| `liveness_probe` | HTTP `/health.php`, délai initial de 120 s | Vérification de santé périodique après le démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les tâches intégrées `db-init` et `nfs-init`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes supplémentaires (le cron Moodle de Cloud Scheduler est toujours créé séparément). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour Moodle `moodledata` (garder activé — requis pour tous les déploiements). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur ; injecté comme `MOODLE_DATA_DIR`. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse pour les thèmes ou les plugins. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour les sessions PHP et le cache de l'application Moodle. |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP de l'hôte NFS (développement uniquement) ; définir sur une adresse IP Cloud Memorystore pour la production. |
| `redis_port` | `6379` | Port Redis (type chaîne). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixé à PostgreSQL — ne pas modifier. |
| `application_database_name` | `gkeapp` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `db_name` | `moodle` | Alias de nom de base de données spécifique à Moodle ; maintenir la cohérence avec `application_database_name`. |
| `db_user` | `moodle` | Alias d'utilisateur spécifique à Moodle ; maintenir la cohérence avec `application_database_user`. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Utilisez ceci pour exécuter des extensions PostgreSQL
supplémentaires ou des données d'amorçage. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré (requis pour le bon fonctionnement de Moodle `wwwroot`). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Moodle. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Moodle. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `nfs_server_ip` | IP privée du serveur NFS Filestore (sensible). |
| `nfs_mount_path` | Chemin du conteneur où le partage NFS est monté. |
| `nfs_share_path` | Chemin d'exportation sur le serveur NFS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` / `nfs_setup_job` | Noms des tâches de configuration et (facultatives) d'importation/NFS. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critique | Moodle nécessite PostgreSQL ; `MOODLE_DB_TYPE = "pgsql"` est codé en dur — tout autre moteur interrompt le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage NFS partagé, `moodledata` n'est pas partagé entre les répliques et les téléchargements sont perdus au redémarrage du pod. |
| `application_database_name` / `db_name` | défini une fois, maintenir la cohérence | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue la tâche d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_redis` | `true` | Élevé | Avec >1 réplique, les caches isolés par pod entraînent une incohérence de session PHP. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des OOM PHP lors des importations de cours ou des téléchargements de fichiers volumineux. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les connexions Moodle multi-répliques perdent l'état de la session. |
| `min_instance_count` | `1` pour la production | Élevé | `0` peut laisser la tâche cron de Cloud Scheduler sans pod à livrer pendant les périodes de mise à l'échelle à zéro. |
| `enable_custom_domain` | `true` (par défaut) | Élevé | Sans URL stable, l'`wwwroot` de Moodle se résout en une adresse IP de pod transitoire, ce qui rompt les liens absolus et les chemins de fichiers. |
| `nfs_mount_path` | `/mnt/nfs` | Élevé | Doit correspondre à `MOODLE_DATA_DIR` ; la modification après le premier déploiement déplace la racine des données et rompt l'installation. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interface d'administration | Moyen | L'interface utilisateur d'administration est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration partagée spécifique à Moodle est
décrite dans **[Moodle_Common](Moodle_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Moodle sur GKE Autopilot](../labs/Moodle_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Moodle sur Google Cloud Run](Moodle_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Moodle Common — Configuration d'application partagée](Moodle_Common.md) — la configuration partagée par les deux cibles de déploiement.
