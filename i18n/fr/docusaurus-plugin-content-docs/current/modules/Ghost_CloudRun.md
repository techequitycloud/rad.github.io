---
title: "Ghost sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Ghost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ghost_CloudRun.md @ 40c83c3f sha256:9d707ac4f5ba -->

# Ghost sur Google Cloud Run {#ghost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_CloudRun.png" alt="Ghost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghost est une plateforme de publication open source moderne qui alimente plus de 2 millions de publications avec des fonctionnalités intégrées d'adhésion, d'abonnements et de newsletters. Ce module déploie Ghost sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Ghost et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Coût de Ghost sur RAD et comparaison {#what-ghost-costs-on-rad-and-how-that-compares}

**L'exécution de Ghost dans votre propre projet Google Cloud coûte environ 81,23 $ US/mois en frais Google Cloud, en plus d'un coût unique de 110 crédits pour le module RAD** (99 crédits — 10 % de moins — dans un projet géré par RAD). Ghost est une plateforme de publication open source moderne avec plus de 48 000 étoiles sur GitHub, alimentant plus de 2 millions de publications et utilisée par les principales marques de médias indépendants. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Ghost est également disponible sur GKE — consultez le [guide GKE](Ghost_GKE.md) si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | ~81,23 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~67 crédits/jour (~6,70 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **81,23 $ US** |

### Comparaison {#how-it-compares}

- Le plan payant le moins cher de **Ghost(Pro)**, Starter, coûte 18 $ US/mois (jusqu'à 1 000 membres, une newsletter, un domaine personnalisé gratuit (facturé annuellement)) — vérifié sur [https://ghost.org/pricing/](https://ghost.org/pricing/). Cela est inférieur à la facture Google Cloud de RAD d'environ 81,23 $ US/mois pour la variante Cloud Run, rien qu'en prix affiché, mais cela limite l'utilisation ; l'instance de RAD est illimitée, auto-hébergée, et les données ne quittent jamais votre propre projet.
- Le véritable compromis ici est entre la limite et le contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ghost est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la propre suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module Ghost seul, cela ne démantèle pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit. Les frais de module de 99 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Ghost et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Ghost se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) : 110 crédits (11,00 $ US) dans votre propre projet, ou **99 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Ghost reste inutilisé suffisamment longtemps pour que le coût de redéploiement soit inférieur à son propre coût d'exécution : environ **5 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 81,23 $ US/mois), ou **environ 4 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~67 crédits/jour).

La majeure partie du coût d'exécution de Ghost est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application sur le total ci-dessus.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tarification de Ghost(Pro)](https://ghost.org/pricing/) pour les chiffres de Ghost(Pro).

## 1. Vue d'ensemble {#1-overview}

Ghost s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 Mio par défaut, facturation basée sur les requêtes avec mise à l'échelle à zéro |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Ghost 6.x ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Contenu et thèmes téléchargés partagés entre toutes les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket de contenu dédié (`ghost-content`) provisionné automatiquement |
| Cache | Redis | Activé par défaut ; revient à l'adresse IP de l'hôte NFS si aucun hôte Redis n'est fourni |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app`, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Ghost 6.x nécessite MySQL ; PostgreSQL n'est pas pris en charge et ne démarrera pas.
- **`database__client = "mysql"` est injecté automatiquement.** Sans cela, Ghost revient silencieusement à SQLite — le module le gère, vous n'avez donc jamais besoin de le définir manuellement.
- **Redis est activé par défaut.** Ghost utilise Redis pour la mise en cache des pages afin de réduire la charge de la base de données et d'améliorer les temps de réponse.
- **Détection dynamique d'URL.** Le point d'entrée personnalisé interroge l'API Cloud Run au démarrage pour découvrir l'URL du service et l'exporter en tant que `url` pour Ghost. Une variable d'environnement explicite `url` a la priorité.
- **Un bucket GCS `ghost-content` est provisionné automatiquement** par `Ghost_Common` et n'a pas besoin d'être ajouté à `storage_buckets`.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et l'utilisateur MySQL de Ghost.
- **Les sondes de santé ciblent `/`** avec un délai initial de 90 secondes pour permettre à Ghost d'exécuter les migrations de base de données et de compiler les thèmes au premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Ghost {#a-cloud-run--the-ghost-service}

Ghost s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Ghost stocke toutes les données de l'application (articles, membres, paramètres) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le contenu téléchargé (images, thèmes, fichiers) est écrit sur un partage **Filestore (NFS)** monté dans le service afin que toutes les instances partagent les mêmes fichiers. Un bucket **Cloud Storage** dédié (`ghost-content`) est également provisionné automatiquement pour le contenu. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<content-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache des pages de Ghost. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans le service au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des stratégies d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ghost {#3-ghost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` se connecte à Cloud SQL via le proxy d'authentification et crée de manière idempotente la base de données Ghost (avec le jeu de caractères `utf8mb4` et la collation `utf8mb4_0900_ai_ci`), crée l'utilisateur de l'application et accorde tous les privilèges. Le job s'exécute à chaque apply et peut être relancé en toute sécurité.
- **Démarrage lent au premier lancement.** Ghost exécute des migrations de base de données et compile des thèmes au premier démarrage. La sonde de démarrage autorise un délai initial de 90 secondes — ne le réduisez pas en dessous de 60 secondes, sinon l'instance sera tuée avant que Ghost ne termine son initialisation.
- **Détection dynamique d'URL.** Au démarrage, le point d'entrée personnalisé interroge l'API de métadonnées Cloud Run pour découvrir l'URL du service et la définit comme `url` et `admin__url` de Ghost. Une variable d'environnement explicite `url` a toujours la priorité. Cela garantit que Ghost génère des liens absolus corrects dans les e-mails d'adhésion et la navigation d'administration.
- **Connexion à la base de données.** Le point d'entrée mappe `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD` et `DB_PORT` aux paramètres `database__connection__*` de Ghost automatiquement. Lorsque `DB_HOST` commence par `/`, il est traité comme un chemin de socket Unix (le socket du proxy d'authentification Cloud SQL).
- **SMTP pour les e-mails.** Ghost nécessite SMTP pour les inscriptions de membres, les réinitialisations de mot de passe et la livraison de newsletters. Paramètres `environment_variables` pré-remplis (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`) — configurez-les avant d'inviter des membres.
- **Connexion administrateur.** Le panneau d'administration de Ghost se trouve à `<url>/ghost`. Au premier démarrage, Ghost crée un utilisateur administrateur de manière interactive.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui renvoie HTTP 200 lorsque Ghost est entièrement initialisé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Ghost sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ghost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Ghost Publishing` | Nom convivial affiché dans la console. |
| `description` | `Ghost - Professional publishing platform` | Description du service. |
| `application_version` | `6.14.0` | Tag de version de l'image Ghost ; incrémenter pour déclencher une nouvelle révision. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; dimensionné pour une utilisation légère/typique — augmenter à `2000m` pour la production avec un traitement d'image ou une gestion des membres intensifs. |
| `memory_limit` | `512Mi` | Mémoire par instance (plancher de Ghost) ; augmenter à `1Gi`+ pour la production avec des fonctionnalités d'adhésion actives. |
| `min_instance_count` | `0` | Instances minimales ; `0` active la mise à l'échelle à zéro — définir `1` pour éviter les démarrages à froid avec des retards de migration. **Bug connu :** le local `main.tf` de `ghost_module` code actuellement en dur `min_instance_count = 0`, écrasant silencieusement cette variable quelle que soit la configuration (signalé par un `TODO` dans `main.tf`) — voir l'entrée Pièges de configuration ci-dessous. |
| `max_instance_count` | `1` | Instances maximales ; limite la mise à l'échelle concurrente. **Bug connu :** le local `main.tf` de `ghost_module` code actuellement en dur `max_instance_count = 5`, écrasant silencieusement cette variable quelle que soit la configuration. |
| `container_port` | `2368` | Port HTTP natif de Ghost. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build (par défaut) ; `prebuilt` déploie une image existante. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. Requis pour Ghost. |
| `execution_environment` | `gen2` | Cloud Run gen2 requis pour les montages NFS. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{SMTP_HOST="", SMTP_PORT="587", SMTP_USER="", SMTP_PASSWORD="", SMTP_SSL="false", EMAIL_FROM="ghost@example.com"}` | Paramètres SMTP pré-remplis pour la livraison d'e-mails Ghost (utiliser le port 587 STARTTLS ou 465 SSL — Google Cloud bloque le port sortant 25). `database__client=mysql` est injecté automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Attente de réplication après la création du secret. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. Ghost doit connaître son URL publique — assurez-vous que le domaine correspond. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le contenu Ghost. Nécessite gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. Le bucket `ghost-content` est toujours provisionné automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Ghost nécessite MySQL 8.0 — ne pas modifier. |
| `db_name` | `ghost` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `ghost` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires pour les détails de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai initial de 90s, 10 échecs | Sonde de démarrage HTTP sur le chemin racine de Ghost. Délai généreux pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/` délai initial de 60s | Sonde de vivacité ciblant le chemin racine de Ghost. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache des pages Ghost. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP de l'hôte NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `ghost-content`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Ghost nécessite MySQL 8.0 ; tout autre moteur empêche le démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, le contenu téléchargé est perdu entre les instances/redémarrages. |
| `container_port` | `2368` | Critique | Port natif de Ghost ; une non-concordance entraîne l'échec de toutes les sondes de santé. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `startup_probe` initial_delay_seconds | `90` | Élevé | La réduction en dessous de 60 secondes entraîne l'arrêt de Ghost par Cloud Run avant qu'il ne termine l'exécution des migrations. |
| `enable_redis` | `true` | Élevé | Sans Redis, Ghost sert toutes les pages sans cache, augmentant la charge de la base de données. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `memory_limit` | `512Mi`+ | Élevé | Trop peu de mémoire provoque des OOM Node.js lors de l'envoi de newsletters ou de la compilation de thèmes ; augmenter au-delà de la valeur par défaut `512Mi` pour une utilisation active de l'adhésion/newsletter. |
| `environment_variables` Paramètres SMTP | serveur SMTP réel | Élevé | Aucune livraison d'e-mail signifie aucune inscription de membre, aucune réinitialisation de mot de passe, aucune newsletter. |
| `container_image_source` | `custom` | Élevé | L'image Ghost en amont ne contient pas le point d'entrée personnalisé qui mappe les identifiants de base de données et détecte l'URL du service. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `min_instance_count` / `max_instance_count` | `0` (par défaut) ou `1` | Moyen | **Bug connu :** le local `main.tf` de `ghost_module` code en dur `min_instance_count = 0` et `max_instance_count = 5`, écrasant silencieusement ces variables — les définir dans `tfvars` et réappliquer n'a actuellement aucun effet sur les limites de mise à l'échelle du service déployé tant que la surcharge codée en dur n'est pas supprimée de la source du module. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | Le panneau d'administration de Ghost (`/ghost`) est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Ghost partagée avec la variante GKE est décrite dans **[Ghost_Common](Ghost_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Ghost sur Cloud Run](../labs/Ghost_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ghost sur GKE Autopilot](Ghost_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Ghost Common — Configuration d'application partagée](Ghost_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Création et publication de médias**.
