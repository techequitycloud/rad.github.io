---
title: "Nextcloud sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Nextcloud sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Nextcloud_GKE.md @ e69407af sha256:106052aaf9f0 -->

# Nextcloud sur GKE Autopilot {#nextcloud-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Nextcloud_GKE.png" alt="Nextcloud sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Nextcloud est la principale plateforme auto-hébergée de synchronisation de fichiers et de collaboration, utilisée par 400 millions d'utilisateurs dans plus de 100 000 organisations — y compris des gouvernements et des prestataires de soins de santé recherchant une alternative conforme au RGPD à Google Drive et OneDrive. Ce module déploie Nextcloud sur **GKE Autopilot** en s'appuyant sur le module [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Nextcloud et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — veuillez vous référer au [guide du module App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Nextcloud sur RAD et comment cela se compare {#what-nextcloud-costs-on-rad-and-how-that-compares}

**Le module Nextcloud sur GKE Autopilot de RAD coûte environ 150 à 223 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à Nextcloud qui doit rester opérationnel, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Nextcloud_CloudRun.md) exécute le même Nextcloud pour environ 102 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Nextcloud**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **115 crédits par jour**, environ 3 450 par mois (environ 345 $ US au prix de la recharge, 276 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 150 $ US** (environ 223 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Nextcloud lui-même**, la comparaison honnête est donc un serveur auto-géré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Aucune offre SaaS gérée pour ce projet open source exact n'avait de prix publié qui correspondait à un déploiement typique pour une petite équipe, donc aucun chiffre n'est donné ici. La comparaison réaliste pour la plupart des utilisateurs de Nextcloud est un abonnement commercial de stockage cloud par rapport à une copie auto-hébergée que vous contrôlez entièrement, ce qui est l'argument de conformité au RGPD pour lequel le module existe en premier lieu.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui corrigez le système d'exploitation, faites tourner les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent cela pour vous, ce qui est le véritable argument en faveur de RAD par rapport à une machine moins chère — pas le prix affiché.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Nextcloud s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à Nextcloud dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà dissociée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, la VM, le cluster ou la ressource de calcul un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela coûte environ une poignée de crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 150 $ US.** Déployez Nextcloud, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et le temps pendant lequel Nextcloud était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Nextcloud et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305 crédits (30,50 $ US) dans votre propre projet, ou 275 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Nextcloud resterait inutilisé pendant environ 6 jours ou plus dans votre propre projet (environ 4,99 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (115 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Nextcloud alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit Nextcloud dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Nextcloud pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Nextcloud s'exécute comme une charge de travail PHP/Apache. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 2 vCPU / 4 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Nextcloud ne prend pas en charge PostgreSQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoires `config/` et `data/` partagés entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket `nc-data` provisionné par déploiement |
| Cache et verrouillage | Redis | Activé par défaut ; empêche les conflits de verrouillage de fichiers entre les répliques |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré ; secrets de configuration post-installation |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; la sélection de PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est activé par défaut.** Toutes les répliques doivent partager `config.php` et le répertoire de données utilisateur. Sans NFS, chaque redémarrage de pod supprime les fichiers.
- **Redis est activé par défaut.** Sans un cache partagé et un backend de verrouillage, les écritures concurrentes entre les répliques provoquent des erreurs "File is locked".
- **Les limites PHP sont intégrées à l'image du conteneur** au moment de la build. La modification de `php_memory_limit`, `upload_max_filesize` ou `post_max_size` nécessite une nouvelle exécution de Cloud Build.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret Manager ; vous ne le définissez jamais en texte clair.
- **Le premier démarrage est intentionnellement lent.** Nextcloud exécute `occ maintenance:install` de manière synchrone avant le démarrage d'Apache. La sonde de démarrage autorise jusqu'à 10 minutes pour que la première installation se termine.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Nextcloud {#a-gke-autopilot--the-nextcloud-workload}

Les pods Nextcloud sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Nextcloud pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Run an occ command inside a running pod:
  POD=$(kubectl get pods -n "$NAMESPACE" -o name | grep nextcloud | head -1)
  kubectl exec -n "$NAMESPACE" -it "$POD" -- php occ status
  kubectl exec -n "$NAMESPACE" -it "$POD" -- php occ db:add-missing-indices
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Nextcloud stocke toutes les données d'application (métadonnées de fichiers, utilisateurs, partages, calendrier et contacts) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix à `127.0.0.1:3306` afin qu'aucune IP publique ne soit exposée. Lors du premier déploiement, un job d'initialisation crée la base de données de l'application et l'utilisateur avec la collation `utf8mb4`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les données de fichiers utilisateur de Nextcloud sont écrites dans un partage **Filestore (NFS)** monté dans chaque pod. `entrypoint.sh` définit `NEXTCLOUD_DATA_DIR=<nfs_mount_path>/nextcloud-data` (`/mnt/nfs/nextcloud-data` par défaut ; le wrapper passe le même `nfs_mount_path` au point d'entrée que `NFS_MOUNT_PATH`, de sorte que le montage et le répertoire de données ne peuvent pas être en désaccord) afin que toutes les répliques partagent les mêmes fichiers utilisateur. `config.php` n'est **pas** stocké sur NFS — il est reconstruit localement sur chaque pod à partir des secrets Secret Manager (voir §3 "Secrets de configuration post-installation" ci-dessous). Un bucket **Cloud Storage** `nc-data` est également provisionné par déploiement et le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<nc-data-bucket>/
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis et verrouillage de fichiers {#d-redis-cache-and-file-locking}

Redis prend en charge le cache distribué de Nextcloud (`memcache.distributed`) et le verrouillage de fichiers (`filelocking.enabled`). Avec plus d'une réplique, c'est obligatoire — sans cela, les écritures concurrentes produisent des erreurs HTTP 503 "File is locked". Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Nextcloud et quatre secrets de configuration post-installation (ID d'instance, sel de mot de passe, secret d'application et éventuellement le mot de passe d'authentification Redis) sont stockés dans Secret Manager et injectés dans les pods au moment de l'exécution. Les trois secrets de configuration commencent par des valeurs de remplacement `"UNSET"` ; le hook post-installation du conteneur écrit les vraies valeurs après que `occ maintenance:install` soit terminé.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements. Les domaines personnalisés sont également ajoutés automatiquement à la liste `NEXTCLOUD_TRUSTED_DOMAINS` de Nextcloud.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Nextcloud {#3-nextcloud-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation crée la base de données et l'utilisateur Nextcloud avec le jeu de caractères `utf8mb4` et accorde les privilèges avant le démarrage de l'application. Il est idempotent et peut être réexécuté en toute sécurité.
- **`occ maintenance:install` au premier démarrage.** Lors du tout premier démarrage, Nextcloud exécute sa routine d'installation de manière synchrone avant que Apache ne commence à servir. Cela peut prendre plusieurs minutes sur une instance Cloud SQL froide. La sonde de démarrage autorise jusqu'à 10 minutes (délai initial de 60 s + 20 échecs × période de 15 s) pour que cela se termine.
- **Secrets de configuration post-installation.** Une fois `occ maintenance:install` terminé, un hook dans le conteneur écrit les vraies valeurs `instanceid`, `passwordsalt` et `secret` dans Secret Manager. Les démarrages de pods ultérieurs les relisent pour reconstruire `config.php` sans nécessiter NFS.
- **Mise à niveau PHP au démarrage.** `NEXTCLOUD_UPDATE=1` est défini par défaut, de sorte que Nextcloud exécute `occ upgrade` automatiquement à chaque démarrage de conteneur. C'est intentionnel pour les mises à jour de version mineures. Définissez `NEXTCLOUD_UPDATE=0` dans `environment_variables` et gérez les mises à niveau manuellement lors du passage à des versions majeures.
- **Domaines de confiance.** Nextcloud applique une liste blanche de domaines de confiance. Le module initialise `NEXTCLOUD_TRUSTED_DOMAINS` avec le nom DNS interne au cluster et tout `application_domains`. Les requêtes provenant d'hôtes non listés reçoivent une erreur "Accès via un domaine non fiable".
- **Données utilisateur NFS uniquement.** NFS ne prend en charge que le répertoire de données utilisateur partagé (`NEXTCLOUD_DATA_DIR=<nfs_mount_path>/nextcloud-data`). `config.php` n'est pas stocké sur NFS ou partagé via un lien symbolique — chaque réplique le reconstruit localement à partir des valeurs Secret Manager décrites ci-dessus, ce qui permet à toutes les répliques de converger sur la même configuration sans dépendance NFS pour l'état de la configuration.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/status.php`, qui renvoie un HTTP 200 avec un objet de statut JSON quel que soit l'état de configuration de Nextcloud — ce qui en fait le point de terminaison de santé canonique.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est configurable ; le mot de passe est récupéré de Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Nextcloud sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nextcloud` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Nextcloud` | Nom convivial affiché dans la console. |
| `application_description` | `Nextcloud self-hosted collaboration and file sharing platform on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `30` | Tag de version de l'image Nextcloud ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 Gio recommandés. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Objet de ressource structuré ; remplace `cpu_limit`/`memory_limit` lorsqu'il est défini. |
| `min_instance_count` | `1` | Répliques minimales. Garder ≥ 1 pour les clients WebDAV qui maintiennent des connexions persistantes. |
| `max_instance_count` | `5` | Répliques maximales. Nécessite Redis + NFS lorsque > 1. |
| `container_port` | `80` | Nextcloud/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ SMTP_HOST = "", SMTP_PORT = "25", SMTP_USER = "", SMTP_PASSWORD = "", SMTP_SSL = "false", EMAIL_FROM = "ghost@example.com" }` | Paramètres supplémentaires non secrets injectés dans le pod (la valeur par défaut initialise des espaces réservés SMTP vides). Les variables Nextcloud principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Cluster GKE cible. Découvert automatiquement s'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Auto-généré s'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant ; recommandé pour les opérations de fichiers avec état. |
| `network_tags` | `['nfsserver']` | Le tag `nfsserver` est requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `30` | Période de grâce avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC par pod ; sélectionne automatiquement StatefulSet lorsque `true`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour le provisionnement de PVC. |
| `stateful_headless_service` | `null` | Crée un service sans tête pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID défini comme `fsGroup` au niveau du pod pour la propriété du PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones ; recommandé pour `min_instance_count > 1`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=20 }` | Permet jusqu'à ~5 minutes pour le premier démarrage `occ maintenance:install`. |
| `liveness_probe` | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3 }` | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les tâches planifiées récurrentes. |
| `additional_services` | `[]` | Services GKE sidecar ou compagnons supplémentaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour la configuration et les données Nextcloud. **Requis pour les répliques multiples.** |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. Les données utilisateur vont à `<nfs_mount_path>/nextcloud-data`. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom de la VM GCE NFS existante. Découvert automatiquement si vide. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour la VM NFS intégrée si aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets configurés (le bucket `nc-data` provient de `Nextcloud_Common`). |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `nc-data` auto-provisionné. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le cache distribué et le verrouillage de fichiers. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS ; définir explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `application_database_name` | `gkeappdb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeappuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `db_name` | `nextcloud` | Alias de commodité transmis à `Nextcloud_Common` comme `db_name`. |
| `db_user` | `nextcloud` | Alias de commodité transmis à `Nextcloud_Common` comme `db_user`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécute des scripts SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte personnalisés ; également ajoutés à `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Nextcloud. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Nextcloud {#group-23--nextcloud-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nextcloud_admin_user` | `admin` | Nom d'utilisateur de l'administrateur initial. Modifier par rapport à la valeur par défaut pour les déploiements publics. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP — intégrée à l'image du conteneur au moment de la build. Augmenter pour les opérations de fichiers volumineux. |
| `upload_max_filesize` | `512M` | Taille maximale de fichier à télécharger — intégrée à l'image. Augmenter pour les téléchargements de vidéos ou d'archives. |
| `post_max_size` | `512M` | Limite de corps de requête POST PHP — doit être ≥ `upload_max_filesize`. |

### E-mail / SMTP {#email--smtp}

Il n'y a pas de variables SMTP dédiées — l'envoi d'e-mails est configuré via la carte `environment_variables` (Groupe 5), dont la valeur par défaut initialise les espaces réservés `SMTP_HOST` (vide = e-mail désactivé ; les réinitialisations de mot de passe et les notifications de partage ne fonctionneront pas), `SMTP_PORT` (`25`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` (`false`), et `EMAIL_FROM`. Définissez-les avec les valeurs de votre relais de messagerie pour activer l'e-mail.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Nextcloud (ajoute `/login` à l'URL de base). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Nextcloud nécessite MySQL ; d'autres moteurs bloquent le job d'initialisation et le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, tous les fichiers utilisateur et `config.php` sont perdus au redémarrage du pod. |
| `enable_cloudsql_volume` | `true` | Critique | Nextcloud se connecte via un socket Unix ; la suppression du sidecar rompt toutes les connexions à la base de données au démarrage. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `application_domains` | inclure tous les noms d'hôtes d'accès | Critique | Nextcloud bloque les requêtes provenant de domaines non listés avec "Access through untrusted domain". |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_redis` | `true` | Élevé | Avec > 1 réplica, les verrous de fichiers deviennent obsolètes et les écritures concurrentes renvoient HTTP 503. |
| `redis_host` | `""` ou IP explicite | Élevé | Pas de point de terminaison Redis valide lorsque NFS est désactivé et qu'aucun hôte n'est défini. |
| `upload_max_filesize` / `post_max_size` | augmenter pour les fichiers volumineux | Élevé | Intégré à l'image ; les fichiers dépassant la limite échouent silencieusement. `post_max_size` doit être ≥ `upload_max_filesize`. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque un OOM PHP lors de téléchargements volumineux ou de la génération de vignettes. |
| `NEXTCLOUD_UPDATE` | `1` (par défaut) ou `0` | Élevé | Laisser `1` lors d'une mise à niveau de version majeure peut corrompre la base de données. Définir sur `0` et exécuter `occ upgrade` manuellement entre les versions majeures. |
| `min_instance_count` | `1` | Élevé | `0` provoque des déconnexions à froid pour les clients de synchronisation WebDAV. |
| `max_instance_count > 1` | nécessite Redis + NFS | Élevé | Plusieurs réplicas sans Redis provoquent des erreurs de verrouillage de fichiers et une éventuelle corruption des données. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `nextcloud_admin_user` | changer de `admin` | Moyen | Le `admin` par défaut est une cible courante de force brute sur les déploiements publics. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | Sans cela, le panneau d'administration Nextcloud est accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `php_memory_limit` | `512M` (augmenter pour une utilisation intensive) | Moyen | Intégré à l'image ; nécessite une reconstruction pour être modifié. |

---

Pour le comportement de la fondation référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Nextcloud partagée avec la variante Cloud Run
est décrite dans **[Nextcloud_Common](Nextcloud_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Nextcloud sur GKE Autopilot](../labs/Nextcloud_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Nextcloud Common — Configuration d'application partagée](Nextcloud_Common.md) — la configuration partagée par les deux cibles de déploiement.
