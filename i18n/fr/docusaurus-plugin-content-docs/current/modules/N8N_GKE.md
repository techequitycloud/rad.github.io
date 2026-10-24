---
title: "n8n sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de n8n sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/N8N_GKE.md @ 1665a43e sha256:55883b415c54 -->

# n8n sur GKE Autopilot {#n8n-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_GKE.png" alt="n8n sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme d'automatisation de flux de travail (workflow) en fair-code
qui connecte des API, des bases de données et des services avec un éditeur de
nœuds visuel. Ce module déploie n8n sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par n8n et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à chaque application GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez
vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte n8n sur RAD, et comment cela se compare {#what-n8n-costs-on-rad-and-how-that-compares}

**L'exécution de n8n dans votre propre projet GCP coûte environ 149,81 $/mois en frais Google Cloud ; les frais de module de RAD sont de 300 crédits (ou 270 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 300 crédits, une fois | 270 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~149,81 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~116 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $** |

### Comment cela se compare {#how-it-compares}

- Le cloud géré officiel de n8n (n8n Cloud) commence à **20 €/mois** facturé annuellement pour le plan Starter (2 500 exécutions de workflow) (source : https://n8n.io/pricing), géré par le projet lui-même sans infrastructure à opérer — la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD qui le gère.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit de l'épine dorsale de l'automatisation des flux de travail d'une équipe, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement
le projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un module, cela ne supprime pas Cloud SQL, une VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de récupérer le projet et de rattacher son compte de facturation, puis vous
demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est
revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise
à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de
crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours —
après cela, Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours
dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des
utilisations d'étude/démo conviennent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé l'application et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration
de 30 jours ci-dessus), l'alternative est de supprimer n8n purement et simplement et de
le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les
builds — environ 300 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si n8n reste inutilisé
suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente
environ 6 jours ou plus. La majeure partie du coût d'exécution ici est généralement la
base de données et la VM de fichier/cache partagée ; elles ne s'arrêtent que si rien
d'autre dans le projet ne les utilise, donc la suppression de cette application alors
que quelque chose d'autre partage le projet n'économise que la partie calcul de cette
application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière
sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant
  15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit
  le formateur finance toutes les places, soit chaque participant paie la sienne. Tout
  est supprimé à la fin de la session et les crédits inutilisés sont reversés au
  formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  mise en pause et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin, le partenaire transfère le projet et les déploiements
  deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
  GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://n8n.io/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

n8n s'exécute comme une charge de travail Node.js. Le déploiement connecte un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — n8n utilise PostgreSQL pour toutes les données de workflow et d'identifiants |
| Fichiers partagés | Filestore (NFS) | Données de fichiers binaires partagées entre toutes les répliques ; sert également de point de terminaison Redis par défaut |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié |
| File d'attente et coordination | Redis | Activé par défaut ; active le mode file d'attente n8n pour la mise à l'échelle horizontale |
| Secrets | Secret Manager | Clé de chiffrement auto-générée et espace réservé au mot de passe SMTP |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ;
  la sélection de tout autre moteur ou `NONE` interrompt le démarrage.
- **Redis est activé par défaut.** Le mode file d'attente permet à plusieurs
  répliques n8n de distribuer l'exécution des workflows. Sans Redis, seule une
  seule réplique peut traiter les workflows de manière fiable.
- **La clé de chiffrement est irremplaçable.** `N8N_ENCRYPTION_KEY` est générée une
  seule fois et stockée dans Secret Manager. Tous les identifiants de workflow
  sont chiffrés avec elle. Si la clé est tournée ou supprimée, tous les
  identifiants enregistrés deviennent définitivement illisibles.
- **L'affinité de session est `ClientIP`.** L'éditeur utilise des WebSockets,
  donc les requêtes d'un navigateur sont épinglées à un pod.
- **`WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont prédéfinis** à l'URL de service
  attendue avant le déploiement afin que les webhooks se résolvent
  correctement dès le premier démarrage.
- Le secret du **mot de passe SMTP** est initialisé avec une valeur factice ;
  mettez-le à jour dans Secret Manager avant de configurer l'envoi d'e-mails.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail n8n {#a-gke-autopilot--the-n8n-workload}

Les pods n8n sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre les nombres minimum et maximum de répliques. L'affinité de
session épingle les sessions de l'éditeur à un seul pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail n8n pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de workflow, l'historique d'exécution et les
identifiants chiffrés dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les
pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** via un socket
Unix, de sorte qu'aucune IP publique n'est exposée. Le script `entrypoint.sh`
traduit les variables `DB_*` injectées par la plateforme en variables
n8n-natives `DB_POSTGRESDB_*` au moment de l'exécution. Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les fichiers binaires téléchargés ou produits par les workflows sont écrits
dans un partage **Filestore (NFS)** monté dans chaque pod afin que toutes les
répliques voient les mêmes données (`N8N_DEFAULT_BINARY_DATA_MODE=filesystem`). L'IP de l'hôte NFS
sert également de point de terminaison Redis par défaut lorsqu'aucun
`redis_host` explicite n'est configuré. Un bucket **Cloud Storage**
dédié est provisionné pour une persistance des données plus large.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage →
  Buckets pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les
options CMEK.

### D. File d'attente Redis {#d-redis-queue}

Redis active le mode file d'attente de n8n, qui distribue les exécutions de
workflow sur plusieurs répliques à l'aide de Bull. En mode file d'attente, une
ou plusieurs instances "worker" récupèrent les exécutions de la file d'attente
tandis que l'instance principale gère l'éditeur et l'enregistrement des
webhooks. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est
activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

La clé de chiffrement n8n et l'espace réservé au mot de passe SMTP sont stockés
en tant que secrets Secret Manager et injectés dans les pods au moment de
l'exécution ; le texte en clair n'apparaît jamais dans la configuration. Le mot
de passe de la base de données est géré séparément par la fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Update the SMTP password with the real credential:
  echo -n "my-real-smtp-password" | \
    gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et
la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application n8n {#3-n8n-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) utilise `postgres:15-alpine` pour créer la
  base de données et l'utilisateur n8n et accorde les privilèges avant le
  démarrage de l'application. Il est idempotent et peut être réexécuté en toute
  sécurité.
- **Traduction des variables d'environnement.** `entrypoint.sh` mappe
  `DB_HOST`, `DB_NAME`, `DB_USER` et `DB_PASSWORD`
  (injectées par la plateforme) aux équivalents n8n-natives `DB_POSTGRESDB_*`
  au démarrage du conteneur. Le chemin du socket Cloud SQL Auth Proxy est
  réécrit en un lien symbolique que les pilotes PostgreSQL peuvent localiser.
- **Fonctionnement en mode file d'attente.** Avec `enable_redis = true` (par
  défaut), n8n démarre en mode file d'attente. Le pod principal gère
  l'enregistrement des webhooks, l'interface utilisateur de l'éditeur et la
  coordination de l'exécution ; des répliques supplémentaires agissent comme
  des workers récupérant les jobs de la file d'attente Bull.
- **Stabilité de l'URL du webhook.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL`
  sont définis sur l'URL de service prédite avant le déploiement. Si l'IP
  externe ou le domaine personnalisé change, ces valeurs doivent être mises à
  jour et la charge de travail redéployée.
- **Stockage des données binaires.** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` indique à n8n
  d'écrire les fichiers binaires (pièces jointes, téléchargements) sur le
  système de fichiers monté NFS plutôt que dans la base de données, ce qui est
  requis pour les déploiements multi-répliques.
- **Chemin de santé.** Les sondes de vivacité/disponibilité ciblent la racine
  n8n (`/`), qui renvoie HTTP 200 uniquement une fois que
  l'application et la connexion à la base de données sont entièrement
  initialisées. La sonde de démarrage autorise 120 secondes pour la
  configuration du premier démarrage.
- **Importance de la clé de chiffrement.** `N8N_ENCRYPTION_KEY` chiffre tous
  les identifiants de workflow stockés dans la base de données. La clé est
  générée une seule fois ; si elle change, tous les identifiants enregistrés
  (clés API, mots de passe, jetons) deviennent définitivement illisibles.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour n8n
sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8n` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `N8N Workflow Automation` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n ; incrémenter pour déployer une nouvelle version. |
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour l'exécution de workflow n8n. |
| `memory_limit` | `4Gi` | Mémoire par pod. |
| `min_instance_count` | `1` | Répliques minimales. Garder ≥ 1 pour que les workflows en file d'attente aient toujours un worker. |
| `max_instance_count` | `3` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `5678` | n8n écoute sur le port 5678. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image n8n dans Artifact Registry avant le déploiement. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Valeurs par défaut de l'espace réservé SMTP | Paramètres supplémentaires non secrets. Les valeurs principales `N8N_*` et `DB_TYPE` sont définies automatiquement. La carte par défaut inclut `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` et `EMAIL_FROM` comme valeurs vides/espaces réservés prêts à être remplacés par de vrais identifiants. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager (~30 jours). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions d'éditeur WebSocket de n8n. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Laisser vide pour la génération automatique. |
| `configure_service_mesh` | `false` | Activer l'injection Istio pour l'espace de noms. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC dans le StatefulSet. La définition de `true` sélectionne automatiquement le type de charge de travail StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /` | Les sondes ciblent la racine n8n. La sonde de démarrage autorise un délai initial de 120 s. |
| `startup_probe_config` / `health_check_config` | _(défini)_ | Objets de sonde structurés transmis à la fondation. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs planifiés. Le planificateur intégré de n8n gère les déclencheurs de workflow ; utilisez-les pour les opérations externes (scripts de maintenance, jobs de données personnalisés). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec n8n. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données de fichiers binaires (garder activé pour les multi-répliques). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM GCE NFS intégrée lorsqu'aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — File d'attente Redis {#group-15--redis-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour l'exécution de workflow en mode file d'attente. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP de l'hôte NFS ; définir explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `n8n_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant n8n. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
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
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre n8n. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnels) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` | _(auto-généré, ne jamais faire pivoter)_ | Critique | La rotation ou la suppression de cette clé détruit définitivement tous les identifiants de workflow enregistrés. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de workflow. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les fichiers binaires ne sont pas partagés entre les répliques et le mode binaire `filesystem` échoue. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue au job d'importation. |
| `enable_redis` | `true` | Élevé | Sans le mode file d'attente Redis, l'exécution de plus d'une réplique entraîne des conflits d'exécution de workflow. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions d'éditeur WebSocket sont interrompues lorsqu'elles sont acheminées vers un pod différent. |
| `min_instance_count` | `1` | Élevé | `0` laisse les workflows en file d'attente sans worker pour les prendre en charge. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des OOM lors de grands lots d'exécution de workflow. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | L'éditeur n8n est autrement accessible publiquement et expose tous les identifiants enregistrés. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

> **Note :** `enable_resource_quota` et les variables `quota_*` (Groupe 8) sont
> déclarées dans `N8N_GKE/variables.tf` pour satisfaire la convention de mise en
> miroir du dépôt, mais ne sont jamais transmises à `App_GKE` dans
> `main.tf`/`n8n.tf` — la description de chaque variable indique
> qu'elle n'a aucun effet sur le déploiement dans ce module. Elles ne
> comportent aucun risque opérationnel ici.

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à n8n
partagée avec la variante Cloud Run est décrite dans
**[N8N_Common](N8N_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : N8N sur GKE Autopilot](../labs/N8N_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [n8n sur Google Cloud Run](N8N_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [N8N Common — Configuration d'application partagée](N8N_Common.md) — la configuration partagée par les deux cibles de déploiement.
