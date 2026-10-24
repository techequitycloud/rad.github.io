---
title: "Ghost sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Ghost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ghost_GKE.md @ e69407af sha256:b58fa1fabcfe -->

# Ghost sur GKE Autopilot {#ghost-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_GKE.png" alt="Ghost sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghost est une plateforme de publication open source moderne qui alimente plus de 2 millions de publications avec des fonctionnalités intégrées d'adhésion, d'abonnements et de newsletters. Ce module déploie Ghost sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Ghost et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de Ghost sur RAD et comparaison {#what-ghost-costs-on-rad-and-how-that-compares}

**L'exécution de Ghost dans votre propre projet Google Cloud coûte environ 149,81 $ US/mois en frais Google Cloud, en plus d'un coût de module RAD unique de 300 crédits** (270 crédits — 10 % de moins — dans un projet géré par RAD). Ghost est une plateforme de publication open source moderne avec plus de 48 000 étoiles GitHub, alimentant plus de 2 millions de publications et utilisée par les principales marques de médias indépendants. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Ghost est également disponible sur Cloud Run — voir le [guide Cloud Run](Ghost_CloudRun.md) pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **300 crédits** (une seule fois) | **270 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~149,81 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~115 crédits/jour (~11,50 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $ US** |

### Comparaison {#how-it-compares}

- Le plan payant le moins cher de **Ghost(Pro)**, Starter, est de 18 $ US/mois (jusqu'à 1 000 membres, une newsletter, un nom de domaine personnalisé gratuit (facturé annuellement)) — vérifié sur [https://ghost.org/pricing/](https://ghost.org/pricing/). Cela réduit la facture Google Cloud de RAD d'environ 149,81 $ US/mois pour la variante GKE, mais cela plafonne l'utilisation ; l'instance de RAD est illimitée, auto-hébergée, et les données ne quittent jamais votre propre projet.
- Le véritable compromis ici est entre le plafond et le contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un simple VPS en termes d'argent — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ghost est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module Ghost seul, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de module de 270 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Ghost et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Ghost se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **300 + ~3–6 crédits** (~30,45 $ US) dans votre propre projet, ou **270 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Ghost reste inutilisé suffisamment longtemps pour compenser le coût de ce redéploiement par rapport à son propre coût d'exécution : environ **7 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 149,81 $ US/mois), ou **environ 3 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~115 crédits/jour).

La majeure partie du coût d'exécution de Ghost est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application du total ci-dessus.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tarification de Ghost(Pro)](https://ghost.org/pricing/) pour les chiffres de Ghost(Pro).

## 1. Vue d'ensemble {#1-overview}

Ghost s'exécute comme une charge de travail web Node.js. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 Gio par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Ghost 6.x ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Contenu et thèmes téléchargés partagés entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket de contenu dédié (`ghost-content`) provisionné automatiquement |
| Cache | Redis | Activé par défaut ; revient à l'adresse IP de l'hôte NFS si aucun hôte Redis n'est spécifié |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, nom de domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Ghost 6.x nécessite MySQL ; PostgreSQL n'est pas pris en charge et ne démarrera pas.
- **`database__client = "mysql"` est injecté automatiquement.** Sans cela, Ghost revient silencieusement à SQLite — le module le gère de sorte que vous n'avez jamais besoin de le définir manuellement.
- **Redis est activé par défaut.** Ghost utilise Redis pour la mise en cache des pages afin de réduire la charge de la base de données et d'améliorer les temps de réponse.
- **L'affinité de session est `ClientIP`.** Le panneau d'administration et le portail d'adhésion de Ghost utilisent des sessions côté serveur ; les requêtes d'un navigateur sont épinglées à un pod.
- **Un bucket GCS `ghost-content` est provisionné automatiquement** par `Ghost_Common` et n'a pas besoin d'être ajouté à `storage_buckets`.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et l'utilisateur MySQL de Ghost.
- **Les sondes de santé ciblent `/`** avec un délai initial de 90 secondes pour permettre à Ghost d'exécuter les migrations de base de données et de compiler les thèmes au premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Ghost {#a-gke-autopilot--the-ghost-workload}

Les pods Ghost sont planifiés sur Autopilot, qui facture le CPU/la mémoire réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Ghost pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Ghost stocke toutes les données d'application (articles, membres, paramètres) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le contenu téléchargé (images, thèmes, fichiers) est écrit dans un partage **Filestore (NFS)** monté dans chaque pod afin que toutes les répliques voient les mêmes fichiers. Un bucket **Cloud Storage** dédié (`ghost-content`) est également provisionné automatiquement pour le contenu ; le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket de contenu.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<content-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache des pages de Ghost. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are set in the Ghost pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager et injecté dans les pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

La charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. `enable_custom_domain` utilise par défaut `true`, provisionnant un Ingress Kubernetes avec un certificat géré par Google pour les noms d'hôte dans `application_domains` ; une adresse IP statique est réservée par défaut (`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ghost {#3-ghost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` se connecte à Cloud SQL via le proxy d'authentification et crée de manière idempotente la base de données Ghost (avec le jeu de caractères `utf8mb4` et la collation `utf8mb4_0900_ai_ci`), crée l'utilisateur de l'application et accorde tous les privilèges. Le job s'exécute à chaque apply et peut être réexécuté en toute sécurité.
- **Démarrage lent au premier lancement.** Ghost exécute des migrations de base de données et compile des thèmes au premier démarrage. La sonde de démarrage autorise un délai initial de 90 secondes (`initial_delay_seconds = 90`, `failure_threshold = 10`) — ne le réduisez pas en dessous de 60 secondes, sinon Ghost sera tué avant d'avoir terminé son initialisation.
- **Détection dynamique d'URL.** Le script de point d'entrée personnalisé interroge le serveur de métadonnées Cloud Run/GKE au démarrage pour découvrir l'URL du service et l'exporter en tant que `url` et `admin__url` pour Ghost. Une variable d'environnement explicite `url` a toujours la priorité.
- **Connexion à la base de données.** Le point d'entrée mappe automatiquement les variables `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD` et `DB_PORT` de la fondation aux paramètres `database__connection__*` de Ghost. Lorsque `DB_HOST` commence par `/`, il est traité comme un chemin de socket Unix.
- **SMTP pour les e-mails.** Ghost nécessite SMTP pour les inscriptions de membres, les réinitialisations de mot de passe et la livraison de newsletters. `environment_variables` pré-remplis (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`) — configurez-les avant d'inviter des membres.
- **Connexion administrateur.** Le panneau d'administration de Ghost se trouve à l'adresse `<url>/ghost`. Au premier démarrage, Ghost crée un utilisateur administrateur de manière interactive.
- **Chemin de santé.** Les sondes de disponibilité/vivacité ciblent `/`, qui renvoie HTTP 200 lorsque Ghost est entièrement initialisé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Ghost sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ghost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Ghost Blog` | Nom convivial affiché dans la console. |
| `application_description` | `Ghost Publishing Platform on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `6.14.0` | Tag de version de l'image Ghost ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum pour Ghost 6.x. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 Gio recommandés (Ghost manque de mémoire en dessous de 1 Gio). |
| `min_instance_count` | `1` | Répliques minimales. Garder ≥ 1 pour éviter les démarrages à froid et les retards de migration. |
| `max_instance_count` | `5` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `2368` | Port HTTP natif de Ghost. Ne pas modifier sauf si votre Dockerfile se lie à un port différent. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build (par défaut) ; `prebuilt` déploie une image existante. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. Requis pour Ghost. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{SMTP_HOST="", SMTP_PORT="587", SMTP_USER="", SMTP_PASSWORD="", SMTP_SSL="false", EMAIL_FROM="ghost@example.com"}` | Paramètres SMTP pré-remplis pour la livraison d'e-mails Ghost. `database__client=mysql` est injecté automatiquement — ne le définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions d'administration et d'adhésion de Ghost. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les PVC par pod pour les déploiements StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Stockage par pod. Provisionner plus pour les publications actives et riches en médias. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 90s de délai initial, 10 échecs | Sonde HTTP sur le chemin racine de Ghost (200 quand prêt). Délai généreux pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/` 60s de délai initial | Sonde de vivacité ciblant le chemin racine de Ghost. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés pour les tâches de maintenance de Ghost. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le contenu Ghost (garder activé pour les répliques multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket supplémentaire de `storage_buckets`. Le bucket `ghost-content` est toujours provisionné automatiquement. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets supplémentaires au-delà du bucket de contenu auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache des pages de Ghost. |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP de l'hôte NFS ; définir explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Ghost nécessite MySQL 8.0 — ne pas modifier. |
| `db_name` | `ghost` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `ghost` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `application_database_name` | `gkeappdb` | Nom de la base de données Cloud SQL (variable App_GKE). Remplacer par `ghost` pour la cohérence. |
| `application_database_user` | `gkeappuser` | Utilisateur Cloud SQL (variable App_GKE). Remplacer par `ghost` pour la cohérence. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. Ghost doit connaître son URL publique au démarrage — assurez-vous que le domaine correspond. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy d'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Ghost. |
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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Ghost. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `ghost-content`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'importation. |
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
| `database_type` | `MYSQL_8_0` | Critique | Ghost nécessite MySQL 8.0 ; tout autre moteur bloque le démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, le contenu téléchargé est perdu au redémarrage du pod et n'est pas partagé entre les répliques. |
| `container_port` | `2368` | Critique | Port natif de Ghost ; une non-concordance entraîne l'échec de toutes les sondes de santé. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `startup_probe` initial_delay_seconds | `90` | Élevé | La réduction en dessous de 60 secondes entraîne la suppression de Ghost par Kubernetes avant qu'il ne termine l'exécution des migrations. |
| `enable_redis` | `true` | Élevé | Sans Redis, Ghost sert toutes les pages sans cache, augmentant la charge de la base de données. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque un manque de mémoire (OOM) de Node.js lors de l'envoi de newsletters ou de la compilation de thèmes. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions d'administration Ghost multi-répliques échouent par intermittence. |
| `environment_variables` Paramètres SMTP | serveur SMTP réel | Élevé | L'absence de livraison d'e-mails signifie l'absence d'inscriptions de membres, de réinitialisations de mot de passe, de newsletters. |
| `container_image_source` | `custom` | Élevé | L'image Ghost en amont ne contient pas le point d'entrée personnalisé qui mappe les identifiants de la base de données et détecte l'URL du service. |
| `min_instance_count` | `1` | Moyen | `0` provoque des démarrages à froid pendant lesquels Ghost exécute des migrations, ce qui entraîne des délais d'attente pour les premières requêtes. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | Le panneau d'administration de Ghost (`/ghost`) est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Ghost partagée avec la variante Cloud Run est décrite dans **[Ghost_Common](Ghost_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Ghost sur GKE Autopilot](../labs/Ghost_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ghost sur Google Cloud Run](Ghost_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ghost Common — Configuration d'application partagée](Ghost_Common.md) — la configuration partagée par les deux cibles de déploiement.
