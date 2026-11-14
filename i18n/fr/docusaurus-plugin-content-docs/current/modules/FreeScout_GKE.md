---
title: "FreeScout sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de FreeScout sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FreeScout_GKE.md @ 40c83c3f sha256:7e23cd4ff3d7 -->

# FreeScout sur GKE Autopilot {#freescout-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreeScout_GKE.png" alt="FreeScout sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreeScout est une plateforme **de service d'assistance et de boîte de réception partagée** gratuite et auto-hébergée, basée sur Laravel (PHP). Elle transforme les boîtes de réception e-mail partagées en une file d'attente de tickets collaborative avec conversations, tags, réponses enregistrées, profil client, API REST et système de plugins. Ce module déploie FreeScout sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par FreeScout et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de FreeScout sur RAD et comparaison {#what-freescout-costs-on-rad-and-how-that-compares}

**L'exécution de FreeScout dans votre propre projet Google Cloud coûte environ 110,13 $ US/mois en frais Google Cloud, en plus d'un coût unique de 110 crédits pour le module RAD** (99 crédits — 10 % de moins — dans un projet géré par RAD). FreeScout est un service d'assistance et de boîte de réception partagée gratuit et open source, basé sur Laravel. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*FreeScout est également disponible sur Cloud Run — voir le [guide Cloud Run](FreeScout_CloudRun.md) pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | ~110,13 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~129 crédits/jour (~12,90 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **110,13 $ US** |

### Comparaison {#how-it-compares}

- Il n'existe pas de version officielle hébergée/cloud de FreeScout à comparer, donc la comparaison honnête se fait avec une infrastructure autogérée, et non avec un SaaS concurrent.
- Un VPS nu d'environ 1 vCPU / 2 Gio — un Hetzner CPX22 (2 vCPU/4 Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois) — est généralement moins cher que le prix affiché par RAD ; un VPS d'une ou deux tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher l'OS, faire tourner les sauvegardes de base de données, renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL géré par RAD, Secret Manager et la surveillance le font pour vous, ce qui est le véritable échange, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si FreeScout est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la propre suppression logicielle récupérable de Google pendant 30 jours. Contrairement à la suppression du module FreeScout seul, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google d'annuler la suppression du projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit. Les frais de module de 99 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé FreeScout et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si FreeScout se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) : 110 crédits (11,00 $ US) dans votre propre projet, ou **99 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si FreeScout reste inutilisé suffisamment longtemps pour que le coût de redéploiement soit inférieur à son propre coût d'exécution : environ **4 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 110,13 $ US/mois), ou **environ 2 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~129 crédits/jour).

La majeure partie du coût d'exécution de FreeScout est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application du total ci-dessus.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

FreeScout fonctionne comme une seule charge de travail web PHP (nginx + php-fpm), construite comme une image personnalisée légère `FROM tiredofit/freescout`. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP sur le port 80, 1 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — FreeScout ne prend pas en charge PostgreSQL ou d'autres moteurs |
| Fichiers persistants | Cloud Filestore (NFS) | Activé par défaut ; monté à `/var/lib/freescout` pour les pièces jointes et les données d'exécution |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement (`freescout-uploads`) provisionné automatiquement |
| Cache (facultatif) | Redis | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `APP_KEY` Laravel et `ADMIN_PASS` de première exécution générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée (`MYSQL_8_0`) ; la sélection de tout autre moteur interrompt le démarrage.
- **La `APP_KEY` Laravel est générée automatiquement** et stockée dans Secret Manager. Elle chiffre les données de session et toutes les colonnes de base de données chiffrées (informations d'identification de boîte aux lettres stockées, jetons OAuth). **Ne la faites jamais pivoter après le premier démarrage** — cela invalide de manière permanente toutes les données précédemment chiffrées.
- **Un administrateur de première exécution est automatiquement initialisé.** `ADMIN_EMAIL` (par défaut `admin@techequity.cloud`) avec le secret `ADMIN_PASS` généré crée le premier administrateur au premier démarrage. Changez le mot de passe dans l'interface utilisateur après la première connexion.
- **Cloud SQL est accessible via le sidecar Auth Proxy.** `enable_cloudsql_volume` par défaut à `true` ; la variante GKE définit `DB_HOST = "127.0.0.1"` afin que FreeScout compose le proxy de bouclage sur le port 3306.
- **NFS est activé par défaut** afin que les pièces jointes et les fichiers d'exécution soient partagés entre les pods et survivent à la replanification, montés à `/var/lib/freescout`.
- **L'affinité de session est `ClientIP` par défaut**, ce qui maintient les requêtes d'un client sur le même pod — important pour l'expérience de session/interface utilisateur PHP.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`, `max_instance_count = 1`) pour que le point de terminaison du service d'assistance soit toujours accessible.
- **Les sondes sont TCP, pas HTTP.** FreeScout rejette toute requête dont l'en-tête `Host` ne correspond pas à `APP_URL` avec un 403, et le kubelet sonde avec l'IP du pod comme `Host` — donc aucun chemin de sonde HTTP ne peut passer. Les sondes de démarrage et de vivacité sont toutes deux TCP, et la vérification de santé de la passerelle suit la sonde de vivacité.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail FreeScout {#a-gke-autopilot--the-freescout-workload}

Les pods FreeScout sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. Comme l'application est basée sur NFS, la fondation la déploie avec une stratégie de mise à jour `Recreate` (pas RollingUpdate) afin que deux pods ne se disputent jamais le même volume NFS et la même base de données partagée pendant une mise à jour.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail FreeScout pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

FreeScout stocke toutes les données de l'application (conversations, boîtes aux lettres, utilisateurs, clients, paramètres) dans une instance Cloud SQL gérée pour MySQL 8.0. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** lié à `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations ; l'application exécute ensuite ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~freescout"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) {#c-cloud-filestore-nfs}

Les pièces jointes et les fichiers d'exécution de FreeScout sont persistés sur un volume NFS monté à `/var/lib/freescout` (activé par défaut), partagé entre les pods afin que les téléchargements survivent à la replanification.

- **Console :** Filestore → Instances (une instance gérée par Services_GCP ou intégrée).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour le modèle de découverte NFS partagé et la stratégie `Recreate` utilisée pour les applications basées sur NFS.

### D. Cloud Storage {#d-cloud-storage}

Un bucket de téléchargement **Cloud Storage** dédié (`freescout-uploads`) est provisionné automatiquement ; le compte de service de la charge de travail se voit accorder l'accès. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~freescout"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Redis (cache d'objets facultatif) {#e-redis-optional-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, `REDIS_HOST`/`REDIS_PORT` sont injectés dans le pod en tant que backend de cache d'objets. Lorsque `redis_host` est laissé vide et `enable_nfs` est vrai, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### F. Secret Manager {#f-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : la `APP_KEY` Laravel (chiffre les données de session et les colonnes de base de données chiffrées) et `ADMIN_PASS` (le mot de passe de l'administrateur de première exécution initialisé). Ils sont livrés dans les pods via le pilote CSI Secret Store. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freescout"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du CSI Secret Store.

### G. Réseau et ingress {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les adresses IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des stratégies d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application FreeScout {#3-freescout-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il se connecte via le proxy d'authentification Cloud SQL, crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges et vérifie que l'utilisateur de l'application peut se connecter. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage du conteneur.** Il n'y a pas de job de migration séparé — l'image tiredofit exécute `php artisan migrate --force` à chaque démarrage de conteneur, donc la mise à niveau de `application_version` applique les modifications de schéma au prochain démarrage.
- **L'administrateur de première exécution est initialisé.** Au premier démarrage, l'image crée l'administrateur défini par `ADMIN_EMAIL` / `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` avec le secret `ADMIN_PASS`. Connectez-vous et changez le mot de passe immédiatement.
- **`APP_KEY` est immuable après le premier démarrage.** La clé Laravel est générée une fois et écrite dans Secret Manager. La modifier invalide de manière permanente toutes les données précédemment chiffrées. Ne la faites pivoter que lors d'une fenêtre de maintenance planifiée avec une reconfiguration complète.
- **`APP_URL` doit correspondre à l'hôte du navigateur.** FreeScout construit des liens absolus et son routage `/` à partir de `APP_URL` ; le point d'entrée le définit à partir de `GKE_SERVICE_URL` injecté. Une fois l'IP du LoadBalancer ou le domaine personnalisé connus, définissez `APP_URL`/`SITE_URL` sur cet hôte externe afin que les liens et les redirections se résolvent correctement :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"freescout","env":[
      {"name":"APP_URL","value":"https://freescout.example.com"},
      {"name":"SITE_URL","value":"https://freescout.example.com"}
    ]}]}}}}'
  ```
  Ou définissez `environment_variables` dans la configuration du module avant le déploiement.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Comme FreeScout est basé sur NFS, les mises à jour arrêtent complètement l'ancien pod avant de démarrer le nouveau, évitant ainsi que deux pods ne se disputent le même volume NFS et la même base de données partagée.
- **Chemin de santé.** La sonde de démarrage est TCP sur le port du conteneur (délai de 30 s, 20 échecs) et la sonde de vivacité est également TCP (délai initial de 300 s) — une sonde HTTP serait rejetée par la vérification d'hôte de FreeScout. Attendez plusieurs minutes au premier démarrage pendant que les migrations s'exécutent avant que le pod ne signale qu'il est sain.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour FreeScout sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freescout` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image de base pour le build léger (`latest` épingle à `php8.3-1.17.159`) ; définissez un tag explicite tel que `1.8.170` en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour le traitement de pièces jointes volumineuses. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement de pièces jointes / POST. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenez à 1 pour que le point de terminaison soit toujours accessible. |
| `max_instance_count` | `1` | Maintenez à 1 sauf si le comportement multi-pod est confirmé sûr (basé sur NFS, DB partagée). |
| `container_port` | `80` | FreeScout (nginx/php-fpm) écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour MySQL via bouclage (`DB_HOST = 127.0.0.1`) ; maintenez `true`. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image de base dans Artifact Registry avant le build léger. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple `MAIL_*`, ou un `APP_URL` personnalisé). Les valeurs principales de la base de données et de l'administrateur sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `APP_KEY` et `ADMIN_PASS` sont câblés automatiquement — ne les définissez pas ici. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (effectif : `Deployment`) | `Deployment` (par défaut) ou `StatefulSet`. FreeScout est basé sur NFS, donc un déploiement avec une stratégie `Recreate` est utilisé. |
| `session_affinity` | `ClientIP` | Le routage persistant maintient un client sur un pod pour la session/l'interface utilisateur PHP. |
| `network_tags` | `["nfsserver"]` | `nfsserver` requis lorsque `enable_nfs = true`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30 s de délai, 20 échecs | Fenêtre généreuse pour les migrations au premier démarrage. |
| `liveness_probe` | TCP, 300 s de délai | Gardez TCP : FreeScout répond à une sonde HTTP (Host = IP du pod) avec 403. Pilote également la vérification de santé de la passerelle. |
| `uptime_check_config` | désactivé | Vérification de disponibilité facultative de Cloud Monitoring. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique facultatives. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut — persiste les pièces jointes/fichiers d'exécution entre les pods. |
| `nfs_mount_path` | `/var/lib/freescout` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active un cache d'objets Redis. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (de Common) | MySQL 8.0 fixe ; ne changez pas de moteur. |
| `application_database_name` | `freescout` | Nom de la base de données MySQL (injecté comme `DB_DATABASE`). Immuable après le premier déploiement. |
| `application_database_user` | `freescout` | Utilisateur de la base de données de l'application (injecté comme `DB_USERNAME`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre FreeScout. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à l'application, `quota_memory_*` donné comme des entiers bruts, `stateful_pvc_enabled` avec `workload_type = "Deployment"`, IAP sans identités autorisées. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide de manière permanente toutes les données précédemment chiffrées — les identifiants de boîte aux lettres chiffrés et les jetons OAuth ne peuvent plus être déchiffrés. |
| `database_type` | `MYSQL_8_0` | Critique | FreeScout est uniquement MySQL ; un moteur Postgres/autre interrompt le démarrage. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `APP_URL` / `SITE_URL` | LoadBalancer externe / URL de domaine | Élevé | Un hôte incorrect rompt les liens absolus, le routage `/` et les liens de réinitialisation de mot de passe / d'e-mail. |
| `enable_nfs` | `true` | Élevé | La désactivation entraîne la perte des pièces jointes/fichiers d'exécution partagés et rompt la cohérence des fichiers multi-pods. |
| `enable_cloudsql_volume` | `true` (GKE) | Élevé | Le sidecar Auth Proxy fournit le point de terminaison MySQL `127.0.0.1:3306` ; sa désactivation est bloquée par une protection de validation au moment de la planification. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, la session/l'interface utilisateur PHP peut atterrir sur un pod différent entre les requêtes. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la protection de validation rejette les valeurs invalides. |
| `memory_limit` | `2Gi` | Élevé | Trop faible, tue le processus PHP par manque de mémoire sous charge de pièces jointes. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans gestion confirmée du stockage partagé/des sessions peut entraîner un état incohérent entre les pods. |
| `enable_iap` | uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels d'intégration entrants. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `ADMIN_PASS` (auto-généré) | Modifier dans l'interface utilisateur après la première connexion | Moyen | Le mot de passe généré se trouve dans Secret Manager ; faites-le pivoter dans l'application pour une authentification détenue par un humain. |
| `application_version` | Épingler en production | Moyen | `latest` peut déplacer l'image de base sous vous entre les déploiements. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à FreeScout partagée avec la variante Cloud Run est décrite dans **[FreeScout_Common](FreeScout_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreeScout sur GKE Autopilot](../labs/FreeScout_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreeScout Common — Configuration d'application partagée](FreeScout_Common.md) — la configuration partagée par les deux cibles de déploiement.
