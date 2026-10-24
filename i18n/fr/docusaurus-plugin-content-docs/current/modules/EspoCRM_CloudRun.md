---
title: "EspoCRM sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'EspoCRM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/EspoCRM_CloudRun.md @ 1665a43e sha256:26bc0d1a12a6 -->

# EspoCRM sur Google Cloud Run {#espocrm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EspoCRM_CloudRun.png" alt="EspoCRM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

EspoCRM est une plateforme de gestion de la relation client (CRM) open source, sous
licence GPLv3, basée sur PHP et Apache. Ce module déploie EspoCRM sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par EspoCRM et sur la manière de
les explorer et de les exploiter à partir de la console Google Cloud et de la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte EspoCRM sur RAD, et comparaison {#what-espocrm-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module Cloud Run d'EspoCRM sur RAD
coûte environ 84 $ US par mois, plus 7,50 $ US une fois par déploiement et aucune
licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail
qui doivent rester actives en permanence ou s'exécuter à côté d'autres applications
Kubernetes ; voir le [guide GKE](EspoCRM_GKE.md), environ 110 $ US par mois. EspoCRM
est un CRM gratuit et open source qui gère les comptes, les contacts, les prospects, les
opportunités et les cas. Les chiffres sont valables au 8 octobre 2026 ; les sources sont
listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et
restauré dans les 30 jours pour quelques crédits au lieu de rester en cours
d'exécution — un déploiement occasionnel coûte donc quelques dollars par mois, et non
84 $ US. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans
un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont
partagés par toutes les applications du projet, de sorte qu'une deuxième application
n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue
Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 2 Gio, mise à l'échelle à zéro | 13 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache : une petite VM | 13 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les modules complémentaires et les sauvegardes | 1 $ US |
| **Total** | **environ 84 $ US** |

### Comparaison {#how-it-compares}

EspoCRM propose son propre plan hébergé officiel, **EspoCRM Cloud** : les plans
hébergés officiels d'EspoCRM sont de 11 £/utilisateur/mois (Basic, minimum 3
utilisateurs), 19 £/utilisateur/mois (Enterprise, minimum 5 utilisateurs) et 49
£/utilisateur/mois (Ultimate, minimum 10 utilisateurs) — lu le 8 octobre 2026.

| Option | Par mois | Qui l'exécute |
|---|---|---|
| EspoCRM Cloud, Basic (3 utilisateurs min.) | 33 £/mois (3 × 11 £) | EspoCRM |
| EspoCRM Cloud, Enterprise (5 utilisateurs min.) | 95 £/mois (5 × 19 £) | EspoCRM |
| **RAD, Cloud Run, votre propre projet** | **84 $ US**, plus 7,50 $ US une fois | Automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **environ 960 crédits (96 $ US)** | RAD |
| RAD, GKE Autopilot | environ 110 $ US ; voir le [guide GKE Autopilot](EspoCRM_GKE.md) | RAD |

Le prix d'EspoCRM Cloud a été lu sur sa propre page de tarification le 8 octobre 2026 et
peut avoir changé depuis — vérifiez la source avant de vous fier au chiffre.

- **EspoCRM Cloud est la comparaison fixe ; un serveur autogéré est la comparaison
  flexible.** Sur votre propre machine Hetzner ou DigitalOcean (2 vCPU/4 Go, environ 24
  $ US/mois) ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 $ US/mois),
  vous paieriez moins en espèces que l'une ou l'autre option, mais vous géreriez
  vous-même le système d'exploitation, la base de données, les sauvegardes, les correctifs
  de sécurité et les mises à niveau — exactement ce que les services Cloud SQL, Secret
  Manager et de surveillance gérés par RAD font pour vous.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.**
  Sur RAD, les sauvegardes, la récupération ponctuelle, la rotation des mots de passe via
  Secret Manager, ainsi que la journalisation et la surveillance proviennent de Google
  Cloud par défaut. Sur votre propre serveur, ou sur un plan hébergé à prix fixe sans
  contrôle de l'infrastructure, chacun de ces éléments est un travail que quelqu'un doit
  encore faire ou une limite que vous ne pouvez pas modifier.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si EspoCRM s'exécute dans **un projet géré par RAD pour vous**, vous avez une option
au-delà de la mise à l'échelle : **supprimer l'ensemble du projet et le restaurer dans
les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous
n'avez besoin qu'occasionnellement — pour préparer une certification, une démo, un
besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas
  immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation
  est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la
  suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM ou Cloud Run un par
  un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  récupérer le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise
  à jour ne facture plus jamais les frais de module. Cela coûte une poignée de crédits
  de temps de build au total (moins de 1 $ US) pour une chaîne de 2 à 3 déploiements
  typique.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 84 $
  US.** Déployez EspoCRM, utilisez-le pour une session, supprimez le projet. Restaurez-le
  la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le
  à nouveau lorsque vous avez terminé. Vous ne payez qu'une seule fois les frais de
  module, les builds et les heures pendant lesquelles il a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même
  dans les 30 jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés doit
  toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart
  des utilisations d'étude/démo conviennent). Google indique que la plupart des services
  sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression
  douce de Cloud Storage explicitement désactivée, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous
  souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
  extérieur au projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes, de sorte que la majeure
partie de son propre coût de calcul s'arrête d'elle-même lorsque personne ne l'utilise.
L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 80 crédits (8 $ US). La suppression permet d'économiser de l'argent si EspoCRM
  restait inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 2,79
  $ US par jour), ou environ 3 jours ou plus dans un projet géré par RAD (32 crédits par
  jour).
- **Supprimez tout ce qu'EspoCRM utilise.** La majeure partie du coût d'exécution est
  généralement la base de données et toute VM de fichier/cache partagée. Elles ne
  s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de
  cette application pendant que quelque chose d'autre partage le projet n'économise que la
  partie de calcul propre à cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
  sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous
  saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant dispose d'EspoCRM dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais propres à RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le
mécanisme de pause/restauration ; [Tarification EspoCRM
Cloud](https://www.espocrm.com/pricing/). Les prix changent ; vérifiez chaque source
avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

EspoCRM s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache/PHP, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — EspoCRM ne prend pas en charge PostgreSQL ; connecté via TCP IP privée |
| Stockage d'objets | Cloud Storage + Filestore (NFS) | Un bucket GCS dédié `gcs-espocrm<tenant-prefix>-espocrm-data` est provisionné mais **non monté** par défaut ; un volume NFS partagé est monté à `/var/www/html/data` pour les téléchargements (`enable_nfs = true` par défaut) |
| Cache | Redis (facultatif) | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `ESPOCRM_ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (`database_type = "MYSQL_8_0"`) ; EspoCRM ne prend pas en charge PostgreSQL.
- **La base de données est accessible via TCP IP privée, et non via un socket.** `enable_cloudsql_volume`
  par défaut à `false` sur Cloud Run. La connexion PDO MySQL d'EspoCRM nécessite un
  véritable hôte TCP, donc `cloud-entrypoint.sh` compose l'IP privée Cloud SQL (`DB_IP`). Cloud
  SQL MySQL ne force pas SSL sur TCP IP privée, donc aucun câblage TLS supplémentaire
  n'est requis.
- **Le compte administrateur est amorcé automatiquement.** L'installateur en amont crée
  l'utilisateur `admin` avec le `ESPOCRM_ADMIN_PASSWORD` auto-généré au premier démarrage —
  récupérez-le de Secret Manager pour vous connecter.
- **Le schéma est créé au premier démarrage, et non par un job de migration.** `db-init`
  crée la base de données et l'utilisateur ; le `docker-entrypoint.sh` en amont exécute ensuite
  automatiquement l'action d'installation/migration lorsque le conteneur démarre.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max_instance_count = 1`). Les
  démarrages à froid ajoutent plusieurs secondes de latence à la première requête après
  l'inactivité. Définissez `min_instance_count = 1` pour éviter les démarrages à froid.
- **NFS est activé par défaut.** `enable_nfs = true` monte un volume Filestore partagé à
  `/var/www/html/data`, de sorte que les pièces jointes téléchargées et les données d'exécution
  d'EspoCRM persistent après les redémarrages du conteneur et sont partagées entre les
  instances — contrairement à un déploiement Cloud Run nu avec seulement un disque
  éphémère. Le bucket GCS `gcs-espocrm<tenant-prefix>-espocrm-data` auto-provisionné n'est **pas** monté par défaut.
- **Instance unique par défaut.** `max_instance_count = 1` — Cloud Run n'a pas d'affinité de session
  intégrée, donc maintenez le service en instance unique à moins que vous n'ayez vérifié
  le comportement d'EspoCRM sous des sessions PHP concurrentes sur plusieurs réplicas.
- **`ESPOCRM_SITE_URL` est dérivé de l'URL de service prédite** au moment de la planification et
  résolu par le point d'entrée, de sorte que les liens absolus et les vérifications de
  l'installateur d'EspoCRM utilisent l'hôte Cloud Run réel plutôt que `localhost`.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que l'interface utilisateur du CRM soit
  accessible ; l'activation d'IAP place la connexion Google devant elle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service EspoCRM {#a-cloud-run--the-espocrm-service}

EspoCRM s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge des requêtes entre les nombres minimum et maximum d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

EspoCRM stocke toutes les données d'application (contacts, prospects, opportunités,
activités, utilisateurs) dans une instance gérée de Cloud SQL pour MySQL 8.0. Parce que
`enable_cloudsql_volume` est par défaut `false`, le service se connecte via l'**IP privée**
(`DB_IP`) via la sortie VPC sur le port `3306` ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket **Cloud Storage** dédié (`gcs-espocrm<tenant-prefix>-espocrm-data`) est provisionné automatiquement, mais
il n'est **pas monté** par défaut (`gcs_volumes` est par défaut `[]`). Le
stockage persistant réel pour les pièces jointes téléchargées et les données d'exécution
d'EspoCRM est un volume **NFS (Filestore)** partagé, monté à `/var/www/html/data` car
`enable_nfs = true` par défaut. Des buckets GCS supplémentaires peuvent être déclarés via
`storage_buckets`, et montés via `gcs_volumes` (nécessite l'environnement d'exécution gen2) si
vous souhaitez utiliser le bucket.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini, `REDIS_HOST` et
`REDIS_PORT` sont injectés et EspoCRM utilise Redis comme backend de cache d'objets
pour réduire la charge de la base de données. Lorsque `redis_host` est laissé vide et
`enable_nfs` est vrai, l'IP de la VM du serveur NFS est utilisée comme point de terminaison
Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de première exécution (`ESPOCRM_ADMIN_PASSWORD`) est généré
automatiquement et stocké dans Secret Manager, puis injecté dans le service en tant que
variable d'environnement secrète. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité. EspoCRM
se connecte à Cloud SQL via le VPC, de sorte que la sortie VPC doit atteindre l'IP
privée.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

Le `cloud-entrypoint.sh` affiche les valeurs résolues `ESPOCRM_DATABASE_*` et `ESPOCRM_SITE_URL` au
démarrage — un moyen rapide de confirmer l'hôte de la base de données et l'URL du site
utilisés par le conteneur.

---

## 3. Comportement de l'application EspoCRM {#3-espocrm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il résout la connexion
  Cloud SQL (socket Auth Proxy si présent, sinon TCP IP privée), crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde les
  privilèges et vérifie que l'utilisateur de l'application peut se connecter (réchauffant
  le cache d'authentification MySQL 8 `caching_sha2_password`). Le job s'exécute à l'apply et peut
  être réexécuté en toute sécurité.
- **Schéma créé au premier démarrage.** Il n'y a pas de job de migration séparé. Une
  fois que `db-init` a provisionné la base de données, le `docker-entrypoint.sh` EspoCRM en
  amont exécute automatiquement l'action d'installation/migration au démarrage du
  conteneur, créant le schéma et l'utilisateur `admin`.
- **La connexion administrateur est auto-générée.** Le mot de passe de l'utilisateur
  `admin` provient du secret `ESPOCRM_ADMIN_PASSWORD`. Récupérez-le avant votre première
  connexion :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Modifiez-le dans l'interface utilisateur d'EspoCRM (Administration → Utilisateurs) une
  fois connecté.
- **L'URL du site doit correspondre à l'hôte accessible.** EspoCRM construit des liens
  absolus à partir de `ESPOCRM_SITE_URL` ; le point d'entrée le définit à partir de l'URL
  `run.app` prédite (ou `CLOUDRUN_SERVICE_URL` au moment de l'exécution). Si vous placez le
  service derrière un domaine personnalisé, définissez l'URL du site sur cet hôte afin
  que les liens et les redirections OAuth soient corrects.
- **Chemin de santé.** Le démarrage utilise une sonde TCP sur le port `80` ; la
  sonde de vivacité est `HTTP GET /` — EspoCRM sert sa page de connexion sans
  authentification (`200`). Prévoyez plusieurs minutes au premier démarrage pour
  l'étape d'installation/migration (la sonde de vivacité par défaut a un délai initial de
  300 secondes).
- **Les téléchargements persistent sur NFS.** Avec `enable_nfs = true` (par défaut), les
  pièces jointes et les données d'exécution d'EspoCRM résident sous le montage Filestore
  partagé `/var/www/html/data`, survivant aux redémarrages du conteneur et partagées entre les
  instances. Le bucket GCS `gcs-espocrm<tenant-prefix>-espocrm-data` est provisionné mais non monté par défaut.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour EspoCRM sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `espocrm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `EspoCRM` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image pour `espocrm/espocrm` ; `latest` est épinglé en interne à `10.0.2`. Épinglez à une version spécifique en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les plugins lourds ou les médias volumineux. |
| `upload_max_filesize` | `64M` | Taille maximale de téléchargement d'un seul fichier (≤ `post_max_size`). |
| `post_max_size` | `64M` | Taille maximale de POST ; doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; minimum 1 vCPU pour EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 512 Mio (PHP 8.x). |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Gardez à `1` sauf si le stockage partagé + l'affinité de session sont confirmés. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | EspoCRM se connecte à MySQL via TCP IP privée, pas via le socket. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface utilisateur du CRM. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer le trafic RFC 1918 (y compris l'IP privée Cloud SQL) via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant EspoCRM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `gcs-espocrm<tenant-prefix>-espocrm-data`. Non monté par défaut, sauf si vous ajoutez une entrée `gcs_volumes` correspondante. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Définitions de bucket provisionnées lorsque `create_cloud_storage` est vrai. |
| `enable_nfs` | `true` | Monte un volume Filestore partagé pour les pièces jointes téléchargées et les données d'exécution d'EspoCRM — persiste après les redémarrages par défaut. |
| `nfs_mount_path` | `/var/www/html/data` | Chemin de montage du volume NFS dans le conteneur. |
| `gcs_volumes` | `[]` | Pas de montage GCS Fuse par défaut ; le bucket `gcs-espocrm<tenant-prefix>-espocrm-data` reste non monté sauf si vous ajoutez une entrée ici. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur Cloud SQL. EspoCRM nécessite MySQL — ne sélectionnez pas PostgreSQL. |
| `db_name` | `espocrm` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `espocrm` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe de la base de données généré (plage valide 16-64). |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis comme backend de cache d'objets d'EspoCRM. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un `redis_port`/`backup_retention_days`
> hors plage, un environnement d'exécution `gen1` avec des montages NFS/GCS, IAP
> sans identités autorisées. Une configuration invalide échoue la **planification** avec
> une erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | EspoCRM ne prend en charge que MySQL ; la sélection de PostgreSQL interrompt le démarrage. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `ESPOCRM_ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager ; modifier dans l'interface utilisateur | Critique | Ne définit le mot de passe administrateur que lors de la **première** installation ; le perdre vous bloque jusqu'à la réinitialisation via la base de données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans URI de sauvegarde valide échoue le job d'importation. |
| `enable_nfs` | `true` | Élevé | Le désactiver fait passer le stockage des pièces jointes d'EspoCRM sur un disque de conteneur éphémère — les téléchargements sont perdus lorsqu'une instance se réduit ou est recyclée. |
| `max_instance_count` | `1` sauf si vérifié sûr | Moyen | Les téléchargements sont pris en charge par NFS par défaut, mais Cloud Run n'a pas d'affinité de session intégrée — vérifiez le comportement d'EspoCRM sous des sessions PHP concurrentes avant de passer au-delà d'une instance. |
| `enable_cloudsql_volume` | `false` (TCP IP privée) | Élevé | Forcer le socket sans chemin de point d'entrée correspondant peut interrompre la connexion MySQL ; EspoCRM compose l'IP privée par conception. |
| `ESPOCRM_SITE_URL` (auto-dérivé) | URL réelle du service / du domaine personnalisé | Élevé | Une URL de site incorrecte rompt les liens absolus, la vérification de l'installateur et les redirections OAuth. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, PHP 8.x tue le processus par manque de mémoire lors de l'installation/migration et sous charge. |
| `cpu_limit` | `1000m` | Moyen | En dessous de 1 vCPU, l'installation au premier démarrage et le traitement des plugins lourds sont ralentis. |
| `enable_iap` | uniquement lorsque l'interface utilisateur publique n'est pas nécessaire | Moyen | IAP nécessite une connexion Google pour chaque requête, y compris les intégrations d'API. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid et, sans volume partagé, supprime les téléchargements locaux lors de la réduction. |
| `application_version` | Épingler en production | Moyen | `latest` correspond à un tag épinglé en interne, mais l'épinglage explicite évite les mises à niveau surprises lors du redéploiement. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à EspoCRM
partagée avec la variante GKE est décrite dans **[EspoCRM_Common](EspoCRM_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : EspoCRM sur Cloud Run](../labs/EspoCRM_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EspoCRM sur GKE Autopilot](EspoCRM_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [EspoCRM Common — Configuration d'application partagée](EspoCRM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cyclos sur Google Cloud Run](Cyclos_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Inclusion financière et services bancaires communautaires**.
