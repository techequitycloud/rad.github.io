---
title: "Passbolt sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Passbolt sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Passbolt_CloudRun.md @ e69407af sha256:789d28a7b7cf -->

# Passbolt sur Google Cloud Run {#passbolt-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Passbolt_CloudRun.png" alt="Passbolt sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Passbolt (Community Edition) est un gestionnaire de mots de passe gratuit, open
source et orienté équipe, avec chiffrement basé sur GPG et partage de
informations d'identification par utilisateur/groupe — sous licence AGPL-3.0,
environ 6 000 étoiles GitHub. Il occupe une niche différente de celle du module
`Vaultwarden` de ce catalogue : Vaultwarden est un coffre-fort personnel/compatible
Bitwarden, tandis que Passbolt est construit autour du partage de informations
d'identification chiffrées GPG à l'échelle de l'organisation entre utilisateurs
et groupes. Ce module déploie l'image officielle `passbolt/passbolt` sur **Cloud Run v2**
sur la base [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Passbolt et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la base App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Passbolt sur RAD, et comparaison {#what-passbolt-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, le module Cloud Run de Passbolt sur RAD
coûte environ 84 US$ par mois, sans licence par utilisateur.** L'édition Pro
de Passbolt est une licence auto-hébergée à partir de 4,90 US$/utilisateur/mois
(minimum 10 utilisateurs) en plus de votre propre hébergement ; RAD déploie
l'édition communautaire gratuite, de sorte que les frais de licence ci-dessous
sont pour des fonctionnalités supplémentaires, et non une alternative hébergée.
Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la
fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une
certification, une démo, une activité saisonnière — un projet géré par RAD peut
être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que
ces 84 US$ deviennent quelques dollars par mois. Voir **Mettre en pause
gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 crédits par mois (environ 96 US$ au prix de la recharge, 77 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par toutes les applications du projet, de
sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
publics Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 84 US$** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ;
  la VM coûte environ 10 % de plus.
- **La mise à l'échelle à zéro est la valeur par défaut.** La ligne Cloud Run
  ci-dessus reflète déjà ce coût ; le réglage `min_instance_count = 1` maintient une
  instance chaude et augmente cette ligne, en échange de l'absence de démarrages
  à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut
  une petite VM NFS/cache. La plus petite instance de Filestore est de 1 TiB,
  ce qui coûte environ 164 US$ par mois à elle seule.

### Comparaison {#how-it-compares}

- **Passbolt vend sa propre édition Pro** sous forme de licence auto-hébergée :
  **4,90 US$ par utilisateur et par mois, facturé annuellement, avec un minimum
  de 10 utilisateurs** (passbolt.com/pricing, 8 octobre 2026) — environ 49
  US$/mois pour une équipe de 10 personnes. Il s'agit de frais de licence en
  plus de l'hébergement, ajoutant le SSO, le provisionnement LDAP et la gestion
  des tags à l'édition communautaire gratuite déployée par RAD — ce n'est pas
  une alternative hébergée aux chiffres RAD ci-dessus.
- Un VPS nu exécutant l'édition communautaire gratuite — Hetzner CPX22 ou un
  DigitalOcean 2 vCPU/4 Go Droplet, tous deux à environ 24 US$/mois — est moins
  cher que le chiffre de RAD pour un projet propre, au prix de l'exécution de
  MySQL, des sauvegardes et de la gestion des clés GPG par vous-même. Passbolt
  n'a besoin que de 1 vCPU / 2 GiB, donc un niveau de VPS plus petit/moins cher
  ferait probablement l'affaire.
- Pour un gestionnaire de mots de passe spécifiquement, la personne qui peut
  lire les sauvegardes est aussi importante que le prix : RAD conserve la base
  de données et les secrets dans Cloud SQL et Secret Manager plutôt que sur un
  serveur que vous administrez à la main.
- Si Passbolt doit rester actif sans mise à l'échelle à zéro, ou fonctionner
  à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide
  GKE](Passbolt_GKE.md) — environ 110 US$ par mois dans votre propre projet,
  ou 2 970 crédits (environ 238–297 US$) par mois dans un projet géré par RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Passbolt s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.**
Cela convient bien mieux à une utilisation occasionnelle — préparation à une
certification, environnement de démonstration, activité saisonnière — que
l'exécution continue de Passbolt.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela coûte une poignée de crédits (moins de 1 US$) pour une chaîne
  typique de 2 à 3 déploiements, contre les 80 crédits (8 US$) que coûte un
  redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 84 US$.** Déployez Passbolt, utilisez-le un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec **Update**, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez les frais de module qu'une seule fois, les builds, et le temps pendant
  lequel Passbolt a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  palier (100 crédits pour le palier sandbox, qui convient à la plupart des
  utilisations d'étude et de démonstration). Google indique que la plupart des
  services fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes de Passbolt sont écrites dans un bucket à l'intérieur du projet,
  et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez apporté des modifications à Passbolt que vous souhaitez conserver,
  copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
  avant de supprimer, comme pour le flux de travail de redéploiement
  ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option
ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer
est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 80 crédits (8 US$), car RAD recrée le projet et les services
  partagés avant Passbolt. La suppression ne permet d'économiser de l'argent
  que si Passbolt devait rester inutilisé pendant environ 3 jours ou plus,
  aussi bien dans votre propre projet (environ 2,79 US$ par jour) que dans un
  projet géré par RAD (32 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données
  et la VM de fichier/cache partagée.** Ils ne s'arrêtent que si rien d'autre
  dans le projet ne les utilise, donc la suppression de Passbolt alors que
  quelque chose d'autre partage le projet n'économise que la partie calcul de
  Passbolt.
- **Conserver les données en premier.** Les sauvegardes sont écrites dans un
  bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc
  copiez la dernière sauvegarde avant de la supprimer si vous voulez la
  conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à
  nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  diminue, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix publics Google Cloud de l'API Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle ; [Tarification Passbolt](https://www.passbolt.com/pricing).

---

## 1. Vue d'ensemble {#1-overview}

Passbolt s'exécute comme un seul conteneur Apache/PHP sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Apache/PHP, port `80`, 1 vCPU / 2Gi par défaut, `min_instance_count = 0` (mise à l'échelle à zéro) |
| Base de données | Cloud SQL pour MySQL (`MYSQL_8_0`) | Requis — Passbolt est une application CakePHP MySQL-only ; variables d'environnement `DATASOURCES_DEFAULT_*` discrètes, pas un seul DSN |
| État cryptographique | Deux buckets GCS dédiés (`storage`, `jwt`) | Contiennent la paire de clés GPG du serveur auto-générée par le fournisseur et la paire de clés JWT — **pas** des secrets générés par Terraform |
| Secrets | Secret Manager | Seul le mot de passe de la base de données est généré par la base — Passbolt lui-même ne contribue à aucun secret (la sortie `Passbolt_Common` de `secret_ids` est toujours vide) |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL est obligatoire.** `database_type = "MYSQL_8_0"` est fixé par `Passbolt_Common` ;
  Passbolt est construit sur CakePHP avec un schéma MySQL-only.
- **Pas de secret d'application côté serveur.** Contrairement à WordPress
  (plusieurs sels) ou aux applications de la famille Laravel (`APP_KEY`),
  Passbolt n'a aucune clé de chiffrement générée par Terraform. Son modèle de
  sécurité est entièrement côté client : l'extension de navigateur génère une
  paire de clés GPG et un mot de passe maître localement lors de la
  configuration. La propre paire de clés GPG du serveur (pour chiffrer les
  données *vers* Passbolt) et sa paire de clés JWT (jetons d'authentification
  API) sont toutes deux auto-générées par le point d'entrée du fournisseur lors
  du premier démarrage et persistées sur des volumes GCS dédiés — non créées
  ou renouvelées par Terraform.
- **Deux volumes GCS dédiés, pas un seul, et pas l'intégralité du répertoire
  `/etc/passbolt`.** `storage` se monte étroitement à `/etc/passbolt/gpg` ;
  `jwt` se monte étroitement à `/etc/passbolt/jwt`. Monter un seul
  volume sur l'ensemble de `/etc/passbolt` masquerait les fichiers de
  configuration/PHP intégrés (`app.php`, `bootstrap.php`,
  `routes.php`) qui résident directement dans ce répertoire de l'image — la
  même classe de bug que ce catalogue a précédemment rencontrée avec Cloudreve.
- **`HTTPS = "on"` est toujours injecté.** Le `bootstrap.php` de Passbolt a
  `$trustProxy = false` codé en dur, il n'honore donc pas `X-Forwarded-Proto` par
  défaut — mais il vérifie directement la valeur littérale `env('HTTPS')`.
  Étant donné que Cloud Run termine le TLS en périphérie et transmet le HTTP
  simple au conteneur, cette surcharge statique permet à Passbolt de générer
  correctement les URL `https://` dans les e-mails et les liens absolus.
- **`enable_cloudsql_volume` est par défaut `false` au niveau de la variable de
  ce module** — asymétrique avec `Passbolt_GKE`, où il est par défaut
  `true` (les deux correspondent à la valeur par défaut de
  `Passbolt_Common`, qui est `true`). Définissez-le explicitement sur
  `true` pour les connexions MySQL basées sur socket sur Cloud Run.
- **Pas d'assistant de configuration web lors de la première visite.** Le seul
  moyen d'avoir un compte administrateur est via le job d'initialisation
  `admin-bootstrap`, qui imprime une URL de configuration unique dans Cloud
  Logging pour que l'opérateur l'ouvre dans une extension de navigateur
  compatible Passbolt.
- **Pas de Redis.** `enable_redis = false` par défaut — Passbolt n'a pas
  d'intégration Redis utilisée par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Passbolt {#a-cloud-run--the-passbolt-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL {#b-cloud-sql-for-mysql}

Passbolt stocke toutes les données d'application — utilisateurs, groupes,
dossiers, ressources de mots de passe chiffrées, permissions de partage — dans
une instance MySQL 8.0 gérée de Cloud SQL. La connexion à la base de données
utilise les noms de variables d'environnement discrets de Passbolt
(`DATASOURCES_DEFAULT_HOST`/`_USERNAME`/`_PASSWORD`/`_DATABASE`,
confirmés par le `/passbolt/env.sh` du fournisseur), aliasés à partir des valeurs
standard `DB_*` de la Foundation par le module d'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les
sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — les volumes de paires de clés GPG et JWT {#c-cloud-storage--the-gpg-and-jwt-keypair-volumes}

Deux buckets GCS sont provisionnés par `Passbolt_Common` et montés via GCS Fuse :
`storage` à `/etc/passbolt/gpg`, `jwt` à `/etc/passbolt/jwt`. Ce ne
sont pas des buckets de téléchargement/média génériques — ils contiennent la
paire de clés GPG du serveur auto-générée par le fournisseur et la paire de
clés JWT, toutes deux générées une fois au premier démarrage et réutilisées à
chaque démarrage ultérieur. La perte de l'un ou l'autre bucket invalide toutes
les informations d'identification que Passbolt a chiffrées côté serveur et
chaque session JWT émise.

- **Console :** Cloud Storage → trouvez les deux buckets (les noms incluent les
  suffixes `storage` et `jwt`).
- **CLI :**
  ```bash
  gsutil ls -p "$PROJECT" | grep passbolt
  gsutil ls gs://<storage-bucket-name>/    # expect serverkey.asc, serverkey_private.asc
  ```

### D. Secret Manager {#d-secret-manager}

Passbolt lui-même ne contribue à aucun secret — la seule entrée Secret Manager
liée à ce déploiement est le mot de passe de la base de données, géré par la
Foundation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~passbolt"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur
de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging — y compris la sortie de
l'URL de configuration unique du job d'initialisation `admin-bootstrap`. Les
métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des
tests de disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Passbolt {#3-passbolt-application-behaviour}

- **La chaîne de jobs d'initialisation en 2 étapes, et pourquoi le deuxième job
  est réellement non trivial.** `Passbolt_Common` définit deux jobs Cloud Run
  ordonnés, tous deux avec `execute_on_apply = true` :
  1. **`db-init`** (`mysql:8.0-debian`) — crée le rôle et la base de
     données MySQL (le `db-init.sh` partagé à l'échelle du catalogue,
     compatible `caching_sha2_password`).
  2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`, `depends_on_jobs = ["db-init"]`) —
     enregistre le compte administrateur initial.

     Les jobs Cloud Run invoquent directement le `command`/`args`
     d'un conteneur, contournant entièrement la chaîne `/docker-entrypoint.sh` du
     fournisseur — ainsi, un simple `cake passbolt register_user` sur un conteneur
     fraîchement provisionné échoue avec une erreur interne 500, car la paire
     de clés GPG du serveur (normalement générée pendant la séquence de
     démarrage du point d'entrée du fournisseur) n'existe pas encore, et le
     schéma n'a pas non plus été installé. Le job source plutôt les propres
     fonctions du point d'entrée du fournisseur (`/passbolt/entrypoint.sh`,
     `/passbolt/env.sh`, `/passbolt/deprecated_paths.sh`), génère/importe la paire de
     clés GPG du serveur si elle est manquante, génère un certificat SSL
     auto-signé si manquant, exécute la propre fonction `install()` du
     fournisseur (qui gère également la génération de la paire de clés JWT et
     l'installation/migration du schéma de la base de données), et seulement
     ensuite exécute `cake passbolt register_user -u <admin_email> -f <admin_first_name>
     -l <admin_last_name> -r admin` — **sans** le flag
     `-q`/quiet, de sorte que l'URL de configuration unique est
     imprimée et atterrit dans Cloud Logging. Confirmé par la source
     `/passbolt/entrypoint.sh` du fournisseur. Idempotent : `gpg_gen_key`/`install()`
     ne fait rien une fois que les clés et le schéma existent déjà suite à une
     exécution précédente.

- **Pas d'assistant de configuration lors de la première visite, et un modèle
  de démarrage réellement différent de la plupart des applications de ce
  catalogue.** Passbolt exige que le client (une extension de navigateur)
  génère sa propre paire de clés GPG et son mot de passe maître — il n'y a pas
  de mot de passe côté serveur à initialiser et rien à récupérer de Secret
  Manager. Récupérez plutôt l'URL de configuration unique :
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_job" AND resource.labels.job_name~admin-bootstrap' \
    --project "$PROJECT" --limit 20 --format='value(textPayload)' | grep '/setup/start/'
  ```

- **Point de terminaison de santé.** `GET /healthcheck/status.json` renvoie un
  `200` non authentifié avec `{"header":{"status":"success",...},"body":"OK"}` une fois prêt —
  confirmé par des tests de conteneur locaux et un déploiement en direct. Les
  sondes de démarrage et de vivacité ciblent toutes deux ce chemin par défaut.

- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Passbolt sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `cr`) de tout `Passbolt_GKE` (`gke`) co-déployé pour éviter une collision de noms. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `passbolt` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Passbolt` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag d'image `passbolt/passbolt`. |
| `admin_email` | `admin@example.com` | E-mail du compte administrateur enregistré par `admin-bootstrap`. |
| `admin_first_name` / `admin_last_name` | `Admin` / `User` | Champs de nom pour le compte administrateur initial. |
| `enable_gcs_storage_volume` | `true` | Monte les volumes GCS `storage` (GPG) et `jwt`. Garder activé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle ; Passbolt ne prend en charge que l'image pré-construite. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `2Gi` | Limite de mémoire — PHP 8.x + Apache. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | `1` | Instance unique par défaut. |
| `container_port` | `80` | Passbolt (Apache) écoute ici. |
| `execution_environment` | `gen2` | Environnement d'exécution requis. |
| `enable_cloudsql_volume` | `true` | **Asymétrique avec la valeur par défaut de `Passbolt_GKE` qui est `true`.** Définir `true` pour les connexions MySQL basées sur socket — le `DATASOURCES_DEFAULT_HOST` de Passbolt accepte directement le répertoire du socket. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du conteneur pour le socket Auth Proxy. |
| `container_protocol` | `http1` | `"http1"` ou `"h2c"`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Passbolt dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle d'ingress du trafic. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Contrôle d'egress VPC. |
| `enable_iap` | `false` | Proxy conscient de l'identité (IAP). |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `HTTPS = "on"` et (lorsqu'il est connu) `APP_FULL_BASE_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. Passbolt lui-même n'en contribue aucun. |

### Groupe 11 — Cloud Storage {#group-11--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires à monter, en plus des deux provisions Passbolt automatiquement (`storage`, `jwt`). |
| `enable_nfs` | `true` | Provisionne un volume Filestore. **Non utilisé par le propre modèle de persistance de Passbolt** — les paires de clés GPG/JWT vivent sur des volumes GCS dédiés et tout le reste est dans MySQL. Valeur par défaut générique inoffensive. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur Cloud SQL. Passbolt nécessite MySQL. |
| `db_name` | `passbolt` | Nom de la base de données MySQL. |
| `db_user` | `passbolt` | Utilisateur de l'application MySQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `DATASOURCES_DEFAULT_HOST` / `_USERNAME` / `_DATABASE` / `_PASSWORD` | Définis par `passbolt.tf`, non destinés à l'utilisateur — Passbolt lit les noms de variables d'environnement CakePHP/PDO discrets, pas les noms standard `DB_*` de la Foundation. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour la chaîne de 2 jobs par défaut de `Passbolt_Common` (`db-init` → `admin-bootstrap`). Une liste non vide la remplace entièrement. |
| `cron_jobs` | `[]` | Passbolt n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck/status.json`, délai 20s, 20 tentatives | Point de terminaison d'état non authentifié de Passbolt. |
| `liveness_probe` | HTTP `/healthcheck/status.json`, délai 60s | Même point de terminaison. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Passbolt. Présent pour la compatibilité de la plateforme. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

Intégration standard `App_CloudRun` VPC-SC — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Les buckets GCS `storage` (GPG) et `jwt`. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` | État CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide
> les valeurs et les combinaisons au moment de la planification. Une
> configuration invalide fait échouer la **planification** avec une erreur
> claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Le schéma CakePHP de Passbolt est MySQL-only — tout autre moteur interrompt complètement le démarrage. |
| `enable_gcs_storage_volume` | `true` | Critique | La désactivation entraîne la perte des volumes persistants pour la paire de clés GPG du serveur auto-générée et la paire de clés JWT — chaque information d'identification chiffrée côté serveur par Passbolt, et chaque session JWT émise, devient irrécupérable lors du prochain redémarrage du conteneur. |
| Ordre `initialization_jobs` (`db-init` → `admin-bootstrap`) | Laisser `[]` sauf si vous comprenez parfaitement la dépendance | Critique | La réplication par le job `admin-bootstrap` de la séquence de génération de clés GPG/installation de schéma du fournisseur est essentielle — un job de remplacement naïf qui exécute simplement `cake passbolt register_user` directement échoue avec une erreur interne car la paire de clés GPG du serveur et le schéma n'existent pas encore. |
| `enable_cloudsql_volume` | `true` (note : par défaut `false` sur cette variante) | Moyen | Le `DATASOURCES_DEFAULT_HOST` de Passbolt fonctionne directement sur le socket Unix du proxy d'authentification Cloud SQL ; le laisser à sa valeur par défaut côté Cloud Run de `false` utilise plutôt le TCP direct, ce qui fonctionne toujours mais renonce à la terminaison TLS du socket et ne correspond ni à la valeur par défaut de `Passbolt_Common` ni à la variante GKE. |
| `admin_email` / `admin_first_name` / `admin_last_name` | Définir intentionnellement avant le premier déploiement | Moyen | Ceux-ci initialisent le seul et unique compte administrateur créé par le job `admin-bootstrap` ; il n'y a aucun moyen dans l'application de les modifier après coup, sauf via l'interface utilisateur d'administration de Passbolt une fois connecté. |
| Pas de mot de passe administrateur à perdre | — | — | Contrairement à la plupart des applications de ce catalogue, il n'y a pas de informations d'identification administrateur détenues par Secret Manager à récupérer. Si l'URL de configuration unique est manquée et expire, la solution consiste à supprimer et à réexécuter le job `admin-bootstrap` (il est idempotent pour les étapes GPG/JWT/schéma, mais `register_user` lui-même peut nécessiter une nouvelle invocation pour une nouvelle URL — consultez la documentation CLI de Passbolt pour la réémission d'un lien de configuration). |

---

Pour le comportement de la base référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Passbolt partagée avec la variante GKE est décrite
dans **[Passbolt_Common](Passbolt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Passbolt sur Cloud Run](../labs/Passbolt_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Passbolt sur GKE Autopilot](Passbolt_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Passbolt Common — Configuration d'application partagée](Passbolt_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Odoo sur Cloud Run](Odoo_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) dans la solution **Plateforme ERP intégrée**.
