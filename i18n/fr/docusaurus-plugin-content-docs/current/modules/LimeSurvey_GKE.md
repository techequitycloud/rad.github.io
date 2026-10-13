---
title: "LimeSurvey sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LimeSurvey sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LimeSurvey_GKE.md @ e69407af sha256:a85aae69fb5e -->

# LimeSurvey sur GKE Autopilot {#limesurvey-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LimeSurvey_GKE.png" alt="LimeSurvey sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LimeSurvey est une plateforme de sondage et de questionnaire en ligne gratuite
et open source (PHP/Yii). Elle prend en charge un nombre illimité de sondages
avec des dizaines de types de questions, des branchements conditionnels, des
quotas, des sondages multilingues et des statistiques/exportations riches. Ce
module déploie LimeSurvey sur **GKE Autopilot** en s'appuyant sur la
fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par LimeSurvey et sur la
manière de les explorer et de les exploiter à partir de la console Google
Cloud et de la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de LimeSurvey sur RAD et comparaison {#what-limesurvey-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de LimeSurvey sur RAD coûte environ 110 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11,00 $ US).** GKE convient à LimeSurvey fonctionnant aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](LimeSurvey_CloudRun.md) exécute le même LimeSurvey pour environ 84 $ US par mois. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 110 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2970 par mois (environ 297 $ US au prix de la recharge, 238 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 GiB | 39,68 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 110 $ US** |

### Comparaison {#how-it-compares}

- **LimeSurvey Cloud** (Basic 66 £/mois, Expert 30 £/mois annuellement, Business 64 £/mois annuellement, Corporate personnalisé — [limesurvey.org/pricing](https://www.limesurvey.org/pricing)) est moins cher en espèces pour des volumes de réponses plafonnés ; l'auto-hébergement rentabilise son coût une fois que vous avez besoin de plus de réponses, de plus d'administrateurs, ou d'aucun plafond.
- Un GCE e2-standard-2 (2 vCPU/8 Go, environ 49 $ US/mois) est la comparaison auto-gérée de taille plus proche pour le pod GKE plus son serveur MySQL et de fichiers, moins les sauvegardes gérées et les correctifs inclus par RAD.
- Ou consultez le [guide Cloud Run](LimeSurvey_CloudRun.md) pour l'option à moindre coût.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LimeSurvey fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les
30 jours pour presque rien.** Cela convient bien mieux à LimeSurvey dont vous n'avez besoin
qu'occasionnellement — un projet de cours, une démo, une évaluation de courte durée — que de le
faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL, aucune VM ou le propre calcul de LimeSurvey un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette
  mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Pour LimeSurvey
  derrière un petit Services_GCP et Project_GCP, c'est **une poignée de crédits
  (moins de 1 $ US)** au total, contre les 115 crédits que coûte un
  redéploiement complet.
- **Ce dont cela a besoin.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne
  gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après
  cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google affirme que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de LimeSurvey
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé LimeSurvey et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  dedans, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  115 crédits (11,50 $ US), car RAD
  recrée le projet et les services partagés avant LimeSurvey. La suppression permet d'économiser de l'argent
  seulement si LimeSurvey resterait inutilisé pendant environ quatre jours
  ou plus, à la fois dans votre propre projet (environ 3,67 $ US par jour) et dans
  un projet géré par RAD (99 crédits par jour).
- **Supprimez tout ce que LimeSurvey utilise.** La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de LimeSurvey alors que quelque chose d'autre partage le projet n'économise que la partie de calcul propre à LimeSurvey.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session LimeSurvey pour une classe. Chaque
  participant obtient LimeSurvey dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie sa propre place. Tout est supprimé lorsque la
  session se termine, et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute LimeSurvey pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin de l'engagement, le partenaire transfère le projet,
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog
; frais RAD et estimation quotidienne de 99 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression
logicielle. [Prix de LimeSurvey Cloud](https://www.limesurvey.org/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LimeSurvey fonctionne comme une seule charge de travail web PHP/Apache construite à partir de l'image
`martialblog/limesurvey`. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 8080, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le module Common fixe `database_type = "MYSQL_8_0"` quelle que soit la valeur par défaut `null` de la variable d'application |
| Persistance des fichiers | Cloud Filestore (NFS) | Les téléchargements/exportations/données d'exécution des sondages persistent sous `/var/www/html/upload`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` (par défaut du Groupe 14) plus un bucket `limesurvey-uploads` provisionné par Common ; aucun n'est monté dans le pod par défaut |
| Secrets | Secret Manager | `ADMIN_PASSWORD` auto-généré (super-administrateur LimeSurvey) ; mot de passe de la base de données géré par la fondation |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sortie `LimeSurvey_Common` de `config` code en dur
  `database_type = "MYSQL_8_0"`, remplaçant la valeur par défaut `database_type` du module d'application
  de `null` ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur le loopback.** La variante
  définit `enable_cloudsql_volume = true`, et `limesurvey.tf` fusionne
  `DB_HOST = "127.0.0.1"` dans la configuration de l'application afin que LimeSurvey compose le
  sidecar cloud-sql-proxy plutôt qu'un chemin de socket.
- **InnoDB est forcé.** Le point d'entrée de l'image martialblog définit par défaut le moteur de base de données sur MyISAM, que Cloud SQL pour MySQL 8.0 désactive
  (`disabled_storage_engines=MyISAM`). Sans une surcharge explicite, l'installation de la console `CREATE TABLE ... ENGINE=MyISAM` échoue, et — parce que
  le point d'entrée invoque l'installateur sans sortie verbeuse — l'échec
  est masqué : le pod signale qu'il est sain tandis que chaque page renvoie une erreur 500 avec `table
  settings_global not found`. Le module définit `DB_MYSQL_ENGINE=InnoDB` et
  `DBENGINE=InnoDB` pour éviter cela.
- **Réplica unique par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. LimeSurvey conserve l'état de session PHP ; ne pas mettre à l'échelle
  au-delà de 1 sans vérifier le comportement de stockage/session partagé.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à
  `/var/www/html/upload`) afin que les ressources de sondage téléchargées, les importations et les exportations
  persistent et soient partagées entre les pods.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client atteignent le même
  pod.
- **Installation automatique au premier démarrage (pas de job de migration séparé).** Le point d'entrée
  amont `martialblog/limesurvey` exécute l'installateur console de LimeSurvey /
  `updatedb` au premier démarrage du conteneur une fois que `db-init` a provisionné la
  base de données et l'utilisateur.
- **`ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret
  Manager. Il amorce le compte super-administrateur de première exécution (nom d'utilisateur fixe
  `admin`, `ADMIN_EMAIL = admin@techequity.cloud`) ; le point d'entrée martialblog
  se termine si `ADMIN_PASSWORD` est manquant.
- **`PUBLIC_URL` n'est pas prédéfini sur GKE.** L'appel de module `limesurvey_app` dans
  `limesurvey.tf` ne transmet pas de `service_url`, donc `PUBLIC_URL` n'est
  injecté que lorsque vous le définissez explicitement via `environment_variables` — faites-le
  une fois que l'IP du LoadBalancer externe ou le domaine personnalisé est connu afin que les liens absolus
  se résolvent correctement.
- **`application_version = "latest"` correspond à une balise de base épinglée.** Le
  Dockerfile clé l'image de base sur un argument de build `LIMESURVEY_VERSION` spécifique à l'application
  (pas le générique `APP_VERSION`, que la Fondation injecte dans
  `build_args` et qui autrement écraserait à `"latest"`) ; `"latest"` se résout
  en `6-apache`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LimeSurvey {#a-gke-autopilot--the-limesurvey-workload}

Les pods LimeSurvey sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. La charge de travail s'exécute en tant que déploiement (aucune surcharge `Recreate` forcée par NFS n'est définie pour cette application, alors vérifiez la stratégie effective avant de supposer que les mises à jour progressives sont sûres avec `max_instance_count > 1`).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail LimeSurvey
  pour les pods, les révisions et les événements. Kubernetes Engine → Services et
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

LimeSurvey stocke toutes les données d'enquête (enquêtes, questions, réponses, utilisateurs,
paramètres) dans une instance Cloud SQL pour MySQL 8.0 gérée. Les pods y accèdent via
le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est
exposée. Lors du premier déploiement, le job `db-init` crée la base de données de l'application,
l'utilisateur et les autorisations ; l'installateur console de LimeSurvey crée ensuite le schéma
en utilisant le moteur `InnoDB` forcé.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe se trouvent tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers NFS {#c-cloud-storage--nfs-file-persistence}

Deux buckets Cloud Storage sont provisionnés par défaut (un bucket générique `data`
du Groupe 14 par défaut, et un bucket `limesurvey-uploads` fourni par `LimeSurvey_Common`) ;
aucun n'est monté dans le pod à moins que vous n'ajoutiez une entrée à `gcs_volumes`. L'arborescence
réelle de téléchargement/exportation des sondages se trouve sur **NFS (Cloud Filestore)** à `/var/www/html/upload`,
partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~limesurvey"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret spécifique à LimeSurvey est généré automatiquement et stocké dans
Secret Manager : `ADMIN_PASSWORD` (le mot de passe du super-administrateur de première exécution, 20
caractères, pas de caractères spéciaux). Le mot de passe de la base de données est géré
séparément par la fondation. Sur GKE, les secrets sont projetés dans les pods via le
pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~limesurvey"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-limesurvey-admin-password --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être
activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LimeSurvey {#3-limesurvey-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il préfère un socket Unix Cloud SQL s'il est présent
  sous `/cloudsql`, sinon il revient au TCP via `DB_IP`/`DB_HOST`,
  crée de manière idempotente la base de données de l'application, l'utilisateur et les autorisations, vérifie
  que l'utilisateur de l'application peut se connecter, puis arrête le sidecar proxy via le
  point d'extrémité d'administration `quitquitquit` (en revenant à `SIGKILL`). Le job peut être
  réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de job de migration séparé).** La base de données étant
  provisionnée, le point d'entrée de l'image martialblog génère
  `application/config/config.php` à partir de l'environnement et exécute l'installateur console de LimeSurvey /
  `updatedb` au premier démarrage du pod, créant le schéma dans
  la base de données vide en utilisant le moteur `InnoDB` forcé.
- **Compte administrateur.** L'installateur crée un super-administrateur avec le nom d'utilisateur fixe
  `admin` (`ADMIN_NAME = "Administrator"`,
  `ADMIN_EMAIL = admin@techequity.cloud`) et le secret généré `ADMIN_PASSWORD`.
  Récupérez-le avant la première connexion.
- **Alias de variables d'environnement DB sur loopback.** La variante définit
  `db_user_env_var_name = "DB_USERNAME"`, `db_password_env_var_name =
  "DB_PASSWORD"` et `db_name_env_var_name = "DB_NAME"` afin que les
  valeurs spécifiques au locataire injectées par la Fondation atterrissent sur les noms que
  le point d'entrée martialblog attend ; `limesurvey.tf` remplace `DB_HOST` par
  `127.0.0.1` (le sidecar Auth Proxy).
- **`DB_MYSQL_ENGINE` / `DBENGINE` sont forcés à `InnoDB`.** Cela évite l'échec
  d'installation silencieux décrit dans [Vue d'ensemble](#1-overview) — Cloud SQL pour
  MySQL 8.0 désactive MyISAM, la valeur par défaut de l'image.
- **Définissez `PUBLIC_URL` une fois l'IP connue.** Il n'est pas prédéfini sur GKE — corrigez
  le déploiement ou définissez `environment_variables` sur l'URL externe une fois que
  l'IP du LoadBalancer ou le domaine personnalisé est attribué :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"limesurvey","env":[
      {"name":"PUBLIC_URL","value":"https://survey.example.com"}]}]}}}}'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** sur `/` (délai initial de 30s,
  délai d'expiration de 10s, période de 15s, 20 échecs — généreux pour l'installation au premier démarrage).
  La sonde de vivacité est **HTTP** `GET /` (délai initial de 300s, délai d'expiration de 60s,
  période de 60s, 3 échecs) une fois que LimeSurvey sert les requêtes. Prévoyez plusieurs
  minutes au premier démarrage pour l'installateur.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|ADMIN_|PUBLIC_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour LimeSurvey sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `limesurvey` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise de base `martialblog/limesurvey` ; `latest` se résout en la balise épinglée `6-apache` via l'argument de build `LIMESURVEY_VERSION` spécifique à l'application. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Minimum 1 vCPU. |
| `memory_limit` | `2Gi` | Minimum 512Mi ; 2Gi recommandé pour la production. |
| `min_instance_count` | `1` | Maintenez à 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Maintenez à 1** sauf si le comportement de partage de session est vérifié. |
| `container_port` | `8080` | L'image apache martialblog/limesurvey écoute sur le port 8080 (la variante Cloud Run construit le wrapper léger identique via `LimeSurvey_Common` et utilise également le port 8080 par défaut). |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez pour les grands sondages/exportations. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; maintenez `post_max_size ≥ upload_max_filesize`. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de LimeSurvey. |
| `workload_type` | `null` → `Deployment` | Déploiement. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité {#group-10--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `TCP /`, délai de 30s, 20 échecs | Fenêtre généreuse au premier démarrage pour l'installateur console. |
| `liveness_probe` | `HTTP /`, délai de 300s, 3 échecs | La page d'accueil `/` renvoie 200 une fois que LimeSurvey sert les requêtes. |

### Groupe 13 — Stockage NFS {#group-13--nfs-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les ressources de sondage téléchargées persistent et soient partagées. |
| `nfs_mount_path` | `/var/www/html/upload` | Où LimeSurvey stocke les téléchargements/exportations/données d'exécution. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket par défaut générique du Groupe 14 ; un deuxième bucket `limesurvey-uploads` est ajouté par `LimeSurvey_Common` de `module_storage_buckets`. Aucun n'est monté par défaut. |
| `gcs_volumes` | `[]` | Pas de montage GCS Fuse par défaut — la persistance passe par NFS à la place. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` (forcé par Common) | Seul MySQL 8.0 est pris en charge. |
| `application_database_name` | `limesurvey` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `limesurvey` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Accès et réseau {#group-19--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
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
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre LimeSurvey. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'extrémité de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un
> paramètre sans état, IAP sans identités autorisées, `quota_memory_*`
> donné comme des entiers bruts, un `container_port`/
> `backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0` forcé) | Critique | Seul MySQL 8.0 est pris en charge par le point d'entrée et le schéma. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| Variables d'environnement du moteur de base de données (`DB_MYSQL_ENGINE`/`DBENGINE`) | Laisser comme `InnoDB` (valeur par défaut du module) | Critique | Revenir à la valeur par défaut MyISAM de l'image interrompt la création de tables sur Cloud SQL — le pod semble sain mais chaque page renvoie une erreur 500. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les ressources/exportations de sondages téléchargées éphémères — perdues lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité de la base de données sur GKE. |
| `max_instance_count` | `1` | Élevé | Mettre à l'échelle au-delà de 1 sans un comportement de partage de session vérifié risque de diviser les sessions. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `PUBLIC_URL` (défini après que l'IP est connue) | URL externe du LoadBalancer/domaine | Élevé | Une URL publique manquante ou incorrecte rompt les liens absolus et la résolution des ressources. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512Mi, le pod PHP/Apache manque de mémoire sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous bloque hors du premier compte super-administrateur jusqu'à la réinitialisation via la base de données. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS et `PUBLIC_URL`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la conformité de la rétention. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à LimeSurvey
partagée avec la variante Cloud Run (génération de secrets, le job `db-init`, le stockage de téléchargement NFS et le mappage des variables d'environnement de la base de données) est décrite dans
**[LimeSurvey_Common](LimeSurvey_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LimeSurvey sur GKE Autopilot](../labs/LimeSurvey_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LimeSurvey Common — Configuration d'application partagée](LimeSurvey_Common.md) — la configuration partagée par les deux cibles de déploiement.
