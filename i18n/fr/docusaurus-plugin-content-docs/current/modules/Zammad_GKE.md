---
title: "Zammad sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Zammad sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Zammad_GKE.md @ e69407af sha256:ecd07e69834f -->

# Zammad sur GKE Autopilot {#zammad-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zammad_GKE.png" alt="Zammad sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zammad est une plateforme open source de helpdesk et de support client — une
alternative à Zendesk et Freshdesk conforme au RGPD. Ce module déploie Zammad sur
**GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Zammad et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous
référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Zammad sur RAD, et comment cela se compare {#what-zammad-costs-on-rad-and-how-that-compares}

**L'exécution de Zammad sur des pods GKE Autopilot dans votre propre projet Google
Cloud coûte environ 149,81 $/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 300 crédits facturé une seule fois au moment du déploiement.
Zammad nécessite une base de données PostgreSQL et un serveur de fichiers partagé
NFS/cache pour les pièces jointes, qui, avec le pod lui-même, représentent les
149,81 $ ci-dessus. Dans un projet géré par RAD, les frais de module tombent à 270
crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au
lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous pour l'avantage unique d'un projet géré par RAD qu'un VPS auto-hébergé
ne peut égaler — ou voir le [guide Cloud Run](Zammad_CloudRun.md) pour l'option
moins coûteuse.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 300 crédits | 270 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 149,81 $/mois, facturé par Google au prix catalogue | ~111 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont
partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule,
sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Zammad, le fournisseur derrière ce projet open source, vend également une
  version cloud hébergée : sa [page de tarification](https://zammad.com/en/pricing)
  (vérifiée le 8 octobre 2026) indique Starter v2 à 7-9 €/agent/mois (jusqu'à 5
  agents), Professional v2 à 16-18 €/agent/mois (jusqu'à 35 agents) et Plus v2 à
  25-27 €/agent/mois (agents illimités), hors TVA.
- Cette tarification par agent signifie que le cloud de Zammad devient plus cher
  à mesure que vous ajoutez du personnel de support — une équipe professionnelle
  de 10 agents coûterait environ 160-180 €/mois (environ 170-195 $) — tandis que
  le coût d'exécution fixe de RAD de 149,81 $/mois plus les frais de module
  uniques ne changent pas avec le nombre d'employés, ce qui favorise RAD une fois
  qu'une équipe de support dépasse une poignée d'agents.
- Une alternative bare-VPS fonctionne également : un GCP Compute Engine
  e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois, ou une machine Hetzner/DigitalOcean
  de taille similaire à environ 24 $/mois, peut auto-héberger Zammad et Postgres
  ensemble — moins cher que RAD ou le cloud de Zammad en termes d'argent, sans
  aucune des sauvegardes gérées, des correctifs ou de la surveillance que l'un ou
  l'autre fournit.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant
la pause. La suppression d'un projet géré par RAD délie d'abord sa facturation,
puis demande à Google de supprimer le projet purement et simplement — la propre
suppression logicielle récupérable de Google de 30 jours. Contrairement à la
suppression d'un module, cela ne démolit **pas** Cloud SQL, aucune VM ou la
ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et
rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de facturation,
puis vous demande d'exécuter Update sur chaque déploiement pour confirmer que tout
est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour
trouve les mêmes ressources déjà là — c'est une vérification, pas une
reconstruction, et une mise à jour ne facture plus jamais les frais de module.
Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours
— après quoi Google le supprime définitivement — et la restauration est admise
comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés
doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que
la plupart des utilisations d'étude/démo conviennent). Google affirme que la
plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant
une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours.
Si vous avez personnalisé Zammad et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant
de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela
n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources pour de bon, et le retour de Zammad signifie un redéploiement à partir
de zéro. Cela coûte environ 303-306 crédits (les frais de module de 300 crédits
plus un build).

La suppression ne permet d'économiser de l'argent que si Zammad reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution — pour Zammad, c'est environ 7 jours ou plus. La majeure partie
de ce coût d'exécution est généralement la base de données et toute VM de fichier/cache
partagée — celles-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les
utilise, donc la suppression de cette application pendant que quelque chose d'autre
partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
le formateur. Soit le formateur finance toutes les places, soit chaque participant
paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés
retournent au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la facturation
est suspendue et les données sont conservées, de sorte que personne ne reçoit de
frais inattendus. À la fin, le partenaire transfère le projet et les déploiements
deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
[radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de
RAD et les estimations de crédits quotidiens ; [documentation de Google sur la
suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration. Prix du cloud hébergé Zammad de
[zammad.com/en/pricing](https://zammad.com/en/pricing), vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Zammad s'exécute comme une charge de travail Ruby on Rails (railsserver). Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails, 2 vCPU / 4 GiB par défaut, auto-scalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Zammad ne prend pas en charge MySQL |
| Stockage des pièces jointes | Filestore (NFS) | Pièces jointes de ticket à `/opt/zammad/storage`, partagées entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket `zammad-attachments` dédié, toujours provisionné |
| Cache et file d'attente de jobs | Redis | Activé par défaut ; requis pour ActionCable WebSocket pub/sub et Sidekiq |
| Secrets | Secret Manager | Mot de passe de base de données géré automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Le moteur de base de données est fixe ; MySQL n'est
  pas pris en charge et est rejeté au moment de la planification.
- **Redis est requis.** Zammad utilise Redis pour les mises à jour de tickets en
  temps réel (ActionCable) et le traitement des jobs en arrière-plan (Sidekiq).
  Sans cela, Zammad ne démarre pas.
- **Une image personnalisée est construite via Cloud Build.** `container_image_source = "custom"` est
  la valeur par défaut — Cloud Build enveloppe l'image Docker Hub officielle `zammad/zammad`
  avec un `entrypoint.sh` spécifique à GCP qui mappe les variables `DB_*` de la
  fondation à la convention `POSTGRESQL_*` de Zammad.
- **Les migrations de base de données s'exécutent à chaque démarrage de pod**
  (idempotent via `zammad-init`). La sonde de démarrage laisse amplement le temps pour
  la migration au premier démarrage.
- **L'affinité de session est `ClientIP`, mais le push en temps réel ActionCable
  WebSocket ne fonctionne pas réellement.** `additional_services` est vide par défaut pour ce
  module, de sorte que le processus `zammad-websocket` (port 6042) n'est jamais exposé via
  un service Kubernetes — la négociation WebSocket du navigateur ne peut pas l'atteindre,
  le même écart documenté pour Cloud Run dans `Zammad_Common/scripts/entrypoint.sh`. L'affinité de session
  ne fixe que les requêtes HTTP ordinaires à un seul pod ; l'interface utilisateur
  revient à l'interrogation pour les mises à jour de tickets en direct.
- **PodDisruptionBudget est activé par défaut.** Au moins un pod Zammad reste en
  fonctionnement pendant la maintenance des nœuds.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Zammad {#a-gke-autopilot--the-zammad-workload}

Les pods Zammad sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Zammad pour voir les pods, les événements et l'utilisation des ressources.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zammad stocke toutes les données du helpdesk (tickets, utilisateurs, canaux,
enregistrements SLA) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les
pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket
Unix — aucune IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application. À
chaque démarrage de pod ultérieur, `zammad-init` applique toutes les migrations de
schéma en attente.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les pièces jointes de tickets et les fichiers téléchargés sont écrits sur un
partage **Filestore (NFS)** monté à `/opt/zammad/storage` à l'intérieur de chaque pod afin
que toutes les répliques voient les mêmes fichiers. Un bucket **Cloud Storage**
(`zammad-attachments`) dédié est également provisionné automatiquement ; le compte de service
de la charge de travail se voit accorder l'accès.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket des pièces jointes.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis et file d'attente de jobs {#d-redis-cache-and-job-queue}

Redis est obligatoire pour Zammad et remplit deux rôles critiques :

1. **ActionCable pub/sub** — fournit des mises à jour de tickets en temps réel aux
   agents sur plusieurs pods.
2. **Sidekiq** — traite les jobs en arrière-plan (envoi d'e-mails, notifications
   SLA, synchronisation LDAP, tâches de planification).

Lorsqu'aucun `redis_host` externe n'est configuré et que NFS est activé, l'adresse IP
de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  redis-cli -h <redis-host> client list    # active Sidekiq/ActionCable connections
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager
et injecté dans les pods au moment de l'exécution ; le texte en clair n'apparaît
jamais dans la configuration. Zammad gère ses propres clés de signature internes
au démarrage — aucun secret au niveau de l'application n'est auto-généré.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et
une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Zammad {#3-zammad-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) s'exécute avant le démarrage de l'application. Il se
  connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente la base de
  données Zammad, l'utilisateur et accorde les privilèges. Il peut être exécuté
  à nouveau en toute sécurité.
- **Migrations à chaque démarrage.** Le `entrypoint.sh` personnalisé appelle `zammad-init`
  (migration de base de données Rails + seed) avant de démarrer le railsserver à
  chaque démarrage de pod. Les migrations en attente sont appliquées ; celles déjà
  exécutées sont ignorées.
- **Pontage des variables.** Le module Foundation injecte les identifiants de base
  de données en tant que `DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc. Le `entrypoint.sh` personnalisé
  mappe ces derniers à la convention `POSTGRESQL_*` de Zammad au moment de l'exécution.
- **Connectivité WebSocket — le push en temps réel ne fonctionne pas réellement
  sur GKE non plus.** Le processus `zammad-websocket` (ActionCable) démarre sur le port 6042
  à côté du railsserver, mais `main.tf` transmet `additional_services = var.additional_services` (vide par défaut, jamais
  rempli avec une entrée 6042 pour ce module), de sorte qu'aucun service Kubernetes
  n'expose ce port — la négociation WebSocket du navigateur ne peut pas l'atteindre.
  L'interface utilisateur revient gracieusement à l'interrogation, la même limitation
  documentée pour Cloud Run dans `Zammad_Common/scripts/entrypoint.sh`. `enable_redis = true` est toujours obligatoire pour la
  production car Sidekiq (jobs en arrière-plan) en dépend quelle que soit
  l'accessibilité d'ActionCable.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/` par défaut, qui renvoie HTTP 200 uniquement lorsque Zammad est
  entièrement initialisé (`path` peut être remplacé, par exemple par `/api/v1/ping`).
  La sonde de démarrage permet une tolérance généreuse (délai initial de 60
  secondes, jusqu'à 30 tentatives) pour s'adapter à la migration de schéma au
  premier démarrage.
- **Intégration de la messagerie.** Zammad envoie des notifications par e-mail
  pour les événements de ticket et les réinitialisations de mot de passe.
  Configurez le SMTP après la première connexion dans **Admin → Channels → Email**.
  Les identifiants SMTP peuvent être injectés en tant que variables d'environnement
  secrètes.
- **Inspecter les jobs en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl get cronjobs -n "$NAMESPACE"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Zammad sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `elasticsearch_url` | `""` | Point de terminaison HTTP Elasticsearch pour la recherche en texte intégral. Laisser vide pour désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch. Laisser vide lorsque la sécurité est désactivée. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zammad` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Zammad Helpdesk` | Nom convivial affiché dans la console. |
| `application_description` | `Zammad Open-source Helpdesk on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `6.4.1` | Tag de version de l'image Zammad ; incrémenter pour déployer une nouvelle build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build (requis pour le point d'entrée GCP) ; `prebuilt` ignore la construction. |
| `container_image` | `""` | Remplace l'URI de l'image du conteneur. Laisser vide pour que Cloud Build le gère. |
| `container_resources` | `{ cpu_limit: "2000m", memory_limit: "4Gi" }` | Limites CPU/mémoire et requêtes optionnelles. Validé au moment de la planification. |
| `container_port` | `3000` | Port du railsserver Zammad. Doit correspondre à `ZAMMAD_RAILSSERVER_PORT`. |
| `min_instance_count` | `1` | Nombre minimum de répliques. Garder ≥ 1 pour que les agents évitent les longs démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximum de répliques (plafond de l'autoscaler). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. Ne pas désactiver. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Zammad Docker Hub dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales `POSTGRESQL_*` et `RAILS_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager (par exemple pour les mots de passe SMTP). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le Service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour la continuité de la session WebSocket. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `60` | Kubernetes attend ce temps après SIGTERM avant d'arrêter de force le conteneur. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC ; sélectionne automatiquement le type de charge de travail StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC StatefulSet. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones pour une résilience aux pannes de zone. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/`, délai de 120s, 15 tentatives (remplacer `path` pour `/api/v1/ping`) | Tolérance généreuse pour la migration de schéma au premier démarrage. |
| `liveness_probe` / `health_check_config` | `/`, délai de 60s (remplacer `path` pour `/api/v1/ping`) | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé, `path = "/"` | Vérification de disponibilité Cloud Monitoring optionnelle ; remplacer `path` si activé avec `/api/v1/ping`. |
| `alert_policies` | `[]` | Politiques d'alerte métriques optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Une liste non vide le remplace entièrement. |
| `cron_jobs` | `[]` | CronJobs planifiés — Zammad gère sa propre planification interne ; ajoutez ici des jobs de maintenance personnalisés. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Zammad. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le stockage des pièces jointes Zammad (garder activé). |
| `nfs_mount_path` | `/opt/zammad/storage` | Chemin de montage à l'intérieur du conteneur. Doit correspondre à la configuration de stockage de Zammad. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. Le bucket `zammad-attachments` est toujours créé. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis et file d'attente de jobs {#group-15--redis-cache--job-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis.** Utiliser Redis pour ActionCable et Sidekiq. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP de l'hôte NFS ; définir explicitement pour Memorystore ou un serveur Redis dédié. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Zammad nécessite PostgreSQL. |
| `application_database_name` | `zammad` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `zammad` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé / `[]` | Installer des extensions PostgreSQL supplémentaires après le provisionnement. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress Kubernetes pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Zammad. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
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
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Zammad. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `zammad-attachments`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnels) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Zammad nécessite PostgreSQL ; MySQL est rejeté au moment de la planification. |
| `container_image_source` | `custom` (par défaut) | Critique | L'utilisation de `prebuilt` sans le point d'entrée personnalisé signifie que le mappage `DB_*` → `POSTGRESQL_*` ne se produit pas et toutes les connexions à la base de données échouent au démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation supprime le socket Auth Proxy ; toutes les connexions à la base de données échouent. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données du helpdesk. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation ; l'activation à chaque apply écrase les données en direct. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_redis` | `true` | Critique | Sans Redis, ActionCable et Sidekiq ne parviennent pas à s'initialiser ; Zammad ne démarrera pas. |
| `redis_host` | IP explicite ou NFS | Critique | Vide avec NFS désactivé signifie aucun point de terminaison Redis valide — Zammad ne démarre pas. |
| `container_resources.memory_limit` | `4Gi` | Élevé | Zammad OOM (Out Of Memory) pendant la migration de schéma ou sous charge en dessous de 2 GiB. |
| `nfs_mount_path` | `/opt/zammad/storage` | Élevé | La modification de ceci entraîne l'écriture des pièces jointes dans un stockage de pod éphémère ; les pièces jointes NFS existantes deviennent inaccessibles. |
| `enable_nfs` | `true` | Élevé | Sans NFS, toutes les pièces jointes téléchargées sont perdues lors du redémarrage du pod ou de la mise à jour progressive. |
| `min_instance_count` | `1` | Élevé | `0` provoque des démarrages à froid de 60 à 90 secondes pour le premier agent qui ouvre un ticket. |
| `session_affinity` | `ClientIP` | Moyen | Affecte uniquement le routage des requêtes HTTP ordinaires entre les répliques ; cela n'active PAS ActionCable — `additional_services` est vide par défaut, de sorte que le port 6042 n'est jamais exposé via un service Kubernetes, et le push WebSocket en temps réel ne fonctionne pas quelle que soit cette configuration. Ne vous y fiez pas pour les mises à jour de tickets en direct. |
| `stateful_pvc_enabled = true` avec `workload_type = "Deployment"` | éviter | Élevé | Cette combinaison échoue au moment de la planification. |
| `startup_probe.initial_delay_seconds` | `60` (ou plus) | Élevé | Trop court provoque des boucles de redémarrage au premier démarrage pendant l'exécution de la migration de schéma. |
| `max_instance_count` > 1 sans Redis | configurer Redis d'abord | Moyen | Plusieurs pods sans Redis provoquent des conditions de concurrence sur l'attribution des tickets et une divergence d'état en temps réel. |
| `enable_topology_spread` | activer pour multi-réplique | Moyen | Sans répartition, tous les pods peuvent atterrir dans une seule zone ; une panne de zone fait tomber le helpdesk. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur d'administration de Zammad est autrement publiquement accessible. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Zammad
partagée avec la variante Cloud Run est décrite dans
**[Zammad_Common](Zammad_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Zammad sur GKE Autopilot](../labs/Zammad_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Zammad sur Google Cloud Run](Zammad_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Zammad Common — Configuration d'application partagée](Zammad_Common.md) — la configuration partagée par les deux cibles de déploiement.
