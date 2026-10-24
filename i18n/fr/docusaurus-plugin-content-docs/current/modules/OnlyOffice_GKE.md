---
title: "OnlyOffice sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'OnlyOffice sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OnlyOffice_GKE.md @ 1665a43e sha256:33451f2aa1dd -->

# OnlyOffice sur GKE Autopilot {#onlyoffice-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OnlyOffice_GKE.png" alt="OnlyOffice sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ONLYOFFICE Document Server est une suite bureautique collaborative en ligne open source
pour l'édition collaborative en temps réel de documents texte, de feuilles de calcul, de présentations, de PDF et de formulaires —
une alternative auto-hébergée à Google Docs / Microsoft Office Online. Il n'est généralement pas
ouvert directement par les utilisateurs finaux ; il est plutôt intégré par une application hôte (Nextcloud,
ownCloud, Seafile, ou une intégration personnalisée) via son API et un secret JWT partagé. Ce
module déploie OnlyOffice sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'OnlyOffice utilise et sur la manière de les explorer et de les
exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte OnlyOffice sur RAD, et comment cela se compare {#what-onlyoffice-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'OnlyOffice sur RAD coûte environ 150 à 223 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à OnlyOffice qui doit rester opérationnel, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour un coût minimal, le [module Cloud Run](OnlyOffice_CloudRun.md) exécute le même OnlyOffice pour environ 102 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **OnlyOffice**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **112 crédits par jour**, soit environ 3 360 par mois (environ 336 $ US au prix de la recharge, 269 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 150 $ US** (environ 223 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| ONLYOFFICE DocSpace, Startup | Gratuit | Le propre cloud hébergé d'ONLYOFFICE. Jusqu'à 3 administrateurs, 2 Go de stockage, utilisateurs gratuits illimités |
| ONLYOFFICE DocSpace, Business | 20 $/admin/mois | Le propre cloud hébergé d'ONLYOFFICE. 250 Go par administrateur, salles illimitées |
| **RAD, Cloud Run, votre propre projet** | **Environ 102 $ US**, plus 11 $ US une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 960 crédits (77-96 $ US)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](OnlyOffice_GKE.md) | RAD |

Le DocSpace d'ONLYOFFICE est tarifé par **administrateur**, et non par utilisateur éditeur, ce qui est la comparaison la plus juste avec le coût d'infrastructure fixe de RAD. Pour une petite équipe qui n'a besoin que d'un ou deux administrateurs, le niveau Startup gratuit de DocSpace ou son plan Business à 20 $/mois peut être moins cher en espèces que le coût d'exécution du projet propre de RAD — la différence est que ce module déploie le Document Server **que vous intégrez dans votre propre application**, plutôt que l'espace de travail groupé d'ONLYOFFICE, ce qui est important si vous utilisez déjà une plateforme de documents (Nextcloud, ownCloud, une application personnalisée) qui n'a besoin que du moteur d'édition.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OnlyOffice s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à OnlyOffice dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet
saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement
  à la suppression d'un module, cela ne supprime pas la base de données, la VM, le cluster ou la ressource de calcul
  un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le
  restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  lancer **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 150 $ US.** Déployez OnlyOffice, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et le temps
  pendant lequel OnlyOffice a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours atteindre
  le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart
  des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
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

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305
  crédits (30,50 $ US) dans votre propre projet, ou 275
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois qu'OnlyOffice resterait inutilisé pendant
  environ 6 jours ou plus dans votre propre projet (environ 4,99 $ US par
  jour), ou environ 2 jours ou plus dans un projet géré par RAD (112 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'OnlyOffice alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit
  OnlyOffice dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute OnlyOffice pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [tarification ONLYOFFICE DocSpace](https://www.onlyoffice.com/docspace-prices.aspx). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

L'image `onlyoffice/documentserver` est "batteries incluses" : elle regroupe ses propres
convertisseurs, nginx et RabbitMQ (AMQP) sous `supervisord`. Ce module externalise
PostgreSQL (Cloud SQL) et Redis ; le RabbitMQ intégré reste interne sur localhost.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods StatefulSet sur le port 80, 2 vCPU / 4 Gi de mémoire par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — seuls `POSTGRES_13`/`14`/`15` (ou `NONE`) passent une garde au moment du plan |
| Cache / état d'édition | Redis externe | Obligatoire — le RabbitMQ intégré reste interne, mais l'état de session/édition doit être partagé via un Redis **externe** ; par défaut, le Redis de la VM NFS colocalisée lorsque `redis_host` est vide |
| Stockage en mode bloc | Disque persistant GKE (`standard-rwo`) | PVC de 20 Gi par pod à `/var/www/onlyoffice/Data` — les données de cache/index du Document Server, que gcsfuse corromprait |
| Persistance des fichiers | Cloud Filestore (NFS) | Stockage de pièces jointes/documents partagé entre les pods à `/opt/onlyoffice/storage` |
| Stockage d'objets | Cloud Storage | Déclaré (suffixe `storage`) mais **non créé par défaut** (`create_cloud_storage = false`) — la persistance réside sur le PVC en mode bloc |
| Secrets | Secret Manager | `JWT_SECRET` auto-généré (48 caractères) ; mot de passe de la base de données géré séparément |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** `database_type` par défaut à `POSTGRES_15` ; une
  garde au moment du plan rejette tout sauf `POSTGRES_13`/`14`/`15`/`NONE` — MySQL
  n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment du plan échoue le déploiement
  si `enable_redis = false`. Avec `redis_host` laissé vide, `enable_nfs` doit rester
  `true` afin que l'IP du serveur NFS puisse servir d'hôte Redis par défaut.
- **Les données résident sur un PVC en mode bloc, pas gcsfuse.** `stateful_pvc_enabled = true` par
  défaut provisionne un PVC `standard-rwo` (SSD) de 20 Gi par pod monté à
  `/var/www/onlyoffice/Data` et sélectionne automatiquement `workload_type = "StatefulSet"` —
  les caches/index du Document Server sous ce chemin seraient corrompus sur gcsfuse.
  `create_cloud_storage` est en conséquence `false`. NFS est activé par défaut
  (`enable_nfs = true`, monté à `/opt/onlyoffice/storage`) pour le stockage partagé des pièces jointes,
  et sert également d'hôte Redis de secours.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur loopback.** Un sidecar cloud-sql-proxy
  (`enable_cloudsql_volume = true`) écoute sur `127.0.0.1:5432` ; le
  wrapper `cloud-entrypoint.sh` mappe les valeurs `DB_*` injectées sur les
  noms de variables propres au Document Server (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent
  déjà ; `DB_PWD` est défini à partir de `DB_PASSWORD`).
- **La signature JWT est activée par défaut.** `JWT_ENABLED = "true"` avec un
  `JWT_SECRET` de 48 caractères généré une fois et stocké dans Secret Manager — toute application hôte
  intégrant l'éditeur doit présenter le même secret.
- **`"latest"` est épinglé au moment du build.** Le build personnalisé dérive son tag de base d'un
  ARG de build `ONLYOFFICE_VERSION` spécifique à l'application (pas le
  `APP_VERSION` injecté par la Fondation, que le Dockerfile n'utilise pas) ; `application_version = "latest"`
  mappe à `8.3.3`.
- **La mise à l'échelle par défaut est `min=1`, `max=5`**, `session_affinity = "ClientIP"`. Chaque
  pod StatefulSet a son propre PVC indépendant — l'état d'édition/session est partagé
  via Postgres et Redis, pas le PVC.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OnlyOffice {#a-gke-autopilot--the-onlyoffice-workload}

Les pods OnlyOffice sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Parce que `stateful_pvc_enabled = true` par défaut, la charge de travail est un
**StatefulSet** avec un PVC en mode bloc de 20 Gi par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail OnlyOffice pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OnlyOffice stocke les métadonnées de documents, les versions et l'état de l'application dans une instance
gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier déploiement, le
job `db-init` crée le rôle d'application, la base de données et les autorisations — le Document
Server installe ensuite son propre schéma au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Redis externe, stockage en mode bloc (PVC) et Cloud Filestore (NFS) {#c-external-redis-block-storage-pvc--cloud-filestore-nfs}

Redis contient l'état de session/d'édition qui doit être partagé entre chaque réplica OnlyOffice
— le RabbitMQ intégré reste interne, mais Redis est externalisé et
**obligatoire** (une garde au moment du plan échoue le déploiement si `enable_redis = false`).
Avec `redis_host` laissé vide, la Fondation injecte l'IP Redis de la VM NFS colocalisée
(`enable_nfs` doit rester `true` dans ce cas) ; définissez `redis_host` explicitement pour
pointer vers une instance Redis différente. Deux couches de persistance distinctes sont câblées
à côté : un **PVC en mode bloc** par pod (`standard-rwo`, 20 Gi par défaut) monté à
`/var/www/onlyoffice/Data` pour les caches/index/polices (un véritable périphérique de bloc — gcsfuse
le corromprait), et **Cloud Filestore (NFS)** monté à
`/opt/onlyoffice/storage`, partagé entre tous les pods pour le stockage des pièces jointes/documents.

- **Console :** Compute Engine → Instances de VM (la VM colocalisée NFS/Redis) ;
  Kubernetes Engine → Stockage (PVC/StorageClass) ; Filestore → Instances.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep REDIS_SERVER
  kubectl get pvc,sc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour la façon dont `enable_redis`/`redis_host` se résolvent en
l'IP de la VM NFS, et le compromis `stateful_pvc_storage_class` SSD-vs-HDD de GKE.

### D. Cloud Storage (facultatif) {#d-cloud-storage-optional}

Un bucket `storage` est déclaré par `OnlyOffice_Common` mais **non créé** sauf si
`create_cloud_storage = true` est défini explicitement — par défaut, toute la persistance réside
sur le PVC en mode bloc et NFS ci-dessus, pas GCS.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~onlyoffice"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à OnlyOffice est généré automatiquement et stocké dans Secret
Manager : **`JWT_SECRET`** (48 caractères, pas de caractères spéciaux), qui signe chaque
requête API interne du Document Server et doit être présenté par toute application hôte
qui intègre l'éditeur. Le mot de passe de la base de données est géré séparément par la
fondation. Sur GKE, les secrets sont projetés dans les pods via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"
  gcloud secrets versions access latest --secret=<jwt-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseautage et Ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements), avec `enable_custom_domain = true` permettant un certificat géré par Google
une fois que `application_domains` est renseigné.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OnlyOffice {#3-onlyoffice-application-behaviour}

- **Configuration de la base de données au premier déploiement, pas de job de migration séparé.** Le job `db-init` s'exécute
  en utilisant `postgres:15-alpine`. Il résout l'hôte Cloud SQL (sidecar proxy sur
  `127.0.0.1`, avec repli sur l'IP privée de l'instance), attend que PostgreSQL soit
  accessible, crée/met à jour le rôle d'application (`LOGIN CREATEDB`) avec le
  mot de passe généré, crée la base de données d'application (appartenant à `postgres`, puisque
  le superutilisateur Cloud SQL ne peut pas `SET ROLE` aux rôles d'application), accorde tous les
  privilèges sur la base de données et le schéma `public`, puis signale au Auth Proxy de
  s'arrêter afin que le pod Job se termine. Il ne provisionne que le rôle/la base de données/les autorisations —
  le Document Server installe son propre schéma au premier démarrage. Le job peut être
  réexécuté en toute sécurité (`execute_on_apply = true`).
- **Utilisation du secret JWT.** `JWT_ENABLED = "true"`, `JWT_HEADER = "Authorization"`,
  `JWT_IN_BODY = "true"` sont définis par `OnlyOffice_Common` ; la valeur `JWT_SECRET`
  elle-même est injectée depuis Secret Manager (générée une fois, 48 caractères). Chaque
  appel API interne du Document Server est signé avec elle, et toute application hôte
  intégrant l'éditeur (Nextcloud, ownCloud, intégration personnalisée) doit être configurée
  avec le secret identique — ne le faites jamais pivoter après que les intégrations sont câblées.
- **Mappage des variables d'environnement DB et Redis.** `cloud-entrypoint.sh` s'exécute avant le
  lanceur amont : il définit `DB_TYPE=postgres` et `DB_PWD` à partir des
  `DB_PASSWORD` injectées (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent déjà aux
  propres noms du Document Server), et mappe `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` sur
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASS` avant de `exec`-er
  `/app/ds/run-document-server.sh`.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /healthcheck` (délai initial de 90s,
  période de 15s, jusqu'à 40 échecs — environ 10 minutes de marge au premier démarrage pendant que
  la pile intégrée se lance et que le schéma s'installe). La sonde de vivacité est le même
  chemin avec un délai de 120s / période de 30s / 3 échecs. `/healthcheck` renvoie `true`
  seulement une fois que nginx et les services de documents sont opérationnels et que la base de données est accessible,
  et est servi sans authentification.
- **Contraintes de mise à l'échelle.** `min_instance_count = 1`, `max_instance_count = 5` par
  défaut ; `session_affinity = "ClientIP"`. Chaque pod StatefulSet a son propre
  PVC en mode bloc indépendant — les réplicas ne partagent pas le PVC, donc la mise à l'échelle est sûre tant
  que Postgres et Redis (l'état partagé) sont accessibles par chaque pod.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -E 'DB_|REDIS_SERVER|JWT_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent dans `variables.tf` (`{{UIMeta
group=N}}`). Seuls les paramètres spécifiques ou notables pour OnlyOffice sont listés ; toutes les
autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement standard et
leurs valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `onlyoffice` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `onlyoffice/documentserver` ; `latest` est épinglé à `8.3.3` au moment du build via l'ARG de build `ONLYOFFICE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `80` | Le nginx intégré écoute sur le port 80. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | La pile intégrée (client Postgres/client Redis/RabbitMQ/nginx/convertisseurs sous `supervisord`) nécessite au moins 4 Gi. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Limites des réplicas de pods. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback `127.0.0.1:5432`) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur/API OnlyOffice. |
| `workload_type` | `null` → `StatefulSet` | Sélectionné automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod pendant une session. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Les données de cache/index du Document Server doivent résider sur un PVC en mode bloc — gcsfuse les corromprait. Sélectionne automatiquement `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/var/www/onlyoffice/Data` | Le répertoire de données du Document Server. |
| `stateful_pvc_storage_class` | `standard-rwo` | Par défaut, basé sur SSD ; remplacez par `standard` (HDD) si le quota `SSD_TOTAL_GB` du projet est serré. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, délai de 90s, période de 15s, 40 échecs | Budget généreux au premier démarrage — la pile intégrée est lente à devenir prête. |
| `liveness_probe` | HTTP `/healthcheck`, délai de 120s, période de 30s, 3 échecs | Redémarre un pod bloqué après le démarrage. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Stockage partagé des pièces jointes ; également la source d'hôte Redis par défaut lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/onlyoffice/storage` | Où OnlyOffice stocke les pièces jointes partagées. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Désactivé par défaut — la persistance réside sur le PVC en mode bloc et NFS, pas GCS. Définissez `true` uniquement si vous avez besoin d'un bucket simple supplémentaire. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis** — une garde au moment du plan rejette `false`. |
| `redis_host` | `""` (→ IP du serveur NFS) | Laissez vide pour utiliser le Redis de la VM NFS colocalisée ; `enable_nfs` doit être `true` dans ce cas. |
| `redis_port` | `6379` | Port TCP Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Requis — une garde au moment du plan rejette tout sauf `POSTGRES_13`/`14`/`15`/`NONE`. MySQL n'est pas pris en charge. |
| `application_database_name` | `onlyoffice` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `onlyoffice` | Utilisateur de la base de données d'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour le routage de domaine personnalisé (activé par défaut, contrairement à la plupart des applications). |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |
| `network_tags` | `["nfsserver"]` | Tag requis pour le chemin de colocation NFS/Redis par défaut. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre OnlyOffice. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données d'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides sauf si `create_cloud_storage = true`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment du plan — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers nus, un `container_port`/`backup_retention_days` hors de portée. OnlyOffice ajoute en outre ses propres gardes (PostgreSQL uniquement `database_type`, `enable_redis` obligatoire, couplage `redis_host`/`enable_nfs`). Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critique | Tout autre moteur est rejeté au moment du plan — MySQL n'est pas pris en charge par Document Server. |
| `enable_redis` | `true` | Critique | Une garde au moment du plan rejette `false` — sans Redis partagé, l'état de session/d'édition ne peut pas être coordonné entre les pods. |
| `redis_host` / `enable_nfs` | Laissez `redis_host` vide uniquement avec `enable_nfs = true` | Critique | `redis_host` vide avec `enable_nfs = false` échoue au moment du plan — il n'y a pas d'hôte Redis à résoudre. |
| `JWT_SECRET` (auto-généré) | Ne jamais modifier après l'existence d'intégrations | Critique | Le faire pivoter rompt toutes les applications hôtes (Nextcloud/ownCloud/etc.) intégrant l'éditeur jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `stateful_pvc_enabled` | `true` | Élevé | Le désactiver (ou forcer `workload_type = "Deployment"` à côté) risque de corrompre les données de cache/index par gcsfuse — ou échoue au moment du plan si forcé. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) ou `standard` (HDD) sous quota serré | Moyen | Le SSD utilise le quota `SSD_TOTAL_GB` serré ; une vaste campagne d'applications avec état peut l'épuiser — voir [App_GKE](App_GKE.md). |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE. |
| `container_resources.memory_limit` | `4Gi` | Élevé | La pile intégrée Postgres/client Redis/RabbitMQ/nginx/convertisseur sous `supervisord` est lourde ; un sous-dimensionnement risque un OOM au démarrage. |
| `max_instance_count` | `5` (ajuster à la charge) | Moyen | La charge de travail du convertisseur de chaque pod est intensive en CPU/mémoire ; une mise à l'échelle trop élevée sans marge risque une pression sur les nœuds sous Autopilot. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et toute URL de rappel d'intégration enregistrée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

{/* TODO: verify whether enable_custom_domain=true with an empty application_domains list falls back to a nip.io hostname on the reserved LoadBalancer IP, or leaves the Ingress unconfigured until a domain is set. */}

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à OnlyOffice partagée avec la variante Cloud Run est
décrite dans **[OnlyOffice_Common](OnlyOffice_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : OnlyOffice sur GKE Autopilot](../labs/OnlyOffice_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OnlyOffice Common — Configuration d'application partagée](OnlyOffice_Common.md) — la configuration partagée par les deux cibles de déploiement.
