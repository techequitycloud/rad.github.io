---
title: "Kimai sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Kimai sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kimai_GKE.md @ 1665a43e sha256:66f3b60774e5 -->

# Kimai sur GKE Autopilot {#kimai-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kimai_GKE.png" alt="Kimai sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kimai est une application de suivi du temps gratuite et open source (Symfony/PHP)
utilisée par les freelances et les agences pour le suivi des heures facturables,
les feuilles de temps et les rapports qui alimentent la facturation. Ce module
déploie Kimai sur **GKE Autopilot** sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Kimai utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Kimai sur RAD, et comment cela se compare {#what-kimai-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Kimai sur RAD coûte environ 97 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11,00 $ US).** GKE convient à Kimai qui doit rester disponible pour une grande agence ; pour le coût le plus bas, le [module Cloud Run](Kimai_CloudRun.md) exécute le même Kimai pour environ 70 $ US par mois. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que 97 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **97 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **93 crédits par jour**, environ 2790 par mois (environ 279 $ US au prix de la recharge, 223 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 97 $ US** |

### Comment cela se compare {#how-it-compares}

- **Kimai Cloud** (Standard 3,99 €/utilisateur/mois, 2,99 € annuellement ; Professionnel 4,99 €/utilisateur/mois, 3,99 € annuellement — [kimai.org/en/pricing](https://www.kimai.org/en/pricing)) reste moins cher en espèces pour la plupart des tailles d'équipe que le chiffre GKE ci-dessus, pour la même raison : il évolue avec les utilisateurs, ce n'est pas le cas ici.
- **Le coût de RAD ne croît pas par utilisateur**, et un déploiement GKE reste disponible en continu plutôt que de dépendre de la disponibilité d'un tiers.
- Un Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 $ US/mois) est la comparaison autogérée de taille plus proche, moins la base de données gérée, les sauvegardes et les correctifs inclus par RAD.
- Ou consultez le [guide Cloud Run](Kimai_CloudRun.md) pour l'option à moindre coût.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kimai s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les
30 jours pour presque rien.** Cela convient bien mieux à Kimai dont vous n'avez besoin qu'occasionnellement — un
projet de cours, une démo, une évaluation de courte durée — que de l'exécuter
en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL ou le calcul propre de Kimai un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour Kimai
  derrière un petit Services_GCP et Project_GCP, cela représente **une poignée de crédits
  (moins de 1 $ US)** au total, contre les 115 crédits que coûte un redéploiement
  complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne
  gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après
  cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des
  services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de Kimai
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous
  supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Kimai et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  dedans, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  115 crédits (11,50 $ US), car RAD
  recrée le projet et les services partagés avant Kimai. La suppression permet d'économiser de l'argent
  seulement si Kimai resterait inutilisé pendant environ quatre jours
  ou plus, à la fois dans votre propre projet (environ 3,22 $ US par jour) et dans
  un projet géré par RAD (93 crédits par jour).
- **Supprimez tout ce que Kimai utilise.** La majeure partie du coût d'exécution est généralement la base de données. Elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de Kimai alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Kimai.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Kimai pour une classe. Chaque
  participant dispose de Kimai dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie sa propre place. Tout est supprimé à la fin de la
  session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Kimai pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et l'estimation quotidienne de 93 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle. [Tarification Kimai Cloud](https://www.kimai.org/en/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Kimai s'exécute en tant que pod Symfony/PHP (l'image officielle `kimai/kimai2:apache`,
enveloppée dans un build personnalisé léger) sur GKE Autopilot. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Symfony/PHP, 1 vCPU / 2 Gio par défaut ; réplica unique par défaut (GKE n'a pas de mise à l'échelle à zéro) |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — `Kimai_Common` fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket `storage`, monté GCS-FUSE à `/opt/kimai/var/data` pour les logos/modèles de facture téléchargés et les données de plugin |
| Secrets | Secret Manager | `APP_SECRET` (clé de signature Symfony) et `ADMINPASS` (mot de passe admin) auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe ; domaine personnalisé et IP statique réservée sont pris en charge (voir §4 pour les valeurs par défaut utilisées par le déploiement en direct de ce module) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par
  `Kimai_Common` ; la sélection de tout autre moteur interrompt le déploiement.
- **L'image wrapper personnalisée est requise, pas facultative.** `container_image_source
  = "custom"` construit une image légère `FROM kimai/kimai2` dont le point d'entrée compose
  la chaîne de connexion unique `DATABASE_URL` de Kimai au démarrage du conteneur à partir
  des valeurs secrètes injectées par la Fondation (voir §3).
- **`container_port = 8001`**, pas le port 80 — confirmé via des tests `docker run` locaux
  et un déploiement en direct. C'est le port d'écoute réel de la variante d'image `:apache`.
- **`enable_cloudsql_volume = true`** — c'est le **défaut opposé** de
  `Kimai_CloudRun`. Un sidecar Cloud SQL Auth Proxy est injecté dans le pod
  et écoute sur `127.0.0.1` ; l'alias `DB_IP` du point d'entrée du wrapper se résout
  à cette adresse de bouclage ici, plutôt qu'à l'IP privée brute que
  Cloud Run utilise.
- **Deux secrets Secret Manager, générés une seule fois.** `APP_SECRET` (clé de signature CSRF/session Symfony) et `ADMINPASS` (mot de passe super-administrateur initial) —
  tous deux réinjectés depuis Secret Manager à chaque démarrage de conteneur, donc aucun
  volume persistant n'est nécessaire juste pour les maintenir stables.
- **Pas de mise à l'échelle à zéro.** `min_instance_count = 1`, `max_instance_count = 1` par
  défaut ; GKE Autopilot maintient le nombre de réplicas d'un déploiement à son minimum configuré ou au-dessus.
- **`enable_nfs` par défaut `true` mais est fonctionnellement inutilisé.** Il monte
  Cloud Filestore NFS à `/var/lib/kimai`, mais le chemin de stockage persistant réel
  est le bucket `storage` monté GCS-FUSE à `/opt/kimai/var/data`.
  Rien n'écrit sur le montage NFS. Peut être désactivé en toute sécurité.
- **Pas de job de migration séparé.** `kimai:install` (création de schéma et
  migrations) s'exécute à chaque démarrage de conteneur, de manière idempotente, dans le cadre de la
  chaîne de point d'entrée du fournisseur — seul un job `db-init` est nécessaire pour
  créer la base de données et l'utilisateur au préalable.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kimai {#a-gke-autopilot--the-kimai-workload}

Kimai s'exécute par défaut en tant que déploiement à réplica unique. Autopilot facture le
CPU/mémoire que le pod demande réellement. Un sidecar Cloud SQL Auth Proxy s'exécute
à côté du conteneur principal (`enable_cloudsql_volume = true`).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Kimai pour
  les pods, les événements et les journaux. Kubernetes Engine → Services et Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -c <service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Kimai stocke toutes les données d'application (projets, activités, feuilles de temps, utilisateurs,
factures) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le pod l'atteint
privément via un **sidecar Cloud SQL Auth Proxy** écoutant sur
`127.0.0.1`. Lors du premier déploiement, un job `db-init` crée la base de données
et l'utilisateur de l'application ; `kimai:install` crée ensuite le schéma lors du
premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et
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

### C. Cloud Storage {#c-cloud-storage}

Deux buckets GCS peuvent exister pour ce déploiement : un bucket `storage` provisionné
par `Kimai_Common` et monté GCS-FUSE à `/opt/kimai/var/data` (logos/modèles de facture
téléchargés, données de plugin), et un bucket **séparé**, générique au niveau de la
Fondation (`storage_buckets`, par défaut un bucket nommé
`data`) que Kimai ne lit ni n'écrit à moins que vous ne le connectiez explicitement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`APP_SECRET` (clé de signature CSRF/session Symfony) et `ADMINPASS` (le mot de passe
initial du compte super-administrateur). Le mot de passe de la base de données est géré séparément par
la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kimai"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing ;
un Ingress Kubernetes pour les domaines personnalisés et une IP statique réservée peuvent être
superposés (les deux valeurs par défaut du module sont `true`, bien que le déploiement en direct de ce module ait été exécuté avec les deux définis `false` — voir [Sorties](#5-outputs) et §4).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers
Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kimai {#3-kimai-application-behaviour}

- **Une seule `DATABASE_URL` composée entièrement à l'exécution, non transmise via
  Terraform.** La couche Doctrine DBAL de Kimai lit une seule chaîne de connexion,
  `DATABASE_URL=mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0`,
  pas des variables `DB_*` discrètes. `Kimai_Common` construit une image wrapper personnalisée légère
  `FROM kimai/kimai2` dont le `entrypoint.sh` compose `DATABASE_URL` au
  démarrage du conteneur à partir des variables d'environnement
  `DB_USER`/`DB_NAME`/`DB_PASSWORD`/`DB_IP` injectées par la Fondation — encodant l'URL du
  mot de passe avec `php -r 'echo rawurlencode(...)'` — avant de passer
  sans modification au `docker-php-entrypoint /entrypoint.sh` du fournisseur.
- **`DB_IP` se résout à la boucle de rappel du sidecar Auth Proxy sur GKE.** Le
  wrapper lit l'hôte depuis `$DB_IP` (aliasé via `db_host_env_var_name =
  "DB_IP"`). Sur GKE, avec `enable_cloudsql_volume = true` (par défaut), cela
  se résout à l'adresse `127.0.0.1` du sidecar cloud-sql-proxy — un hôte simple
  sans deux-points, tout comme l'IP privée brute que la variante Cloud Run de
  ce même module utilise. C'est pourquoi le même code de point d'entrée du wrapper fonctionne
  sans modification sur les deux plateformes.
- **Vérifié localement avant de toucher le cloud.** L'étape d'encodage URL du mot de passe
  et la vérification préliminaire de la base de données du fournisseur ont toutes deux été
  confirmées en construisant l'image du wrapper et en l'exécutant localement contre un
  conteneur MySQL réel avec un mot de passe contenant des caractères spéciaux
  (`@:/?`), capturant et corrigeant les problèmes avant la première tentative de déploiement cloud.
- **Comportement de la vérification de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /en/login` (la page de connexion de Kimai), qui renvoie `200` une fois que l'
  application est prête.
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/en/login"   # expect 200
  ```
- **Le bootstrap administrateur s'exécute à chaque démarrage, de manière idempotente.** Le point d'entrée du fournisseur exécute `kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN
  "$ADMINPASS"` à chaque démarrage de conteneur lorsque `ADMINPASS` est défini — une
  opération nulle une fois le compte existant. **Le nom d'utilisateur est toujours `admin`**,
  codé en dur par l'image du fournisseur, quelle que soit la valeur de `admin_email`.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Kimai sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le cluster et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kimai` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Kimai` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Kimai time tracking on GKE` | Description de la charge de travail Kubernetes. |
| `application_version` | `latest` | Tag d'image pilotant le build `kimai/kimai2`. `"latest"` correspond au tag roulant `:apache` maintenu ; toute autre valeur correspond à `"<version>-apache"`. |
| `admin_email` | `admin@example.com` | E-mail du compte super-administrateur, injecté en tant que `ADMINMAIL`. Le nom d'utilisateur du compte est toujours `admin`, codé en dur par le point d'entrée du fournisseur. |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `storage` GCS-FUSE à `/opt/kimai/var/data`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit l'image wrapper composant `DATABASE_URL` via Cloud Build — requis, non facultatif, pour ce module. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | GKE n'a pas de mise à l'échelle à zéro ; réplica unique par défaut. |
| `container_port` | `8001` | La variante d'image `:apache` de Kimai écoute sur le port 8001, confirmé par des tests locaux et un déploiement en direct. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de ressources par pod. |
| `php_memory_limit` | `512M` | PHP `memory_limit` (le point d'entrée du fournisseur lit directement la variable d'environnement `memory_limit` en minuscules). |
| `enable_cloudsql_volume` | `false` | Sidecar Cloud SQL Auth Proxy sur `127.0.0.1`. **Gardez `true` sur GKE** — l'alias `DB_IP` du wrapper en dépend. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe par défaut. |
| `session_affinity` | `ClientIP` | Acheminer les requêtes d'un client vers le même pod. |
| `workload_type` | `null` | Résolution automatique vers `Deployment` (Kimai n'a pas besoin d'identité PVC par pod). |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Il n'y a pas de job de migration séparé — `kimai:install` s'exécute à chaque démarrage de conteneur, de manière idempotente. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | **Inutilisé fonctionnellement** — monté à `/var/lib/kimai`, mais le stockage persistant réel de Kimai est le bucket `storage` monté GCS-FUSE à `/opt/kimai/var/data`. Peut être désactivé en toute sécurité. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique au niveau de la Fondation. Non lu ou écrit par Kimai. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires, fusionnés avec le montage du bucket `storage`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` (se résout en `MYSQL_8_0`) | Fixé par `Kimai_Common`. |
| `application_database_name` / `application_database_user` | `kimai` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `db_host_env_var_name` | `DB_IP` | Aliasse l'hôte de la base de données afin que la composition `DATABASE_URL` du wrapper lise un hôte simple, sans deux-points — se résout à la boucle de rappel du sidecar Auth Proxy sur GKE. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (les quatre) | **Inutilisé par Kimai** — le wrapper lit directement les `DB_USER`/`DB_NAME`/`DB_PASSWORD` standard et code en dur le port `3306`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress Kubernetes avec `application_domains`. Le déploiement vérifié en direct de ce module a défini ceci `false` (voir `config/deploy.tfvars`). |
| `reserve_static_ip` | `true` | Une IP stable qui survit aux redéploiements. Le déploiement vérifié en direct de ce module a également défini ceci `false`. |
| `network_tags` | `["nfsserver"]` | Ciblage du pare-feu ; requis pour la connectivité NFS lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Kimai n'a pas d'intégration Redis intégrée utilisée par ce module — son backend de cache par défaut est le système de fichiers local. |

Toutes les autres entrées (métadonnées du groupe 0, environnement du groupe 2, secrets du groupe 5,
StatefulSet du groupe 7, quota de ressources du groupe 8, fiabilité du groupe 9,
observabilité du groupe 10, CI/CD du groupe 12, sauvegarde du groupe 17, SQL personnalisé du groupe 18,
IAP du groupe 20, Cloud Armor du groupe 21, VPC-SC du groupe 22) se comportent exactement comme documenté dans
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` / `service_external_ip` | IP interne / externe. |
| `service_url` | URL du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | `127.0.0.1` via le sidecar Cloud SQL Auth Proxy. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Nom du job de configuration (`db-init`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources K8s sont déployées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification. Une configuration invalide fait échouer le **plan**
> avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_image_source` | `custom` | **Critique** | Passer à `prebuilt` déploie l'image `kimai/kimai2` standard sans point d'entrée wrapper — `DATABASE_URL` n'est jamais composé, donc le pod ne peut pas du tout atteindre MySQL. |
| `enable_cloudsql_volume` | `true` sur GKE | **Critique** | La définition de `false` supprime le sidecar Auth Proxy dont l'alias `DB_IP` du point d'entrée du wrapper dépend pour atteindre Cloud SQL — le pod ne peut pas se connecter. |
| `container_port` | `8001` | Critique | La variante d'image `:apache` écoute sur le port 8001, pas 80 — pointer la plateforme vers le mauvais port rend le service inaccessible même si le conteneur est sain. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les feuilles de temps, projets et factures. |
| `APP_SECRET` (auto-généré) | Ne jamais modifier manuellement dans Secret Manager après le premier démarrage | Élevé | Kimai l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et les sessions actives. |
| Compte administrateur par défaut (nom d'utilisateur toujours `admin`, mot de passe dans le secret `ADMINPASS`) | Récupérer le mot de passe généré depuis Secret Manager et se connecter rapidement | Élevé | Le mot de passe administrateur est un secret réel, généré par déploiement, et non un défaut public bien connu — mais il est toujours utile de confirmer qui a un accès en lecture au secret. |
| `max_instance_count` | `1` sauf si vérifié autrement | Élevé | La mise à l'échelle au-delà d'un pod sans vérifier le comportement de session de Kimai sous plusieurs pods risque des sessions utilisateur incohérentes entre les pods. |
| `enable_nfs` | `false` sauf si nécessaire à d'autres fins | Faible / coût | Par défaut `true` et provisionne un partage Filestore que Kimai n'utilise jamais — un coût récurrent inutile ; la persistance réelle est le bucket `storage` monté GCS-FUSE. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Kimai partagée avec la variante Cloud Run est décrite dans
**[Kimai_Common](Kimai_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kimai sur GKE Autopilot](../labs/Kimai_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Kimai sur Google Cloud Run](Kimai_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Kimai Common — Configuration d'application partagée](Kimai_Common.md) — la configuration partagée par les deux cibles de déploiement.
