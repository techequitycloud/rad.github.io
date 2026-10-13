---
title: "OnlyOffice sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'OnlyOffice sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OnlyOffice_CloudRun.md @ e69407af sha256:ba3137501956 -->

# OnlyOffice sur Google Cloud Run {#onlyoffice-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OnlyOffice_CloudRun.png" alt="OnlyOffice sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ONLYOFFICE Document Server est une suite bureautique collaborative en ligne open source pour
l'édition collaborative en temps réel de documents texte, de feuilles de calcul, de présentations, de PDF et de formulaires —
une alternative auto-hébergée à Google Docs / Microsoft Office Online. Il n'est généralement pas
ouvert directement par les utilisateurs finaux ; il est plutôt intégré par une application hôte (Nextcloud,
ownCloud, Seafile, ou une intégration personnalisée) via son API et un secret JWT partagé. Ce
module déploie ONLYOFFICE Document Server sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'OnlyOffice utilise et sur la manière de les explorer et de
les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à chaque application Cloud Run — identité de service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte OnlyOffice sur RAD et comment cela se compare {#what-onlyoffice-costs-on-rad-and-how-that-compares}

**OnlyOffice sur le module Cloud Run de RAD coûte environ 102 $ US par mois, les frais de module étant facturés une fois en crédits RAD.** Si vous avez besoin qu'OnlyOffice reste opérationnel en continu, qu'il s'adapte à plusieurs pods ou qu'il fonctionne aux côtés d'autres charges de travail Kubernetes, consultez le [guide GKE](OnlyOffice_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **OnlyOffice**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **102 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 Gio (scaleToZero) | 31,53 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 102 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| ONLYOFFICE DocSpace, Startup | Gratuit | Cloud hébergé par ONLYOFFICE. Jusqu'à 3 administrateurs, 2 Go de stockage, utilisateurs gratuits illimités |
| ONLYOFFICE DocSpace, Business | 20 $/administrateur/mois | Cloud hébergé par ONLYOFFICE. 250 Go par administrateur, salles illimitées |
| **RAD, Cloud Run, votre propre projet** | **Environ 102 $ US**, plus 11 $ US une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 960 crédits (77-96 $ US)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](OnlyOffice_GKE.md) | RAD |

Le DocSpace d'ONLYOFFICE est tarifé par **administrateur**, et non par utilisateur éditeur, ce qui est la comparaison la plus juste avec le coût d'infrastructure fixe de RAD. Pour une petite équipe qui n'a besoin que d'un ou deux administrateurs, le niveau Startup gratuit de DocSpace ou son plan Business à 20 $/mois peut être moins cher en espèces que le coût d'exécution du projet propre à RAD — la différence est que ce module déploie le Document Server **que vous intégrez dans votre propre application**, plutôt que l'espace de travail groupé d'ONLYOFFICE, ce qui est important si vous exécutez déjà une plateforme de documents (Nextcloud, ownCloud, une application personnalisée) qui n'a besoin que du moteur d'édition.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OnlyOffice s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à OnlyOffice dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet
saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement
  à la suppression d'un module, cela ne détruit pas la base de données, la VM ou la ressource de calcul
  une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer.
  RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne de déploiement typique de 2-3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 102 $ US.** Déployez OnlyOffice, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous le souhaitez, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps
  pendant lequel OnlyOffice était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser
  le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart
  des services sont entièrement fonctionnels à nouveau dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé OnlyOffice et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115
  crédits (11,50 $ US) dans votre propre projet, ou 104
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois qu'OnlyOffice resterait inutilisé pendant
  environ 3 jours ou plus dans votre propre projet (environ 3,40 $ US par
  jour), ou environ 3 jours ou plus dans un projet géré par RAD (32 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'OnlyOffice alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit
  OnlyOffice dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute OnlyOffice pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [tarification ONLYOFFICE DocSpace](https://www.onlyoffice.com/docspace-prices.aspx). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

L'image `onlyoffice/documentserver` est "tout compris" : elle regroupe ses propres
convertisseurs, nginx et RabbitMQ (AMQP) sous `supervisord`. Ce module construit un
wrapper personnalisé léger autour d'elle et externalise PostgreSQL (Cloud SQL) et Redis ; le
RabbitMQ groupé reste interne sur localhost.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur personnalisé, 2 vCPU / 4 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — un garde au moment de la planification rejette MySQL et tout autre moteur |
| Cache / état d'édition | Redis externe | Obligatoire — un garde au moment de la planification rejette `enable_redis = false` ; par défaut, le Redis de la VM NFS colocalisée lorsque `redis_host` est vide |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; stockage partagé des pièces jointes/documents entre les instances, monté à `/opt/onlyoffice/storage` |
| Stockage d'objets | Cloud Storage | Deux buckets par défaut : un bucket `storage` déclaré par `OnlyOffice_Common`, plus un bucket `data` via `storage_buckets` (tous deux protégés par `create_cloud_storage`, qui par défaut `true` ici puisque Cloud Run n'a pas d'option PVC de bloc) |
| Secrets | Secret Manager | Secret `JWT_SECRET` de 48 caractères généré automatiquement ; mot de passe de la base de données géré séparément |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Un garde inter-variables au moment de la planification dans le
  `validation.tf` de ce module rejette tout `database_type` autre que
  `POSTGRES_13`/`14`/`15`/`NONE`
  — MySQL et SQL Server ne sont pas pris en charge par Document Server.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment de la planification fait échouer le déploiement
  si `enable_redis = false`. Avec `redis_host` laissé vide, `enable_nfs` doit rester
  `true` afin que l'IP de la VM NFS colocalisée puisse servir d'hôte Redis par défaut.
- **NFS est activé par défaut** (`enable_nfs = true`, contrairement à la plupart des autres modules Cloud Run),
  car il sert à la fois de stockage de pièces jointes partagé et de source de point de terminaison Redis par défaut.
- **`JWT_SECRET` est généré une seule fois et ne doit jamais être renouvelé** après qu'une application hôte
  (Nextcloud, ownCloud, une intégration personnalisée) a été configurée pour intégrer
  l'éditeur — le renouveler rompt la confiance entre Document Server et chaque
  intégration jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur.
- **La mémoire minimale est de 4 Gio, et non les 512 Mio-2 Gio habituels de la plateforme.** La pile
  Postgres-client/Redis-client/RabbitMQ/nginx/convertisseur groupée sous `supervisord` est
  lourde et nécessite de la marge.
- **`cpu_always_allocated` par défaut à `false` (facturation basée sur la demande, axée sur les coûts).**
  Le travail d'édition/conversion principal s'exécute dans la demande, donc un démarrage à froid est supportable, mais
  la chaleur du cache de documents groupé et la file d'attente de conversion RabbitMQ interne se réinitialisent à
  chaque démarrage à froid. Définissez `true` (avec `min_instance_count >= 1`) pour un
  éditeur toujours chaud.
- **L'image est construite sur mesure, pas préconstruite.** `container_image_source = "custom"`
  enveloppe l'image Docker Hub `onlyoffice/documentserver` avec un `cloud-entrypoint.sh`
  qui mappe les variables `DB_*`/`REDIS_HOST` de la Fondation sur la propre
  convention de Document Server. `application_version = "latest"` est épinglé à `8.3.3` au moment de la construction via
  un ARG de build `ONLYOFFICE_VERSION` spécifique à l'application (le `APP_VERSION` injecté de la Fondation
  n'est délibérément pas utilisé, car il l'emporterait autrement sur la fusion).
- **Les vérifications de santé ciblent `/healthcheck`, non authentifiées**, avec un budget généreux au premier démarrage
  (délai initial de 90 s, jusqu'à 40 échecs) car la pile groupée est lente à devenir prête.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OnlyOffice {#a-cloud-run--the-onlyoffice-service}

OnlyOffice Document Server s'exécute en tant que service Cloud Run v2 unique (l'image wrapper personnalisée) qui s'adapte automatiquement à la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OnlyOffice stocke les métadonnées de documents, les versions et l'état de l'application dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` intégré crée le rôle d'application, la base de données et les autorisations — le Document Server installe ensuite son propre schéma au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis externe et Cloud Filestore (NFS) {#c-external-redis--cloud-filestore-nfs}

Redis contient l'état de session/d'édition qui doit être partagé entre chaque instance OnlyOffice — le RabbitMQ groupé reste interne, mais Redis est externalisé et **obligatoire** (un garde au moment de la planification fait échouer le déploiement si `enable_redis = false`). Avec `redis_host` laissé vide, la Fondation injecte l'IP Redis de la VM NFS colocalisée (`enable_nfs` doit rester `true` dans ce cas) ; définissez `redis_host` explicitement pour pointer vers une instance Redis différente. Cloud Filestore (NFS) est activé par défaut et monté à `/opt/onlyoffice/storage` pour le stockage partagé des pièces jointes/documents entre les instances — contrairement à la variante GKE, il n'y a pas d'option PVC de bloc, car les instances Cloud Run sont sans état et éphémères.

- **Console :** Compute Engine → Instances de VM (la VM colocalisée NFS/Redis) ;
  Filestore → Instances.
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the resolved Redis/DB env vars in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de découverte de la VM NFS et la
convention Redis-host-falls-back-to-NFS-IP.

### D. Cloud Storage {#d-cloud-storage}

Deux buckets sont provisionnés par défaut : un bucket `storage` déclaré par
`OnlyOffice_Common` (pour les besoins de stockage propres à l'application) et un bucket `data`
provenant de la valeur par défaut `storage_buckets` de ce module — tous deux protégés par
`create_cloud_storage`, qui par défaut `true` ici (contrairement à la variante GKE, qui par défaut
`false` car la persistance y réside sur un PVC de bloc + NFS).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~onlyoffice"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à OnlyOffice est généré automatiquement et stocké dans Secret
Manager : **`JWT_SECRET`** (48 caractères, pas de caractères spéciaux), qui signe chaque
requête API interne de Document Server et doit être présenté par toute application hôte
qui intègre l'éditeur. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Étant donné que Document Server est
généralement appelé par le propre backend d'une application hôte (et non directement par les utilisateurs finaux), conservez
`ingress_settings = "all"` à moins que tous les appelants ne soient à l'intérieur du VPC. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OnlyOffice {#3-onlyoffice-application-behaviour}

- **Configuration de la base de données au premier déploiement, pas de job de migration séparé.** Le job `db-init`
  intégré s'exécute en utilisant `postgres:15-alpine`. Il résout l'hôte Cloud SQL (le répertoire
  du socket Unix du proxy d'authentification, en revenant à l'IP privée de l'instance), attend que
  PostgreSQL soit accessible, crée/met à jour le rôle d'application avec le mot de passe généré,
  crée la base de données de l'application et accorde tous les privilèges — il ne provisionne que le rôle/la base de données/les autorisations.
  Le Document Server installe son propre schéma au premier démarrage, il n'y a donc pas d'étape de migration séparée.
  Le job peut être réexécuté en toute sécurité (`execute_on_apply = true`).
- **`JWT_SECRET` est immuable après que les intégrations sont câblées.** Généré une fois (48
  caractères) et écrit dans Secret Manager. `JWT_ENABLED = "true"`,
  `JWT_HEADER = "Authorization"`, `JWT_IN_BODY = "true"` sont définis automatiquement par
  `OnlyOffice_Common`. La rotation du secret invalide la confiance avec chaque application hôte
  intégrant l'éditeur jusqu'à ce que chacune soit reconfigurée avec la nouvelle valeur.
- **Le mappage des variables d'environnement DB et Redis se fait dans le `cloud-entrypoint.sh` intégré.** Il définit
  `DB_TYPE = "postgres"` et `DB_PWD` à partir du `DB_PASSWORD` injecté
  (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent déjà aux noms propres de Document Server),
  et mappe `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` sur
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASS` avant d'`exec` l'
  `/app/ds/run-document-server.sh` en amont. Étant donné que cette logique est intégrée à l'
  image personnalisée, une modification de `cloud-entrypoint.sh` nécessite une reconstruction pour prendre effet.
- **Bug du fournisseur spécifique à Cloud Run, corrigé au moment de la construction.** Sur Cloud Run, `DB_HOST` est un
  **répertoire** de socket Unix du proxy d'authentification Cloud SQL (`/cloudsql/<instance>`), ce qui est
  correct pour la connexion réelle à la base de données — mais le `run-document-server.sh` en amont a sa
  propre porte de disponibilité séparée, `waiting_for_connection()`, qui exécute inconditionnellement
  `nc -z "$DB_HOST" "$DB_PORT"`. `nc` ne peut pas résoudre un chemin de système de fichiers en tant qu'hôte TCP,
  donc non corrigé, cela boucle indéfiniment (`Waiting for connection to the /cloudsql/... host
  on port 5432` se répétant dans Cloud Logging) et le conteneur ne devient jamais prêt.
  Le Dockerfile du module `sed -i` corrige cette porte pour qu'elle se court-circuite avec succès
  lorsque `$1` est un répertoire existant, laissant la vérification `nc` originale inchangée pour
  les hôtes TCP réels — donc GKE (dont le sidecar Auth Proxy écoute sur `127.0.0.1`) n'est
  pas affecté et n'a pas besoin de correctif. Une assertion `grep -q` juste après le `sed` fait
  échouer bruyamment le Cloud Build si une future augmentation de `ONLYOFFICE_VERSION` modifie la formulation du
  script en amont — voir `modules/OnlyOffice_Common/scripts/Dockerfile`.
- **Pas de flux d'inscription traditionnel.** Document Server n'est généralement pas ouvert directement par
  les utilisateurs finaux — il est intégré via des appels API depuis une application hôte (Nextcloud,
  ownCloud, une intégration personnalisée) utilisant le secret JWT partagé. Il n'y a pas de compte administrateur
  à créer au premier démarrage ; la disponibilité est confirmée via `/healthcheck` et par
  l'application hôte ouvrant avec succès un document pour la co-édition.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/healthcheck` — le point de terminaison de Document
  Server qui renvoie `true` seulement une fois que nginx et les services de documents sont
  opérationnels et que la base de données est accessible, servie sans authentification. Prévoyez plusieurs minutes au
  premier démarrage (délai initial de 90 secondes, période de 15 secondes, jusqu'à 40 échecs — environ
  10 minutes de marge pendant que la pile groupée démarre et que le schéma s'installe).
- **WOPI est désactivé par défaut.** `WOPI_ENABLED = "false"` ; activez-le via
  `environment_variables` uniquement lors de l'intégration avec un hôte WOPI (par exemple SharePoint).
- **Inspecter l'exécution du job et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour OnlyOffice sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `onlyoffice` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `ONLYOFFICE Document Server` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image Document Server ; `latest` est épinglé à `8.3.3` au moment de la construction via l'ARG de build `ONLYOFFICE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Toujours personnalisé — enveloppe l'image Docker Hub `onlyoffice/documentserver` avec le point d'entrée cloud. |
| `container_image` | `""` | Laissez vide pour utiliser l'image personnalisée construite. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; la pile groupée nécessite au moins 4 Gio. |
| `cpu_always_allocated` | `false` | Facturation basée sur la demande, axée sur les coûts. Compromis : la chaleur du cache de documents et la file d'attente de conversion RabbitMQ interne se réinitialisent au démarrage à froid. Définissez `true` (+ `min_instance_count >= 1`) pour un éditeur toujours chaud. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Limites de répliques de pod/instance. |
| `container_port` | `80` | Le nginx groupé de Document Server écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Toujours vrai — met en miroir l'image de base Docker Hub dans Artifact Registry avant la construction personnalisée. |
| `container_build_config` | construire l'image wrapper | Configuration Dockerfile/build-arg ; `build_args` définit `ONLYOFFICE_VERSION` (voir Vue d'ensemble). |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements progressifs. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Répertoire du socket du proxy d'authentification. |
| `additional_services` / `additional_containers` | `[]` | Non utilisé par ce module — inerte sauf configuration explicite. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Conservez `all` à moins que tous les appelants de l'API Document Server ne soient à l'intérieur du VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les appels API de l'application hôte si activé.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `network_name` | `""` | Réseau VPC à utiliser ; découvre automatiquement un seul réseau géré par Services_GCP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `DB_TYPE`, `JWT_ENABLED`, `JWT_HEADER`, `JWT_IN_BODY`, `WOPI_ENABLED` sont définis automatiquement — ne pas écraser `JWT_ENABLED`/`JWT_HEADER`/`JWT_IN_BODY` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager au moment de la planification. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |
| `module_writable_secret_ids` | `{}` | Non utilisé par ce module (aucun hook post-installation ne réécrit les secrets). |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Non
utilisé par le déploiement OnlyOffice par défaut (l'installation du schéma est gérée par le
Document Server lui-même). Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Protège à la fois le bucket `storage` déclaré en commun et la liste `storage_buckets` propre à ce module. Par défaut `true` ici (contrairement à `false` de GKE) car Cloud Run n'a pas d'option de persistance PVC de bloc. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket(s) GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Activé par défaut — stockage partagé des pièces jointes et source de l'hôte Redis de secours. |
| `nfs_mount_path` | `/opt/onlyoffice/storage` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | VM NFS existante à utiliser, ou nom de base pour une VM inline. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Requis — un garde au moment de la planification (`validation.tf`) rejette tout sauf `POSTGRES_13`/`14`/`15`/`NONE`. MySQL n'est pas pris en charge. |
| `db_name` | `onlyoffice` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `onlyoffice` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Miroir de parité de la fondation uniquement — ce module connecte la base de données via `db_name`/`db_user` ci-dessus, pas ceux-ci ; inerte sauf si le module est recâblé. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (crée le rôle/la base de données/les autorisations ; le Document Server installe son propre schéma). |
| `cron_jobs` | `[]` | Non utilisé — OnlyOffice n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, délai de 90s, période de 15s, 40 échecs | Budget généreux au premier démarrage pour la pile groupée lourde. |
| `liveness_probe` | HTTP `/healthcheck`, délai de 120s, période de 30s, 3 échecs | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | même chemin, forme structurée | Définitions de sondes de niveau de service alternatives ; `startup_probe`/`liveness_probe` prennent effet par défaut. |
| `uptime_check_config` | `{ enabled=false, path="/healthcheck" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis** — un garde au moment de la planification rejette `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP Redis de la VM NFS colocalisée (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. OnlyOffice ajoute en plus ses propres protections croisées entre variables dans `validation.tf` : `database_type` uniquement PostgreSQL, `enable_redis` obligatoire, couplage `redis_host`/`enable_nfs`, `min_instance_count <= max_instance_count`, et cohérence `enable_cloudsql_volume` vs `database_type = "NONE"`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critique | Tout autre moteur est rejeté au moment de la planification — MySQL n'est pas pris en charge par Document Server. |
| `enable_redis` | `true` | Critique | Une protection au moment de la planification rejette `false` — sans Redis partagé, l'état de session/édition ne peut pas être coordonné entre les instances. |
| `redis_host` / `enable_nfs` | Laisser `redis_host` vide uniquement avec `enable_nfs = true` | Critique | Un `redis_host` vide avec `enable_nfs = false` échoue au moment de la planification — il n'y a pas d'hôte Redis à résoudre. |
| `JWT_SECRET` (auto-généré) | Ne jamais changer après l'existence d'intégrations | Critique | Le faire pivoter rompt chaque application hôte (Nextcloud/ownCloud/etc.) intégrant l'éditeur jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans sauvegarde valide fait échouer le job d'importation. |
| `memory_limit` | `4Gi` | Élevé | La pile Postgres-client/Redis-client/RabbitMQ/nginx/converter fournie sous `supervisord` est lourde ; un sous-dimensionnement risque un OOM pendant le démarrage ou la conversion de documents. |
| `ingress_settings` | `all` (sauf si tous les appelants sont dans le VPC) | Élevé | L'API de Document Server est normalement appelée par le backend d'une application hôte ; bloquer ce trafic rompt chaque intégration d'éditeur intégré. |
| `enable_iap` | uniquement lorsqu'aucune application hôte externe n'appelle l'API | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les appels d'API Document Server de l'application hôte. |
| `enable_cloudsql_volume` | `true` sauf `database_type = "NONE"` | Élevé | Une protection au moment de la planification rejette la combinaison `enable_cloudsql_volume = true` avec `database_type = "NONE"` — le sidecar Auth Proxy n'aurait aucune instance à laquelle se connecter. |
| `cpu_always_allocated` | `false` (coût d'abord) ou `true` pour un éditeur toujours chaud | Moyen | Avec `false` + mise à l'échelle à zéro, le cache de documents et la file d'attente de conversion RabbitMQ interne se réinitialisent à chaque démarrage à froid, ajoutant de la latence à la prochaine session d'édition. |
| `min_instance_count` | `1` pour éviter les démarrages à froid sur les sessions d'édition actives | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de première requête de mise à l'échelle de la sonde de démarrage après l'inactivité, ressentie par chaque collaborateur ouvrant un document. |
| `create_cloud_storage` / `storage_buckets` | laisser les valeurs par défaut sauf si la persistance doit être ajustée | Moyen | La définition de `create_cloud_storage = false` supprime également le bucket `storage` déclaré en commun, car les deux sont régis par le même drapeau. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'API Document Server est publiquement accessible sans protection WAF. |
| `ONLYOFFICE_VERSION` ARG de build (Dockerfile) | N'augmenter qu'après avoir confirmé que le patch de la porte de disponibilité `sed`/`grep` correspond toujours à la formulation en amont | Élevé | Le patch `sed -i` du Dockerfile à `run-document-server.sh` de `waiting_for_connection()` (faisant en sorte que le répertoire de socket Cloud SQL `DB_HOST` court-circuite la vérification `nc -z`) est protégé par une assertion `grep -q` au moment de la construction. Si une augmentation de version modifie le texte exact du script en amont, Cloud Build échoue bruyamment à cette étape — la solution consiste à mettre à jour le modèle `sed` dans `modules/OnlyOffice_Common/scripts/Dockerfile`, et non à ignorer la vérification. Non patchée, l'image du fournisseur reste bloquée indéfiniment sur Cloud Run (répétant `Waiting for connection to the /cloudsql/... host on port 5432` dans Cloud Logging) car `nc` ne peut jamais résoudre un répertoire de socket Unix comme un hôte TCP ; GKE n'est pas affecté car son sidecar Auth Proxy écoute sur un véritable hôte TCP `127.0.0.1`. |

---

Pour le comportement de base référencé partout — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à OnlyOffice
partagée avec la variante GKE — le secret JWT, le bootstrap de la base de données, l'image
et le point d'entrée du conteneur, les paramètres d'application principaux et le comportement de la sonde de santé — est décrite
dans **[OnlyOffice_Common](OnlyOffice_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : OnlyOffice sur Cloud Run](../labs/OnlyOffice_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OnlyOffice sur GKE Autopilot](OnlyOffice_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [OnlyOffice Common — Configuration d'application partagée](OnlyOffice_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Odoo sur Cloud Run](Odoo_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Plateforme ERP intégrée**.
