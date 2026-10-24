---
title: "Vaultwarden sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Vaultwarden sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Vaultwarden_GKE.md @ e69407af sha256:37e18307ff38 -->

# Vaultwarden sur GKE Autopilot {#vaultwarden-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vaultwarden_GKE.png" alt="Vaultwarden sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vaultwarden est un gestionnaire de mots de passe léger, auto-hébergé, compatible Bitwarden,
écrit en Rust. Ce module déploie Vaultwarden sur **GKE Autopilot** en s'appuyant sur la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Vaultwarden et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Vaultwarden sur RAD, et comment cela se compare {#what-vaultwarden-costs-on-rad-and-how-that-compares}

**L'exécution de Vaultwarden sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 75,06 $ US/mois en frais Google Cloud** (environ 148,06 $ US si ce n'est pas votre seul cluster Autopilot), en plus de frais de module RAD uniques de 110 crédits (11 $ US) — plus élevés que les frais du module Cloud Run car cette variante n'a pas de volume NFS partagé (ses données résident sur le pod et la base de données). GKE Autopilot convient à Vaultwarden qui doit fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, consultez plutôt le [guide Cloud Run](Vaultwarden_CloudRun.md). Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Projet propre | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 75,06 $ US/mois, facturé par Google au prix catalogue | ~78 crédits/jour (environ 2340/mois, 234 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un abonnement mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5 vCPU / 0,5 GiB | 18,04 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **75,06 $ US** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Le service hébergé de **Bitwarden**, avec lequel Vaultwarden est compatible, facture par utilisateur : Teams coûte 4 $/utilisateur/mois et Enterprise 6 $/utilisateur/mois (facturé annuellement) — vérifié sur la page de tarification de Bitwarden, le 8 octobre 2026. Le coût d'exécution de RAD dans votre propre projet est d'environ 75 $/mois, quel que soit le nombre d'utilisateurs.
- Une comparaison avec un VPS autogéré, dimensionné pour le petit pod de Vaultwarden de 0,5 vCPU / 0,5 GiB : un Hetzner CPX11 ou un DigitalOcean 1 vCPU/2 Go Droplet coûte environ 6-12 $/mois — plus votre propre temps pour les sauvegardes et les correctifs Postgres, et aucun plan de contrôle Kubernetes à exécuter.
- Comme pour la variante Cloud Run, le coût d'exécution de Vaultwarden dépasse le prix par siège de Bitwarden Teams à environ 19 utilisateurs ; en dessous de ce seuil, l'hébergement de Bitwarden est moins cher en termes de trésorerie, et le cas de RAD est un contrôle total des données.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de
déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il soit parti dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Vaultwarden et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et le retour de Vaultwarden signifie un redéploiement à partir de
zéro. Cela coûte environ 113-116 crédits dans votre propre projet, ou environ
102-105 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Vaultwarden reste inutilisé suffisamment longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — environ 5 jours ou plus dans votre propre projet
(environ 2,50 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(78 crédits par jour).

Priorité aux données : les sauvegardes nocturnes sont stockées dans un bucket au sein du déploiement et sont supprimées avec celui-ci.
Copiez donc la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [tarification Bitwarden](https://bitwarden.com/pricing/).

## 1. Vue d'ensemble {#1-overview}

Vaultwarden s'exécute comme un binaire Rust compilé dans un StatefulSet. Le déploiement connecte
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods binaires Rust, 500m CPU / 512 Mi par défaut, auto-scalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 (par défaut) ou MySQL 8.0 | Moteur configurable ; le job d'initialisation s'ajuste automatiquement |
| Stockage par pod | Kubernetes PersistentVolumeClaim | 10 Gi à `/data` pour les données du coffre, les clés RSA et les pièces jointes |
| Stockage d'objets | Cloud Storage | Un bucket `vaultwarden-attachments` dédié |
| Secrets | Secret Manager | Mot de passe de la base de données ; Vaultwarden gère son propre jeton d'administration en interne |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **StatefulSet avec un PVC de 10 Gi est la valeur par défaut.** Les données du coffre (`/data`) persistent après
  les redémarrages et les mises à niveau des pods. Ne pas passer à un déploiement tant que `stateful_pvc_enabled =
  true`.
- **Les inscriptions sont fermées par défaut.** `signups_allowed = false` empêche
  la création de comptes anonymes. N'activez que lors de la configuration initiale de l'administrateur, puis désactivez.
- **Aucun jeton d'administration n'est généré automatiquement.** Le panneau `/admin` est désactivé, sauf si vous
  fournissez `ADMIN_TOKEN` dans `environment_variables`. C'est la valeur par défaut sécurisée.
- **`domain` doit être défini pour WebAuthn et TOTP.** Sans l'URL publique complète, les codes QR 2FA
  pointent vers `localhost` et les e-mails d'invitation d'organisation contiennent des liens brisés.
- **Les sondes de santé ciblent `/alive`**, le point de terminaison de santé léger dédié de Vaultwarden.
  Vaultwarden démarre rapidement en tant que binaire Rust ; la sonde de démarrage utilise un délai initial de 30 s.
- **L'affinité de session est `ClientIP` par défaut** pour acheminer un client Bitwarden donné
  de manière cohérente vers le même pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Vaultwarden {#a-gke-autopilot--the-vaultwarden-workload}

Les pods Vaultwarden sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Un StatefulSet avec un PersistentVolumeClaim sauvegarde le répertoire `/data`
afin que les données du coffre survivent aux redémarrages et aux mises à niveau des pods. L'autoscaling horizontal des pods
dimensionne la charge de travail entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Vaultwarden pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse
  IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  kubectl describe pvc -n "$NAMESPACE"          # per-pod storage status
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail StatefulSet.

### B. Cloud SQL — PostgreSQL 15 ou MySQL 8.0 {#b-cloud-sql--postgresql-15-or-mysql-80}

Vaultwarden stocke toutes les données du coffre dans une instance Cloud SQL gérée. Le moteur par défaut
est **PostgreSQL 15** ; définissez `database_type = "MYSQL_8_0"` pour utiliser MySQL à la place. Les pods
se connectent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix,
donc aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la
base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. PersistentVolumeClaim et Cloud Storage {#c-persistentvolumeclaim-and-cloud-storage}

Les données du coffre (l'état de secours SQLite de Vaultwarden, les clés de signature RSA, les métadonnées des pièces jointes et la configuration 2FA) sont écrites dans un **PersistentVolumeClaim** par pod
à `/data`. Un bucket **Cloud Storage** dédié (`vaultwarden-attachments`) est également
provisionné pour les fichiers joints ; le compte de service de la charge de travail se voit accorder l'accès
automatiquement.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims ; Cloud Storage →
  Buckets pour le bucket des pièces jointes.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/      # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager et injecté dans les pods au moment de l'exécution. Vaultwarden gère son propre jeton d'administration interne et ses clés de signature RSA dans le volume `/data` — ceux-ci ne sont pas stockés dans Secret Manager.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut
être réservée afin que l'adresse survive aux redéploiements. Cloud Armor est fortement recommandé
pour protéger les points de terminaison de connexion de Vaultwarden contre les attaques par force brute.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud Armor et
les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Un test de disponibilité ciblant `/alive` peut être activé.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Vaultwarden {#3-vaultwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation crée la base de données et l'utilisateur Vaultwarden et accorde les privilèges avant le démarrage de l'application. Il est idempotent et peut être réexécuté en toute sécurité. L'image de job correcte est sélectionnée automatiquement : `postgres:15-alpine` pour PostgreSQL, `mysql:8.0-debian` pour MySQL.
- **Pas de migrations de schéma au démarrage.** Vaultwarden gère automatiquement sa propre évolution de schéma interne. Le job d'initialisation ne fait que créer la base de données et l'utilisateur ; aucune commande de migration n'est nécessaire.
- **Aucune tâche planifiée requise.** Contrairement à de nombreuses applications web, Vaultwarden n'a pas de tâches cron obligatoires. Toutes les opérations de coffre sont pilotées par des requêtes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/alive`, qui renvoie `OK` lorsque le serveur est prêt. Le délai initial est de 30 s, correspondant au démarrage rapide de Vaultwarden en Rust.
- **Panneau d'administration.** Le panneau `/admin` est désactivé, sauf si `ADMIN_TOKEN` est fourni via `environment_variables`. Générez un jeton sécurisé et transmettez-le en tant que variable d'environnement non secrète (ou référencez-le depuis Secret Manager via `secret_environment_variables`).
- **SMTP pour les notifications.** Vaultwarden utilise SMTP pour la vérification de compte, les codes de récupération 2FA et les e-mails d'accès d'urgence. Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME` et `SMTP_PASSWORD` (via `secret_environment_variables`) comme un ensemble complet — une configuration SMTP partielle entraîne des échecs de livraison silencieux.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Vaultwarden sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application et paramètres Vaultwarden {#group-3--application-identity--vaultwarden-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vaultwarden` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Vaultwarden Password Manager` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `1.32.7` | Tag de version de l'image Vaultwarden ; incrémenter pour déployer une nouvelle version. |
| `domain` | `""` | **URL publique complète** (par exemple `https://vault.example.com`). Requise pour WebAuthn, les codes QR TOTP, les invitations d'organisation et les liens de pièces jointes. |
| `signups_allowed` | `false` | Autoriser l'auto-inscription de nouveaux utilisateurs. N'activer que lors de la configuration initiale ; désactiver immédiatement après la création des comptes administrateur. |
| `web_vault_enabled` | `true` | Servir l'interface utilisateur web de Vaultwarden. Désactiver pour un accès API uniquement via des clients natifs. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit à partir du Dockerfile ; `prebuilt` utilise un URI d'image existant. |
| `cpu_limit` | `500m` | CPU par pod. Vaultwarden est un binaire Rust léger. |
| `memory_limit` | `512Mi` | Mémoire par pod. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour éviter l'indisponibilité du coffre au démarrage à froid. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `80` | Port HTTP Rocket de Vaultwarden. Doit correspondre à `ROCKET_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. Obligatoire. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(valeurs par défaut SMTP/log)_ | Paramètres en texte clair. Les variables `ROCKET_PORT`, `SIGNUPS_ALLOWED`, `WEB_VAULT_ENABLED`, `DATA_FOLDER` et éventuellement `DOMAIN` sont injectées automatiquement. La valeur par défaut inclut `LOG_LEVEL=warn`, `SHOW_PASSWORD_HINT=false` et des valeurs de stub SMTP. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple `{ SMTP_PASSWORD = "vaultwarden-smtp-pass" }`). |
| `secret_rotation_period` | `2592000s` | Cadence de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `workload_type` | `StatefulSet` | Utiliser StatefulSet pour le stockage persistant `/data` (par défaut et recommandé). |
| `session_affinity` | `ClientIP` | Acheminer un client donné de manière cohérente vers le même pod. |
| `network_tags` | `["nfsserver"]` | Tags de réseau de nœud/pod pour les règles de pare-feu. |
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour générer automatiquement. |

### Groupe 7 — Stockage persistant StatefulSet {#group-7--statefulset-persistent-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionner un PVC pour le répertoire `/data` de Vaultwarden. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. Augmenter pour les grands coffres avec de nombreuses pièces jointes. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage, correspondant à la variable d'environnement `DATA_FOLDER`. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour le DNS StatefulSet. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID du groupe de fichiers fsGroup défini dans le contexte de sécurité du pod. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les nombres de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/alive`, délai de 30 s, 6 échecs | Chemin de santé dédié de Vaultwarden ; 30 s correspond au démarrage rapide de Rust. |
| `health_check_config` | HTTP `/alive`, délai de 30 s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif ciblant `/alive`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Automatisation de la charge de travail (Jobs et tâches planifiées) {#group-11--workload-automation-jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré (sélectionne automatiquement l'image correcte pour PostgreSQL ou MySQL). |
| `cron_jobs` | `[]` | Vaultwarden n'a pas de tâches planifiées requises ; ajoutez des CronJobs personnalisés ici si nécessaire. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume NFS Filestore facultatif. Non requis pour Vaultwarden à réplica unique (le PVC couvre `/data`). Activer pour un stockage supplémentaire partagé entre les réplicas. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket des pièces jointes. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | `POSTGRES_15` (par défaut) ou `MYSQL_8_0`. L'image du job d'initialisation est sélectionnée automatiquement. |
| `application_database_name` | `vaultwarden` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `vaultwarden` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `30` | Rétention ; la valeur par défaut de 30 jours reflète l'importance de la récupération du coffre. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. Ne prend effet que lorsque `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Noms d'hôte à servir. Définir également `domain` sur l'URL complète `https://`. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements ; recommandé pour la stabilité DNS. |

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google. Remarque : IAP devant Vaultwarden peut empêcher les clients natifs Bitwarden de se connecter. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | **Recommandé pour Vaultwarden.** Attacher une politique WAF Cloud Armor pour protéger le point de terminaison de connexion contre les attaques par force brute. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Vaultwarden. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `signups_allowed` | `false` | Critique | Tout utilisateur d'Internet peut s'auto-enregistrer sur le coffre tant que `true`. Désactiver immédiatement après la création des comptes administrateur. |
| `enable_cloudsql_volume` | `true` | Critique | Vaultwarden se connecte à Cloud SQL via un socket Unix ; la désactivation provoque un CrashLoopBackOff immédiat. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et Vaultwarden voit un coffre vide. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `workload_type` + `stateful_pvc_enabled` | StatefulSet / true | Critique | Définir `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` échoue au moment de la planification. |
| `domain` | URL complète `https://` | Élevé | Sans cela, les codes QR TOTP renvoient à `localhost`, les e-mails d'invitation d'organisation contiennent des liens brisés et les URL des pièces jointes sont invalides. |
| `database_type` | défini une fois | Élevé | La modification après le premier déploiement entraîne la connexion de Vaultwarden à une base de données vide ; toutes les informations d'identification semblent perdues. |
| `container_port` | `80` | Élevé | Doit correspondre à `ROCKET_PORT` ; une non-concordance signifie que la sonde de disponibilité échoue et que le pod ne devient jamais prêt. |
| `min_instance_count` | `1` | Élevé | `0` se met à l'échelle à zéro ; un gestionnaire de mots de passe devient indisponible pendant plusieurs secondes au démarrage à froid — les clients Bitwarden affichent des erreurs de connexion. |
| `stateful_pvc_size` | `10Gi` | Élevé | Trop petit, il se remplit lorsque les utilisateurs stockent des pièces jointes, ce qui provoque des erreurs d'écriture. Augmenter avant de remplir. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les opérations de synchronisation de coffre en cours peuvent être acheminées vers différents pods et rencontrer un état obsolète. |
| `enable_cloud_armor` | activer pour la production | Moyen | Sans Cloud Armor, le point de terminaison de connexion de Vaultwarden est ouvert aux attaques par force brute depuis Internet. |
| `backup_retention_days` | `30` (par défaut, augmenter pour la production) | Moyen | Un gestionnaire de mots de passe sans rétention de sauvegarde adéquate signifie une perte d'informations d'identification en cas de défaillance de la base de données. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `enable_iap` avec des clients natifs | utiliser avec prudence | Moyen | IAP nécessite un OAuth basé sur un navigateur ; les clients natifs Bitwarden ne peuvent pas terminer le flux IAP. |
| `smtp_*` variables d'environnement | configurer comme un ensemble complet | Élevé | Une configuration SMTP partielle entraîne des échecs de livraison d'e-mails silencieux — les codes de récupération 2FA et les e-mails d'invitation ne sont jamais envoyés. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Vaultwarden partagée avec la
variante Cloud Run est décrite dans **[Vaultwarden_Common](Vaultwarden_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Vaultwarden sur GKE Autopilot](../labs/Vaultwarden_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vaultwarden Common — Configuration d'application partagée](Vaultwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
