---
title: "Focalboard sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Focalboard sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Focalboard_CloudRun.md @ 1665a43e sha256:5865298b0351 -->

# Focalboard sur Google Cloud Run {#focalboard-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Focalboard_CloudRun.png" alt="Focalboard sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Focalboard est un serveur Kanban et de gestion de projet auto-hébergé et open source
du projet Mattermost — un backend Go servant un frontend React construit pour gérer les
tâches, les tableaux et les flux de travail. Ce module déploie Focalboard sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Focalboard et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, autorisation binaire, contrôles de service VPC, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Coût de Focalboard sur RAD et comparaison {#what-focalboard-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module Cloud Run de Focalboard sur RAD coûte environ 102 US$ par mois, plus 11 US$ une fois par déploiement et sans licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail qui doivent rester actives en permanence ou fonctionner à côté d'autres applications Kubernetes ; voir le [guide GKE](Focalboard_GKE.md), environ 150 US$ par mois. Focalboard est un outil Kanban et de gestion de projet open source et auto-hébergé (une alternative à Trello/Asana/Notion) de Mattermost. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 102 US$. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **102 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2 vCPU / 4 GiB, mise à l'échelle à zéro | 32 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Serveur de fichiers NFS/cache : une petite VM | 13 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 102 US$** |

### Comparaison {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Focalboard au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, Cloud Run, votre propre projet** | **102 US$**, plus 11 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, GKE Autopilot | environ 150 US$ ; voir le [guide GKE Autopilot](Focalboard_GKE.md) | RAD |

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence est ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Focalboard est un outil Kanban et de gestion de projet open source et auto-hébergé (une alternative à Trello/Asana/Notion) de Mattermost.** Cela détermine quelle colonne est importante : un fonctionnement prévisible et sans intervention est plus précieux pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Focalboard s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 102 US$.** Déployez Focalboard, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures où il était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes, de sorte que la majeure partie de son propre coût de calcul s'arrête d'elle-même lorsque personne ne l'utilise. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 US$). La suppression permet d'économiser de l'argent si Focalboard devait rester inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 3,40 US$ par jour), ou environ 4 jours ou plus dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Focalboard utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet ne sauve que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de laboratoire, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Focalboard dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Focalboard s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go sur le port 8000, 2 vCPU / 4 GiB par défaut ; mise à l'échelle automatique sans serveur avec mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — le moteur est fixe (`database_type = POSTGRES_15`) |
| Stockage des pièces jointes | Cloud Storage (GCS FUSE) | Un bucket dédié monté à `/data` via gcsfuse afin que les pièces jointes téléchargées survivent aux redémarrages |
| Secrets | Secret Manager | `FOCALBOARD_ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données géré par la fondation |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; Focalboard n'a pas de chemin MySQL ou SQLite dans ce
  module.
- **Focalboard lit `config.json`, pas les variables d'environnement, pour la connexion à la base de données.** Un
  point d'entrée personnalisé régénère `/opt/focalboard/config.json` à partir des valeurs
  `DB_*` injectées par la fondation à chaque démarrage, de sorte qu'aucun DSN
  n'est intégré à l'image.
- **Les pièces jointes se trouvent sur un bucket GCS monté avec gcsfuse à `/data`.** Cloud Run
  n'a pas d'option PVC de bloc, donc `enable_gcs_storage_volume = true` monte le bucket de stockage à
  l'emplacement `filespath` de Focalboard. Les *données* du tableau (cartes, tableaux,
  utilisateurs) résident dans PostgreSQL ; seuls les fichiers téléchargés atterrissent
  sur le bucket.
- **Aucun Redis n'est utilisé.** `enable_redis = false` — Focalboard conserve tout l'état du
  tableau dans PostgreSQL et n'a pas besoin de cache ou de file d'attente externe.
- **La mise à l'échelle à zéro est activée** (`min_instance_count = 0`, `max_instance_count = 5`). Les démarrages à
  froid ajoutent quelques secondes de latence à la première requête après l'inactivité ;
  définissez `min_instance_count = 1` pour maintenir une instance chaude.
- **L'image est une build personnalisée mise en miroir.** L'image officielle
  `mattermost/focalboard` est encapsulée et mise en miroir dans Artifact Registry ;
  `application_version` par défaut à `7.11.4`, et `latest` mappe à cette balise
  épinglée au moment de la build (`latest` n'est pas une balise Focalboard
  publiée).
- **Authentification native, le premier utilisateur est le propriétaire.** `authMode = native` et les
  tableaux partagés publics sont activés ; le premier compte enregistré via l'interface
  utilisateur devient le propriétaire de l'espace de travail. Il n'y a pas d'administrateur
  pré-initialisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Focalboard {#a-cloud-run--the-focalboard-service}

Focalboard s'exécute en tant que service Cloud Run v2 écoutant sur le port **8000**,
avec une mise à l'échelle automatique en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements
sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~focalboard"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Focalboard stocke toutes les données du tableau (tableaux, cartes, blocs, utilisateurs,
sessions) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte
privatement — sur Cloud Run via l'IP privée du VPC avec `sslmode=require`, ou via le
socket Unix du **Cloud SQL Auth Proxy** lorsque `enable_cloudsql_volume = true` ; aucune IP publique
n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de
données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — bucket de pièces jointes {#c-cloud-storage--attachment-bucket}

Un bucket **Cloud Storage** dédié (le suffixe `storage`) est provisionné
automatiquement et monté à `/data` via gcsfuse afin que les pièces jointes
téléchargées persistent après les redémarrages d'instance et la mise à l'échelle à
zéro. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachment-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret d'application est généré automatiquement et stocké dans Secret Manager :
`FOCALBOARD_ADMIN_PASSWORD` (une chaîne aléatoire de 24 caractères, injectée comme variable
d'environnement de secret de SERVICE). Un deuxième secret dédié — `secret-<resource_prefix>-focalboard-safe-db-password`
(alphanumérique uniquement, sans caractères spéciaux) — remplace le `DB_PASSWORD` du
SERVICE et est ce que `db-init` définit réellement comme mot de passe du rôle
Postgres (comme `FOCALBOARD_SAFE_DB_PASSWORD`) ; la sortie `database_password_secret` à l'échelle de la flotte
**n'authentifie pas** le rôle. Voir [Section 3](#3-focalboard-application-behaviour).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~focalboard"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ;
les paramètres d'ingress et d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte facultatives. Le point d'entrée affiche l'hôte, le nom,
l'utilisateur de la base de données résolus et `sslmode` au démarrage — utile
pour confirmer le câblage de la connexion.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Focalboard {#3-focalboard-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente le rôle d'application (`LOGIN CREATEDB`) et la base de données,
  accorde les privilèges et réaffecte le propriétaire du schéma `public` au rôle
  de l'application afin que Focalboard puisse exécuter ses migrations. Aucune extension
  Postgres n'est installée. Le job peut être réexécuté en toute sécurité.
- **Le vrai mot de passe du rôle est un secret dédié alphanumérique uniquement, pas `database_password_secret`.**
  Le mot de passe de base de données standard de la flotte de la Fondation (jeu de
  caractères `_%@`) peut contenir un `%` qui fait planter le pilote
  postgres Go de Focalboard — sa validation DSN basée sur `url.Parse` et son
  connecteur `lib/pq` réel ne sont pas d'accord sur le décodage en pourcentage,
  donc aucun encodage unique de ce mot de passe ne satisfait les deux. `Focalboard_Common`
  génère un mot de passe distinct (`secret-<resource_prefix>-focalboard-safe-db-password`), remplace le `DB_PASSWORD` du
  SERVICE par celui-ci, et le transmet à `db-init` comme `FOCALBOARD_SAFE_DB_PASSWORD`, ce qui
  est le mot de passe du rôle réellement défini. La sortie `database_password_secret` (§5)
  signale le nom du secret à l'échelle de la flotte, qui ne s'authentifie pas
  auprès de ce rôle.
- **Les migrations s'exécutent au démarrage.** Focalboard applique ses propres
  migrations de schéma à chaque démarrage en tant qu'utilisateur de l'application, de
  sorte que la mise à niveau de `application_version` applique les modifications de schéma
  sans étape de migration distincte.
- **`config.json` est généré à l'exécution.** Focalboard n'a pas de remplacement de
  variable d'environnement pour la connexion à la base de données ; le point d'entrée
  écrit `/opt/focalboard/config.json` à partir des variables `DB_*` injectées à chaque
  démarrage. Sur Cloud Run, il se connecte via l'IP privée avec `sslmode=require`
  (préférant `DB_IP`, car le socket Cloud SQL ne se matérialise pas toujours).
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  `/` — l'interface utilisateur web, qui renvoie 200 une fois que le
  serveur lie son port et termine les migrations. Prévoyez jusqu'à ~7-8 minutes au
  premier démarrage (délai initial de démarrage de 60 secondes + une fenêtre de
  nouvelles tentatives de 15s×30).
- **Configuration initiale.** Focalboard s'exécute en `authMode = native` ; ouvrez l'URL du
  service et enregistrez le premier compte, qui devient le propriétaire de l'espace de
  travail. `enablePublicSharedBoards` est activé, de sorte que les tableaux peuvent être partagés
  via des liens publics.
- **Pièces jointes vs données.** Le contenu du tableau réside dans PostgreSQL ; seuls
  les fichiers téléchargés sont écrits dans le bucket monté gcsfuse à
  `/data`. Si le montage du bucket est manquant, les téléchargements échouent
  mais l'édition du tableau fonctionne toujours.
- **Inspectez la configuration et les jobs en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Focalboard sont
listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `focalboard` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `7.11.4` | Balise d'image Focalboard ; `latest` correspond à la balise épinglée `7.11.4` au moment de la build. |
| `display_name` | `Focalboard` | Nom lisible par l'homme affiché dans la console. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances. Peut être augmenté en toute sécurité — l'état du tableau est dans PostgreSQL, pas par instance. |
| `container_port` | `8000` | Focalboard écoute sur le port 8000. |
| `enable_cloudsql_volume` | `true` | Socket du proxy d'authentification Cloud SQL ; le point d'entrée utilise également le TCP IP privée en cas de repli. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image `mattermost/focalboard` dans Artifact Registry. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (démarrage à froid). Focalboard n'a pas de workers en arrière-plan ni de serveur WebSocket, donc la mise à l'échelle à zéro est sûre. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Focalboard nécessite PostgreSQL 15. |
| `application_database_name` | `crappdb` | Nom de la base de données Cloud SQL, injecté comme `DB_NAME`. Immuable après le premier déploiement. |
| `application_database_user` | `crappuser` | Utilisateur de la base de données de l'application, injecté comme `DB_USER`. Mot de passe auto-généré dans Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation facultative du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, timeout de 10s, période de 15s, 30 tentatives | Sonde de démarrage. Prévoir ~7-8 minutes au premier démarrage pour les migrations. |
| `liveness_probe` | HTTP `/`, délai de 60s, timeout de 5s, période de 30s, 3 tentatives | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring ; désactivée par défaut. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Focalboard ne nécessite pas Redis ; laissez désactivé. |

Toutes les autres entrées suivent le comportement et les valeurs par défaut standard de
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de base de données standard à l'échelle de la flotte — **pas** l'identifiant avec lequel le rôle Postgres de Focalboard s'authentifie (voir [Section 3](#3-focalboard-application-behaviour)) ; utilisez `secret-<resource_prefix>-focalboard-safe-db-password` à la place. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de pièces jointes). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — une
> configuration IAP sans identités autorisées, un runtime `gen1` avec des
> montages GCS, un `database_type` qui ne correspond pas à une extension activée, un
> `backup_retention_days` hors de portée. Une configuration invalide échoue la
> **planification** avec une erreur claire et nommée avant la création de toute
> ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Injecté comme `DB_NAME`/`DB_USER` et immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données du tableau. |
| Bucket de pièces jointes / `enable_gcs_storage_volume` | Garder le montage gcsfuse à `/data` | Critique | Sans un montage persistant à `filespath`, les pièces jointes téléchargées sont écrites sur un disque d'instance éphémère et perdues au redémarrage / à la mise à l'échelle à zéro. |
| `database_type` | `POSTGRES_15` | Critique | Tout autre moteur bloque le démarrage de Focalboard — il n'y a pas de chemin MySQL/SQLite ici. |
| `application_version` | Épingler une vraie balise (`7.11.4`) | Élevé | `mattermost/focalboard:latest` n'est pas une balise publiée ; la build mappe `latest` à la balise épinglée `FOCALBOARD_VERSION`, mais l'épinglage explicite évite les surprises. |
| `container_port` | `8000` | Élevé | Focalboard se lie au port 8000 ; un port non concordant fait que la sonde de démarrage ne passe jamais. |
| `enable_redis` | `false` | Moyen | Focalboard n'a pas besoin de Redis ; l'activer connecte une dépendance inutilisée. |
| `min_instance_count` | `1` pour une utilisation sensible à la latence | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `enable_cloudsql_volume` | `true` | Moyen | Le point d'entrée utilise le TCP IP privée en cas de repli avec `sslmode=require`, mais le socket du proxy d'authentification est le chemin principal. |
| Sortie `database_password_secret` | Ne l'utilisez pas pour vous connecter | Élevé | Signale le secret `DB_PASSWORD` à l'échelle de la flotte, qui ne s'authentifie pas auprès du rôle Postgres de Focalboard. Récupérez `secret-<resource_prefix>-focalboard-safe-db-password` pour un identifiant fonctionnel. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise
à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
Focalboard partagée avec la variante GKE est décrite dans
**[Focalboard_Common](Focalboard_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Focalboard sur Cloud Run](../labs/Focalboard_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Focalboard sur GKE Autopilot](Focalboard_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Focalboard Common — Configuration d'application partagée](Focalboard_Common.md) — la configuration partagée par les deux cibles de déploiement.
