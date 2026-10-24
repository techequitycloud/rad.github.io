---
title: "Dolibarr sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Dolibarr sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Dolibarr_CloudRun.md @ e69407af sha256:74b74a3c2566 -->

# Dolibarr sur Google Cloud Run {#dolibarr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dolibarr_CloudRun.png" alt="Dolibarr sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dolibarr est une suite ERP et CRM gratuite et open-source couvrant les clients et prospects,
les devis, les commandes, les factures, les produits et stocks, les RH, les projets et la comptabilité via une
interface utilisateur web PHP modulaire. Ce module déploie Dolibarr sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud que Dolibarr utilise et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Dolibarr sur RAD, et comment cela se compare {#what-dolibarr-costs-on-rad-and-how-that-compares}

**Dolibarr sur le module Cloud Run de RAD coûte environ 83,61 $ US par mois sans licence par utilisateur.** Cela se compare à environ 140 € par mois (10 utilisateurs) sur le plan Basic de DoliCloud, ou 180 € par mois sur son plan Premium. Un serveur auto-géré est moins cher en espèces, mais vous gérez alors vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. GKE Autopilot convient à Dolibarr qui doit rester actif en permanence ou s'adapter à travers les pods ; pour le coût le plus bas, ce module Cloud Run vous offre déjà l'option la moins chère — voir le [guide GKE](Dolibarr_GKE.md) si vous avez besoin de l'autre. Les chiffres sont au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 83,61 $ US deviennent quelques dollars par mois à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **83,61 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 83,61 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| DoliCloud, plan Basic (10 utilisateurs) | 140 € par mois (14 €/utilisateur) | DoliCloud (hébergeur propre à Dolibarr) |
| DoliCloud, plan Premium (10 utilisateurs) | 180 € par mois (30 € + 15 €/utilisateur) | DoliCloud |
| **RAD, Cloud Run, votre propre projet** | **Environ 83,61 $ US** | Automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 96 $ US** | RAD |

- DoliCloud est l'hébergement officiel de Dolibarr, c'est donc la comparaison la plus directe dans ce guide — même logiciel, endroit d'exécution différent. Pour dix utilisateurs, RAD coûte moins des deux tiers du plan Basic de DoliCloud et moins de la moitié du plan Premium.
- Le prix de DoliCloud augmente avec chaque utilisateur ajouté ; le coût de RAD est celui de l'infrastructure, qu'une équipe croissante n'atteint que lorsqu'elle a besoin de plus de capacité.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Dolibarr s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Dolibarr dont vous n'avez besoin qu'occasionnellement — pour étudier, une démo, une activité
saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à
  la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou Cloud Run un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement de taille Dolibarr typique, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 83,61 $ US.** Déployez Dolibarr, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Dolibarr a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc
  très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run s'adapte déjà à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou
une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer
à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Dolibarr. La suppression permet d'économiser de l'argent une fois que Dolibarr resterait autrement inutilisé
  pendant environ **4 jours ou plus** dans votre propre projet (environ 2,79 $ US par jour), ou environ
  **3 jours ou plus** dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Dolibarr utilise.** La majeure partie du coût de fonctionnement est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc les supprimer pendant que quelque chose d'autre partage le projet ne sauve que la partie calcul de Dolibarr.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les
  paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de
  Dolibarr dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Dolibarr pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
Frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration. [Tarification DoliCloud](https://www.dolicloud.com/en-faq-pricing.php) pour les chiffres des plans Basic et Premium ;

## 1. Vue d'ensemble {#1-overview}

Dolibarr s'exécute comme un conteneur PHP/Apache unique sur Cloud Run v2. Le déploiement connecte
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les documents/PDFs téléchargés persistent sous `/var/lib/dolibarr` après les redémarrages |
| Stockage d'objets | Cloud Storage | Un bucket `dolibarr-documents` provisionné automatiquement |
| Secrets | Secret Manager | `DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée
  (`database_type = MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est accessible via TCP sur l'IP privée.** Sur Cloud Run, cette variante
  par défaut `enable_cloudsql_volume = false`, de sorte que Dolibarr et le job `db-init`
  se connectent à l'IP privée de l'instance sur le port 3306 (Cloud SQL MySQL 8 utilise
  `caching_sha2_password`, géré par le job d'initialisation).
- **Instance unique par défaut.** `max_instance_count = 1`. Dolibarr conserve l'état de session
  et de verrouillage qui n'est pas sûr pour plusieurs instances sans stockage partagé et routage persistant
  — n'augmentez pas `max_instance_count` au-dessus de 1 sans vérifier cela au préalable.
- **La mise à l'échelle à zéro est activée** (`min_instance_count = 0`). Les démarrages à froid ajoutent quelques
  secondes plus le démarrage PHP/Apache sur la première requête après l'inactivité ; définissez
  `min_instance_count = 1` pour un service toujours chaud.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/lib/dolibarr`)
  afin que les documents téléchargés et les PDF générés survivent à la recréation du conteneur.
- **Auto-installation au premier démarrage.** `DOLI_INSTALL_AUTO = 1` fait en sorte que l'installateur Dolibarr
  crée le schéma au premier démarrage ; il n'y a pas de job de migration séparé.
- **`DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` sont générés automatiquement**
  et stockés dans Secret Manager. Le mot de passe administrateur est utilisé pour créer le compte super-administrateur
  initial (nom d'utilisateur `DOLI_ADMIN_LOGIN`, par défaut `admin`).
- **`DOLI_URL_ROOT` est défini à partir de l'URL de service prédite** au moment de la planification afin que les liens absolus
  et les redirections de connexion se résolvent à l'adresse Cloud Run réelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Dolibarr {#a-cloud-run--the-dolibarr-service}

Dolibarr s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dolibarr"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Dolibarr stocke toutes les données d'application (tiers, factures, produits, utilisateurs,
comptabilité) dans une instance gérée de Cloud SQL pour MySQL 8.0. Avec la valeur par défaut de Cloud Run
`enable_cloudsql_volume = false`, le service se connecte via **TCP à l'IP privée de l'instance**
sur le port 3306 ; aucune IP publique n'est exposée. Lors du premier déploiement, le
job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations ; l'installateur Dolibarr
crée ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `dolibarr-documents`, injecté par la
couche Common) est provisionné automatiquement, à côté du bucket standard avec le suffixe `data`
de `storage_buckets`. Séparément, l'arborescence des documents de Dolibarr se trouve sur **NFS**
à `/var/lib/dolibarr` afin que les téléchargements et les PDF générés survivent à la recréation du conteneur.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets Dolibarr sont générés automatiquement et stockés dans Secret Manager :
`DOLI_ADMIN_PASSWORD` (le mot de passe super-administrateur de première exécution) et
`DOLI_INSTANCE_UNIQUE_ID` (un sel de sécurité par instance). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être superposé ; les paramètres d'ingress et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Dolibarr {#3-dolibarr-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte à Cloud SQL (IP privée TCP sur Cloud Run),
  crée de manière idempotente la base de données de l'application, l'utilisateur et les autorisations, vérifie que l'utilisateur de l'application
  peut se connecter, puis arrête le sidecar Auth Proxy. Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries = 3`).
- **Auto-installation au premier démarrage (pas de job de migration séparé).** Avec
  `DOLI_INSTALL_AUTO = 1`, l'image Dolibarr exécute son propre installateur au premier
  démarrage du conteneur, créant le schéma dans la base de données vide. Lors des mises à niveau de version, l'image applique ses propres étapes de mise à niveau au démarrage.
- **Compte administrateur.** L'installateur crée un super-administrateur dont le nom d'utilisateur est
  `DOLI_ADMIN_LOGIN` (par défaut `admin`) et dont le mot de passe est le secret généré
  `DOLI_ADMIN_PASSWORD`. Récupérez-le avant la première connexion.
- **Alias des variables d'environnement de la base de données.** La plateforme injecte les variables standard `DB_*` ;
  Dolibarr lit `DOLI_DB_*`. Le point d'entrée du wrapper les alias au moment de l'exécution et
  préfère les valeurs injectées `DB_*` aux valeurs par défaut `mysql`/`dolidb`
  intégrées à l'image — sinon le conteneur attendrait indéfiniment un hôte inexistant.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 80 ; la sonde de vivacité est **HTTP**
  `GET /` (la page de connexion renvoie 200 sans authentification). Attendez plusieurs minutes au premier
  démarrage pour l'installateur avant que la page de connexion ne soit servie.
- **`DOLI_INSTANCE_UNIQUE_ID` est un sel stable.** Gardez-le constant tout au long de la vie
  du déploiement ; il est utilisé pour les URL cron et la signature de jetons.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION" --filter="metadata.name~dolibarr"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Dolibarr sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dolibarr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `dolibarr/dolibarr` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et fonctionnel (`23.0.3`) au moment du build. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les modules lourds/grandes bibliothèques de documents. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; conserver `post_max_size ≥ upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Dolibarr est livré en tant que build personnalisé léger ; conserver `custom`. |
| `cpu_limit` | `1000m` | Minimum 1 vCPU pour Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512 Mo ; 2 Go recommandés pour la production. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; définir `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le partage multi-instance est vérifié. |
| `container_port` | `80` | Dolibarr s'exécute sur Apache, port 80. |
| `enable_cloudsql_volume` | `false` | `false` = connexion TCP via IP privée (par défaut Cloud Run). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut pour que les documents téléchargés persistent. |
| `nfs_mount_path` | `/var/www/documents` | Où Dolibarr stocke les documents/PDFs. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket supplémentaire au-delà du bucket `dolibarr-documents` auto-provisionné, que la couche Common injecte via `module_storage_buckets`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur fixe — Dolibarr nécessite MySQL. |
| `db_name` | `dolibarr` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `dolibarr` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 80, délai 30s, 20 tentatives | Nécessite uniquement que le listener Apache se lie. |
| `liveness_probe` | HTTP `/` délai 300s | La page de connexion renvoie 200 non authentifié. |
| `uptime_check_config` | désactivé (`path = "/"`) | Vérification de disponibilité Cloud Monitoring optionnelle. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Cache d'objets optionnel ; désactivé par défaut. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis lorsqu'il est activé. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `container_port` invalide, un `timeout_seconds`/`backup_retention_days` hors limites, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | La sélection d'un moteur non-MySQL bloque l'installateur et toutes les requêtes. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `DOLI_INSTANCE_UNIQUE_ID` (auto-généré) | Ne jamais changer | Critique | Changer le sel après le premier démarrage invalide les jetons signés et les URL cron. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les documents/PDFs téléchargés éphémères — perdus à chaque recréation de conteneur. |
| `max_instance_count` | `1` | Élevé | L'augmenter sans stockage partagé + routage persistant risque des sessions divisées, des conflits de verrouillage et un état de document incohérent. |
| `enable_backup_import` | `false` sauf restauration | Élevé | L'activer sans un `backup_uri` valide fait échouer le job d'importation. |
| `DOLI_URL_ROOT` (auto-défini) | URL de service réelle | Élevé | Une URL racine erronée rompt les liens absolus et la redirection de connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mo, le conteneur PHP/Apache manque de mémoire sous charge ; la gen2 a un plancher de 512 Mo. |
| `DOLI_ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous bloque l'accès au premier compte super-administrateur jusqu'à la réinitialisation via la base de données. |
| `ingress_settings` | `all` | Moyen | `internal` bloque l'accès public à l'interface utilisateur de Dolibarr. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid lors de la première requête après l'inactivité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur est accessible publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Dolibarr
partagée avec la variante GKE est décrite dans **[Dolibarr_Common](Dolibarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dolibarr sur Cloud Run](../labs/Dolibarr_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Dolibarr sur GKE Autopilot](Dolibarr_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Dolibarr Common — Configuration d'application partagée](Dolibarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md), [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
