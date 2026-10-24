---
title: "Memos sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Memos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Memos_GKE.md @ 1665a43e sha256:8acbca7076be -->

# Memos sur GKE Autopilot {#memos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_GKE.png" alt="Memos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos est un service de prise de notes open-source, sous licence MIT, auto-hébergé,
conçu pour la capture rapide de markdown — un binaire Go d'environ 20 Mo avec un
frontend React. Ce module déploie Memos sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Memos et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à chaque application GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et le cycle de vie du déploiement — veuillez vous référer
au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Memos sur RAD, et comment cela se compare {#what-memos-costs-on-rad-and-how-that-compares}

**L'exécution de Memos dans votre propre projet GCP coûte environ 104,74 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement,
consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous
déployez dans un projet géré par RAD, vous pouvez tout mettre en pause
gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~104,74 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~92 crédits/jour, mesuré toutes les heures par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **104,74 $** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour Memos à comparer, donc la
  référence honnête est un VPS nu : une plus petite machine suffit — un Hetzner
  de classe CX11 ou un Droplet DigitalOcean de 1 vCPU/1-2 Go coûte **6-12 $/mois**
  — mais il faut toujours quelqu'un pour le patcher, le sauvegarder et le
  surveiller, ce que le Cloud SQL géré, Secret Manager et la surveillance de RAD
  couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes d'argent, et ne l'est
  généralement pas — pour un service de prise de notes personnel à faible trafic,
  le véritable argument est ce que RAD gère pour vous (sauvegardes, correctifs,
  secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit d'un service de prise de notes personnel à faible
  trafic, donc le coût d'exécution ci-dessus est ce qui génère réellement la
  facture, pas les frais de module — et ce coût d'exécution est celui que vous
  pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré
par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression d'un module, cela ne détruit pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox que la plupart des utilisations d'étude/démo conviennent). Google
déclare que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Memos
complètement et de le redéployer plus tard. Un redéploiement coûte à nouveau les
frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Memos resterait
inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à
son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus,
cela représente environ 2 jours ou plus. La majeure partie du coût d'exécution
ici est généralement la base de données et la VM de fichier/cache partagée ;
elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc
la suppression de cette application pendant que quelque chose d'autre partage le
projet n'économise que la partie calcul propre à cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations
de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Memos fonctionne comme une seule charge de travail web Go. Le déploiement relie
un ensemble délibérément restreint de services Google Cloud — Memos n'a pas de
file d'attente, pas de cache et pas de workers en arrière-plan :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go, 1 vCPU / 512 MiB par défaut, autoscalé horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — ce module standardise sur Postgres via une seule URL de connexion `MEMOS_DSN` |
| Stockage d'objets | aucun | Non provisionné par ce module — voir la note sur les pièces jointes ci-dessous |
| Cache et file d'attente | aucun | Memos n'a pas de dépendance de file d'attente ou de cache |
| Secrets | Secret Manager | Seul le mot de passe de la base de données (géré par la Fondation) ; Memos lui-même n'a pas de secret au niveau de l'application |
| Ingress | Cloud Load Balancing | LoadBalancer externe, nom de domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL est le moteur standardisé.** `Memos_Common` corrige
  `database_type = "POSTGRES_15"`.
- **Aucun secret d'amorçage d'administrateur n'existe.** Le **premier compte créé via l'interface
  utilisateur web devient l'hôte/administrateur** — il n'y a pas de variable d'environnement de
  type `DEFAULTUSER` et rien à récupérer de Secret Manager pour la première connexion.
- **`workload_type = "Deployment"`, pas `StatefulSet`.** Memos ne conserve aucun état local
  qui doit survivre à un redémarrage de pod au-delà de ce qui est déjà dans Cloud SQL — pas de PVC,
  pas de montage NFS requis.
- **L'affinité de session n'est pas requise.** Memos n'a pas d'état WebSocket
  en cours de traitement lié à un pod spécifique (contrairement aux modèles de
  push en direct d'Activepieces ou de Gotify), donc le `session_affinity = "None"` par défaut est
  correct.
- **`min_instance_count = 0` / `max_instance_count = 1`.** GKE Autopilot facture par
  pod en cours d'exécution ; le HPA peut réduire à zéro réplica lorsqu'il est
  inactif.
- **Le DSN de la base de données est calculé au démarrage du conteneur**, non intégré à l'image.
  `memos-entrypoint.sh` lit les variables `DB_*` injectées par la plateforme — sur GKE,
  `DB_HOST` arrive comme `127.0.0.1` (le sidecar cloud-sql-proxy) — et construit l'URL de connexion
  unique `MEMOS_DSN` que Memos attend.
- **Aucun stockage d'objets n'est provisionné.** Ce module ne déclare pas de
  bucket GCS, de volume ou de PVC pour les pièces jointes de fichiers
  téléchargées. Les notes textuelles persistent entièrement dans PostgreSQL, mais
  les pièces jointes binaires vivraient sur le système de fichiers éphémère du
  pod et ne survivraient **pas** à un redémarrage de pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Memos {#a-gke-autopilot--the-memos-workload}

Les pods Memos sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Memos pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Memos stocke toutes les données de l'application (notes, tags, utilisateurs,
métadonnées de ressources) dans une instance gérée de Cloud SQL pour PostgreSQL
15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1` ; aucune IP publique n'est exposée. Lors du premier déploiement, un
Job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le secret du mot de passe de la base de données existe pour ce module —
entièrement géré par la Fondation, et non par `Memos_Common`. Memos génère sa
propre clé de signature de session interne et la stocke dans sa propre base de
données au premier démarrage.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est exposé via un service Kubernetes (`LoadBalancer` par défaut) avec une
adresse IP externe. Un Gateway/Ingress avec un domaine personnalisé et un
certificat TLS géré peut être ajouté.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau →
  Équilibrage de charge.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
GKE et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Memos {#3-memos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le sidecar cloud-sql-proxy et crée de manière idempotente le rôle
  et la base de données de l'application. Le job peut être réexécuté en toute
  sécurité.
- **Migrations de schéma au démarrage.** Memos applique sa propre configuration
  de schéma GORM auto-migrate interne à chaque démarrage de pod — aucun job de
  migration séparé n'est nécessaire.
- **Aucun identifiant d'amorçage d'administrateur à récupérer.** Le premier
  compte créé via le formulaire d'inscription de l'interface web devient
  l'hôte/administrateur.
- **Le DSN de la base de données est calculé, non statique.** `memos-entrypoint.sh` construit
  `MEMOS_DSN` à partir de `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` au
  démarrage du conteneur — la branche de bouclage (`DB_HOST=127.0.0.1`, `sslmode=disable`)
  est prise sur GKE, puisque le sidecar cloud-sql-proxy termine déjà TLS. Voir
  [Memos_Common](Memos_Common.md) pour la logique de branchement complète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/` — la page de connexion/d'accueil publique de Memos, accessible sans
  authentification.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Memos sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le cluster et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `memos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Memos` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Memos note-taking service on GKE` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Memos_Common` mappe `"latest"` à l'argument de build Dockerfile épinglé `MEMOS_VERSION = "0.28.0"`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper avec le point d'entrée DSN calculé. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `512Mi` | Mémoire par pod — suffisante pour la petite empreinte de Memos. |
| `min_instance_count` | `0` | minReplicas HPA. |
| `max_instance_count` | `1` | maxReplicas HPA ; augmenter pour une charge concurrente plus élevée. |
| `container_port` | `5230` | Port natif par défaut de Memos — aucune remappage effectué. |
| `enable_cloudsql_volume` | `true` | Sidecar cloud-sql-proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Memos dans Artifact Registry. |
| `session_affinity` | `None` | Aucune session au niveau du pod requise. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

Paramètres d'exposition de service et IAP standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `service_type` (`LoadBalancer` par défaut),
`enable_iap`, `iap_authorized_users`.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Toute valeur `MEMOS_*` documentée par Memos peut être définie ici. La connexion à la base de données (`MEMOS_DSN`, `MEMOS_DRIVER`) est calculée automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` | `false` | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration Cloud Build standard d'App_GKE — voir [App_GKE](App_GKE.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Aucun bucket provisionné par défaut. |
| `enable_nfs` | `true` | Non utilisé — Memos ne conserve aucun état en dehors de PostgreSQL dans le câblage de ce module. |
| `stateful_pvc_enabled` | `null` | Non défini, donc la propre logique de résolution de `App_GKE` s'applique (pas de PVC). Memos est sans état au niveau du pod ; aucun PVC de bloc n'est nécessaire. |
| `gcs_volumes` | `[]` | Ajouter une entrée ici (montée dans le répertoire de données de Memos) si la persistance des pièces jointes est requise. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixé par `Memos_Common`. |
| `application_database_name` | `memos` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `memos` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 30s de délai | Sonde de démarrage — cible la page de connexion publique. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; nécessite un point de terminaison accessible publiquement. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP du service. |
| `service_external_ip` | IP externe du LoadBalancer (quand `service_type = "LoadBalancer"`). |
| `service_url` | URL du service déployé. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés — vides par défaut. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (inclut `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si la charge de travail Kubernetes a atteint l'état Prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| Premier compte créé via l'inscription | Le créer immédiatement après le déploiement | Critique | Le **premier** compte à s'inscrire devient hôte/administrateur — si laissé ouvert, tout visiteur qui atteint l'IP externe en premier revendique ce rôle. |
| Auto-inscription publique | Désactiver après le premier administrateur | Élevé | Memos est livré avec une inscription ouverte par défaut. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, qui n'a pas de logique pour calculer `MEMOS_DSN` — elle doit être câblée manuellement ou le pod CrashLoopBackOffs en cas d'échec de connexion à la base de données. |
| `stateful_pvc_enabled` | `false` (par défaut) | Faible | Memos n'a pas besoin de stockage en bloc ; l'activer ajoute une consommation de quota SSD inutile. |
| `gcs_volumes` pour les pièces jointes | Ajouter explicitement si nécessaire | Moyen | Sans cela, les pièces jointes binaires téléchargées vivent sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage de pod. |
| `min_instance_count` | `0` (par défaut) | Faible | La mise à l'échelle à zéro retarde brièvement la première requête après l'inactivité pendant la planification d'un nouveau pod — démarrage à froid d'Autopilot, pas un bug de l'application. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Memos partagée avec la variante Cloud
Run est décrite dans **[Memos_Common](Memos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Memos sur GKE Autopilot](../labs/Memos_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Memos sur Google Cloud Run](Memos_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Memos Common — Configuration d'application partagée](Memos_Common.md) — la configuration partagée par les deux cibles de déploiement.
