---
title: "Flarum sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Flarum sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Flarum_GKE.md @ e69407af sha256:2b2661a32824 -->

# Flarum sur GKE Autopilot {#flarum-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flarum_GKE.png" alt="Flarum sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flarum est une plateforme de forum et de discussion gratuite et open source — une alternative moderne et extensible aux logiciels de forum traditionnels, construite sur PHP avec un frontal JavaScript/Mithril et une API REST. Ce module déploie Flarum sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Flarum et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Flarum sur RAD, et comparaison {#what-flarum-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot de Flarum sur RAD coûte environ 143 US$ par mois, plus 11 US$ une fois par déploiement et sans licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](Flarum_CloudRun.md) exécute le même Flarum pour environ 84 US$ par mois. Flarum est une plateforme de discussion et de forum communautaire gratuite et open source avec des discussions thématiques, des tags et un système d'extensions. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 143 US$. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **143 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **108 crédits par jour**, soit environ 3 240 par mois (environ 324 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 2 GiB, fonctionnant en permanence | 72 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Serveur de fichiers NFS/cache : une petite VM | 13 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 143 US$** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 US$ par mois.

### Comparaison {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Flarum au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **143 US$**, plus 11 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, Cloud Run | environ 84 US$ ; voir le [guide Cloud Run](Flarum_CloudRun.md) | RAD |

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Flarum est une plateforme de discussion et de forum communautaire gratuite et open source avec des discussions thématiques, des tags et un système d'extensions.** Cela détermine la colonne qui compte : une opération prévisible et sans intervention vaut plus pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Flarum s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne de déploiement typique de 2 à 3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 143 US$.** Déployez Flarum, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et les heures pendant lesquelles il a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, de sorte que Flarum ne se met jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 US$). La suppression permet d'économiser de l'argent si Flarum devait rester inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 4,75 US$ par jour), ou environ 1 jour ou plus dans un projet géré par RAD (108 crédits par jour).
- **Supprimez tout ce que Flarum utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Flarum dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Flarum s'exécute comme une seule charge de travail nginx + php-fpm construite à partir de l'image communautaire `mondedie/flarum`. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | pod nginx/php-fpm sur le port 8888, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les avatars/pièces jointes téléchargés par l'utilisateur persistent sous `/flarum/app/public/assets`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `flarum-assets` est provisionné automatiquement (non monté par défaut — voir ci-dessous) |
| Secrets | Secret Manager | `FLARUM_ADMIN_PASS` auto-généré ; mot de passe de la base de données géré séparément |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Flarum_Common` code en dur `database_type =
  "MYSQL_8_0"` dans sa configuration de sortie ; la variable `database_type` de la variante ne prend effet que si elle est explicitement remplacée par rapport à sa valeur par défaut `null`.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur la boucle locale.** `Flarum_Common` remplace explicitement `DB_HOST = "127.0.0.1"` car l'installateur de l'image mondedie/flarum lit directement `DB_HOST` ; un sidecar cloud-sql-proxy (`enable_cloudsql_volume = true`) écoute sur `127.0.0.1:3306`.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. La charge de travail est basée sur NFS (`enable_nfs = true`), donc selon le comportement partagé de la Fondation, un redéploiement utilise la stratégie de déploiement `Recreate` plutôt que `RollingUpdate` — n'augmentez pas `max_instance_count` sans vérifier le comportement de Flarum avec plusieurs pods concurrents partageant le même volume d'actifs NFS et la même base de données.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/flarum/app/public/assets`) afin que les avatars et les pièces jointes des utilisateurs persistent et soient partagés entre les pods.
- **Un bucket GCS `flarum-assets` est créé mais non monté par défaut.** `Flarum_Common` provisionne un bucket Cloud Storage (sortie `storage_buckets`, suffixe `flarum-assets`), mais aucune entrée `gcs_volumes` par défaut ne le référence — il reste inutilisé à moins que vous n'en ajoutiez une explicitement. NFS, et non GCS Fuse, est ce qui prend réellement en charge le répertoire d'actifs par défaut.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client atteignent le même pod.
- **Auto-installation au premier démarrage (pas de job de migration séparé).** Le point d'entrée s6-overlay de l'image de base exécute l'installateur de Flarum au premier démarrage du conteneur, lisant `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASS`/`DB_PREF`, `FORUM_URL` et les variables `FLARUM_ADMIN_*`. Il n'y a pas de job de migration séparé — le Dockerfile est un wrapper fin et non modifié sur `mondedie/flarum` (seulement `EXPOSE 8888` et une balise de base sélectionnée par build-arg).
- **`FLARUM_ADMIN_PASS` est généré automatiquement** et stocké dans Secret Manager. Le nom d'utilisateur et l'e-mail de l'administrateur sont **fixés par les valeurs par défaut de `Flarum_Common`** (`admin` / `admin@techequity.cloud`) — ils ne sont pas exposés en tant que variables de module d'application sur cette variante, alors récupérez le mot de passe généré avant la première connexion plutôt que de vous attendre à configurer le nom d'utilisateur/e-mail.
- **`FORUM_URL` n'est PAS câblé sur GKE — un manque connu.** `Flarum_Common` ne définit la variable d'environnement `FORUM_URL` que si son entrée `service_url` n'est pas vide, mais le câblage de `Flarum_GKE` ne passe jamais `service_url` dans l'appel du module Common. En conséquence, `FORUM_URL` est absent par défaut sur cette variante et doit être défini manuellement via `environment_variables` une fois que l'IP externe ou le domaine personnalisé est connu — sinon Flarum génère des liens absolus, des URL d'actifs et des redirections de forum incorrects.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Flarum {#a-gke-autopilot--the-flarum-workload}

Le pod de Flarum est planifié sur Autopilot, qui facture le CPU/la mémoire que le pod demande réellement. Comme la charge de travail est basée sur NFS, les mises à jour utilisent la stratégie `Recreate` (une mise à jour progressive exécuterait deux pods simultanément sur le même volume d'actifs NFS et la même base de données partagée).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Flarum pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Flarum stocke toutes les données du forum (discussions, publications, utilisateurs, tags) dans une instance Cloud SQL pour MySQL 8.0 gérée, avec des tables préfixées `flarum_`. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations ; l'installateur Flarum crée ensuite le schéma au premier démarrage du pod.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** (suffixe `flarum-assets`) est provisionné automatiquement et le compte de service de la charge de travail se voit accorder l'accès, mais il n'est pas monté dans le pod par défaut — ajoutez une entrée à `gcs_volumes` si vous souhaitez l'utiliser. Séparément, les avatars et les pièces jointes téléchargés par Flarum résident sur **NFS (Cloud Filestore)** à `/flarum/app/public/assets`, partagés entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~flarum-assets"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret Flarum est généré automatiquement et stocké dans Secret Manager : `FLARUM_ADMIN_PASS` (le mot de passe de l'administrateur de première exécution, ≥8 caractères). Le nom d'utilisateur et l'e-mail de l'administrateur sont fixés à `admin` / `admin@techequity.cloud` et ne sont pas stockés en tant que secrets. Le mot de passe de la base de données est géré séparément par la fondation. Sur GKE, les secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~flarum"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être activé (`enable_custom_domain = true` par défaut, sans domaines configurés tant que vous n'en ajoutez pas un).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Flarum {#3-flarum-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il se connecte à Cloud SQL (préférant le socket Unix sous `/cloudsql` fourni par le sidecar Auth Proxy, interrogeant jusqu'à 30s pour que le socket apparaisse, et revenant à TCP contre `DB_IP`/`DB_HOST` sinon), crée de manière idempotente la base de données de l'application (`CREATE
  DATABASE IF NOT EXISTS`) et l'utilisateur (`CREATE USER IF NOT EXISTS` suivi d'un `ALTER USER ... IDENTIFIED BY` inconditionnel afin que le mot de passe reste toujours synchronisé) et les autorisations (`GRANT ALL PRIVILEGES ON <db>.* TO <user>@'%'`), vérifie que l'utilisateur de l'application peut se connecter, puis arrête gracieusement le sidecar proxy via `/quitquitquit`. Le job peut être réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Auto-installation au premier démarrage (pas de job de migration séparé).** Le point d'entrée s6-overlay de l'image `mondedie/flarum` exécute l'installateur Flarum au premier démarrage du pod, créant le schéma dans la base de données vide. Le Dockerfile personnalisé est un wrapper fin et non modifié sur l'image de base — il ne remplace pas `ENTRYPOINT` et n'ajoute pas d'étape de migration.
- **Compte administrateur.** L'installateur crée un administrateur de première exécution dont le nom d'utilisateur est `admin` et l'e-mail est `admin@techequity.cloud` (valeurs par défaut fixes de `Flarum_Common`, non exposées en tant que variables de module) et dont le mot de passe est le secret généré `FLARUM_ADMIN_PASS`. Récupérez-le avant la première connexion.
- **Câblage des variables d'environnement de la base de données.** Le `main.tf` de `Flarum_GKE` définit `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name =
  "DB_PASS"` et `db_name_env_var_name = "DB_NAME"` sur l'appel de la Fondation — les noms d'environnement exacts attendus par l'installateur mondedie/flarum — de sorte qu'aucun point d'entrée alias n'est nécessaire. `Flarum_Common` définit en outre `DB_PORT = "3306"` et `DB_PREF = "flarum_"` directement dans `environment_variables`, et remplace `DB_HOST = "127.0.0.1"` pour le sidecar Auth Proxy.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour terminent l'ancien pod avant de démarrer le nouveau, évitant ainsi que deux pods ne se bloquent sur le volume d'actifs NFS partagé et les verrous de la base de données.
- **`FORUM_URL` doit être défini manuellement.** Il n'est jamais renseigné par défaut sur GKE (voir le manque de la vue d'ensemble ci-dessus) — définissez-le via `environment_variables` une fois que l'IP du LoadBalancer ou le domaine personnalisé est connu :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"flarum","env":[
      {"name":"FORUM_URL","value":"https://forum.example.com"}]}]}}}}'
  ```
- **Chemins de santé.** Le `startup_probe` spécifique à l'application par défaut est une vérification **TCP** sur le port du conteneur (8888) avec un généreux `failure_threshold = 20` à `period_seconds = 15` (cinq minutes de grâce) pour s'adapter à l'installateur au premier démarrage. Le `liveness_probe` spécifique à l'application par défaut est **HTTP** `GET /` avec un `initial_delay_seconds
  = 300` (cinq minutes) avant la première vérification — encore une fois pour éviter de tuer le pod en cours d'installation.
- **Redis (optionnel).** `enable_redis` par défaut est `false`. Lorsqu'il est activé sans `redis_host` explicite, la validation au moment de la planification nécessite `enable_nfs = true` (le serveur NFS partagé héberge également Redis, et la Fondation injecte son IP comme `REDIS_HOST`) — sinon l'apply échoue avec une erreur claire plutôt que de déployer un forum qui ne peut pas atteindre Redis.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^(DB_|FORUM_URL|FLARUM_ADMIN)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Flarum sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `flarum` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `mondedie/flarum`, mappé via l'ARG de build `FLARUM_VERSION`. `latest` se résout au tag `stable` (recommandé pour la production) de l'image au moment du build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU pour nginx + php-fpm. |
| `memory_limit` | `2Gi` | Minimum 512 Mo imposé par le concept de plancher gen2 sur Cloud Run ; sur GKE, taille pour la charge de travail PHP. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les extensions lourdes ou les grands forums. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; `upload_max_filesize` doit être ≤ `post_max_size` (appliqué au moment de la planification). |
| `min_instance_count` | `1` | Maintenir à 1 pour que le forum reste accessible. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le partage multi-pod NFS/DB est vérifié ; la validation au moment de la planification nécessite `min_instance_count ≤ max_instance_count`. |
| `container_port` | `8888` | mondedie/flarum sert nginx + php-fpm sur 8888. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale) — requis sur GKE tant que `database_type != "NONE"` (appliqué au moment de la planification). |
| `container_image_source` | `custom` | Build léger FROM `mondedie/flarum`, re-tagué via l'ARG de build `FLARUM_VERSION`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Flarum. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type = "TCP", path = "/", initial_delay_seconds = 30, period_seconds = 15, failure_threshold = 20 }` | Sonde de démarrage spécifique à Flarum — vérification du port TCP avec une fenêtre de grâce de cinq minutes pour l'installateur au premier démarrage. |
| `liveness_probe` | `{ type = "HTTP", path = "/", initial_delay_seconds = 300, period_seconds = 60, failure_threshold = 3 }` | Sonde de vivacité spécifique à Flarum — délai initial de cinq minutes pour éviter de tuer le pod en cours d'installation. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les avatars/pièces jointes téléchargés persistent et soient partagés. |
| `nfs_mount_path` | `/flarum/app/public/assets` | Où Flarum stocke les actifs téléchargés par l'utilisateur. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache d'objets optionnel. |
| `redis_host` / `redis_port` | `""` / `6379` | Lorsque `redis_host` est laissé vide, nécessite `enable_nfs = true` (validé au moment de la planification) afin que l'IP Redis partagée injectée par la Fondation puisse être utilisée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | `Flarum_Common` code en dur MySQL 8.0 ; cette variable n'a d'importance que si elle est explicitement remplacée. |
| `application_database_name` | `flarum` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `flarum` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 16 — Cloud Storage {#group-16--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires configurables par l'utilisateur — créés à côté (et non à la place) du bucket `flarum-assets` fourni par Common. |
| `gcs_volumes` | `[]` | Aucun bucket n'est monté dans le pod par défaut ; ajoutez une entrée ici pour utiliser réellement `flarum-assets` ou `data` comme montage de système de fichiers. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `enable_custom_domain` | `true` | Provisionne un Ingress ; `application_domains` est vide par défaut. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Flarum. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Flarum a en outre ses propres préconditions (`min_instance_count ≤ max_instance_count`, `enable_redis` nécessitant `redis_host` ou `enable_nfs`, IAP nécessitant les deux identifiants OAuth, `enable_cloudsql_volume` nécessitant un véritable moteur de base de données, et `upload_max_filesize ≤ post_max_size`). Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | La sélection d'un moteur non-MySQL interrompt l'installateur et toutes les requêtes. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `FORUM_URL` (non prédéfini — à définir manuellement) | URL du LoadBalancer/domaine externe | Élevé | S'il n'est pas défini, Flarum génère des liens absolus, des URL d'actifs et des redirections incorrects ; cette variante ne l'injecte pas automatiquement. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les avatars/pièces jointes téléchargés éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` (avec un vrai `database_type`) | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité de la base de données sur GKE ; l'activer avec `database_type = "NONE"` échoue à la validation au moment de la planification. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans comportement de stockage partagé/verrouillage vérifié risque des sessions divisées et des contentions de verrouillage NFS/DB. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `enable_redis` + `redis_host` | Laisser `redis_host` vide uniquement si `enable_nfs = true` | Élevé | La violation de cette combinaison échoue à la validation au moment de la planification plutôt que de déployer un forum qui ne peut pas atteindre Redis. |
| `memory_limit` | `2Gi` | Élevé | Le sous-dimensionnement de PHP-FPM sous charge risque des arrêts OOM. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `FLARUM_ADMIN_PASS` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous empêche d'accéder au premier compte administrateur jusqu'à la réinitialisation via la base de données. |
| `gcs_volumes` (vide par défaut) | Ajouter une entrée pour utiliser réellement `flarum-assets` | Moyen | Le bucket `flarum-assets` est facturé et créé mais ne fait rien à moins d'être explicitement monté. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS et `FORUM_URL`. |
| `backup_retention_days` | `7` (à augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Flarum partagée avec la variante Cloud Run est décrite dans **[Flarum_Common](Flarum_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Flarum sur GKE Autopilot](../labs/Flarum_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Flarum sur Google Cloud Run](Flarum_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flarum Common — Configuration d'application partagée](Flarum_Common.md) — la configuration partagée par les deux cibles de déploiement.
