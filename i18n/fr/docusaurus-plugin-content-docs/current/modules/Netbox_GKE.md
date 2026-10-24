---
title: "NetBox sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de NetBox sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Netbox_GKE.md @ e69407af sha256:dbb43b73beba -->

# NetBox sur GKE Autopilot {#netbox-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netbox_GKE.png" alt="NetBox sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

NetBox est la « source de vérité » open source standard de l'industrie pour les
équipes d'ingénierie réseau — gestion des adresses IP (IPAM), inventaire des
appareils et des racks, câblage et topologie réseau, le tout modélisé sous
forme de données structurées derrière une API REST/GraphQL complète. Ce module
déploie NetBox sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par NetBox et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Netbox sur RAD, et comment cela se compare {#what-netbox-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Netbox sur RAD coûte environ 143 à 216 $ US par mois, avec les frais de module facturés une seule fois en crédits RAD.** GKE Autopilot convient à Netbox qui doit rester opérationnel, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Netbox_CloudRun.md) exécute le même Netbox pour environ 99 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Netbox**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (18 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **143 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **113 crédits par jour**, environ 3 390 par mois (environ 339 $ US au prix de la recharge, 271 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 143 $ US** (environ 216 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Netbox lui-même**, la comparaison honnête est donc un serveur auto-géré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Aucune offre SaaS gérée pour ce projet open source exact n'a pu être vérifiée avec un prix actuel et publié, donc aucun chiffre n'est donné ici. Pour la documentation d'infrastructure et l'IPAM, le choix réaliste pour la plupart des équipes est l'auto-hébergement (NetBox est déjà gratuit et open source) contre le paiement du temps d'un ingénieur pour maintenir cette copie auto-hébergée patchée et sauvegardée, ce qui est le fossé que la base de données Cloud SQL gérée et l'automatisation de RAD comblent.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, vous êtes également celui qui patche le système d'exploitation, fait tourner les sauvegardes et maintient la base de données (le cas échéant) en bonne santé. Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent cela pour vous, ce qui est le véritable argument en faveur de RAD par rapport à une boîte moins chère — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Netbox s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Netbox dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, la VM, le cluster ou la ressource de calcul un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 143 $ US.** Déployez Netbox, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et le temps pendant lequel Netbox a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Netbox et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US) dans votre propre projet, ou 162 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Netbox resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 4,75 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD (113 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Netbox alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Netbox dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Netbox pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

NetBox s'exécute en tant que pod Python/Django personnalisé sur GKE Autopilot,
enveloppant l'image officielle `netboxcommunity/netbox` avec un processus
d'arrière-plan co-localisé `rqworker --with-scheduler`. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods d'images personnalisées, 2 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — NetBox ne prend pas en charge MySQL ou SQLite en production |
| Stockage d'objets | Cloud Storage (GCS Fuse CSI) | Un bucket `media` monté à `/etc/netbox/media`, le véritable `MEDIA_ROOT` de NetBox |
| Cache et file d'attente | Redis (obligatoire) | File d'attente de tâches (`REDIS_DATABASE=0`) et cache (`REDIS_CACHE_DATABASE=1`) sur des bases de données logiques distinctes ; par défaut, l'adresse IP du serveur NFS |
| Secrets | Secret Manager | `SECRET_KEY` et `SUPERUSER_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; NetBox ne prend pas en charge MySQL ou
  SQLite pour une utilisation en production.
- **Redis est obligatoire, pas facultatif.** NetBox utilise Redis comme
  courtier pour son système de tâches d'arrière-plan RQ (Redis Queue) —
  webhooks, scripts personnalisés, rapports et tâches planifiées/système — et
  comme backend de cache, sur **deux bases de données logiques distinctes**
  (`REDIS_DATABASE=0`, `REDIS_CACHE_DATABASE=1`).
- **Un worker d'arrière-plan est co-localisé dans le même pod.** `manage.py rqworker
  --with-scheduler` s'exécute en tant que processus d'arrière-plan à côté du
  serveur web Granian. Sans lui, les tâches d'arrière-plan s'accumulent
  silencieusement et ne s'exécutent jamais.
- **Les téléchargements de médias sont montés sur le `MEDIA_ROOT` réel de
  NetBox.** `/etc/netbox/media`, confirmé en direct via
  `manage.py shell`. Voir §3 pour l'histoire complète de la façon dont ce
  chemin a été trouvé et pourquoi un chemin antérieur, d'apparence plausible,
  était erroné.
- **Les options `uid=0`/`gid=0` du montage GCS Fuse sont
  porteuses de charge sur GKE.** L'intégration GCS Fuse de Cloud Run applique
  toujours un `uid:1000/gid:1000` par défaut, quelle que soit la
  configuration (root peut y écrire de toute façon) ; le pilote CSI GCS Fuse de
  GKE n'a pas un tel défaut, donc l'épingle explicite
  `uid=0`/`gid=0` — correspondant au conteneur
  s'exécutant en tant que root de NetBox — est ce qui rend réellement le
  montage inscriptible.
- **Pas de mise à l'échelle à zéro.** GKE Autopilot exécute toujours au moins
  `min_instance_count` réplicas (par défaut `1`),
  maintenant le worker RQ continuellement actif.
- **Le conteneur s'exécute en tant que root** (uid 0 / gid 0) — l'image
  officielle `netboxcommunity/netbox` ne définit pas de
  `USER`.
- **`SECRET_KEY` et `SUPERUSER_PASSWORD` sont générés
  automatiquement** et stockés dans Secret Manager.
- **Les sondes de santé utilisent `/login/`, pas `/api/status/`.** La page de connexion est publique et non authentifiée ;
  l'API de statut nécessite une authentification et échouerait à chaque sonde.
- **`service_type = "LoadBalancer"` et `reserve_static_ip = true` sont les valeurs par
  défaut** — publiques par défaut. Passez à `service_type = "ClusterIP"` et
  `reserve_static_ip = false` pour un déploiement interne uniquement accessible via
  `kubectl port-forward` (utile lorsque le quota d'adresses IP statiques du
  projet est limité).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail NetBox {#a-gke-autopilot--the-netbox-workload}

Les pods NetBox sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods ajuste la
taille du déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail NetBox pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle
et le type de charge de travail (Déploiement vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NetBox stocke toutes les données d'inventaire et d'IPAM (appareils, racks,
adresses IP, préfixes, VLAN, circuits, utilisateurs) dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Les pods y accèdent en privé via le sidecar
**Cloud SQL Auth Proxy** sur un socket Unix (exposé au conteneur sous forme de
boucle locale `127.0.0.1`) ; aucune IP publique n'est exposée. Lors du
premier déploiement, un Job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage (magasin de médias GCS Fuse) {#c-cloud-storage-gcs-fuse-media-store}

Un bucket `media` dédié est provisionné automatiquement et monté via le
pilote CSI GCS Fuse à `/etc/netbox/media` — le véritable `MEDIA_ROOT` de
NetBox — pour les images d'appareils/racks téléchargées et les pièces jointes.
Le montage est épinglé à `uid=0`/`gid=0` pour
correspondre à l'utilisateur root du conteneur ; sans cela, la propriété de
montage par défaut du pilote CSI GKE bloque les écritures.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Verify a real upload landed in GCS (not just the pod's local filesystem):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /etc/netbox/media
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et le réglage du montage GCS
Fuse.

### D. Redis (file d'attente de tâches et cache) {#d-redis-task-queue-and-cache}

Redis est **obligatoire** (`enable_redis = true` par défaut). Lorsque
`redis_host` est vide et `enable_nfs` est vrai, l'adresse IP de la VM du serveur NFS est
utilisée comme point de terminaison Redis. NetBox répartit son utilisation sur
deux bases de données logiques — `REDIS_DATABASE=0` pour la file d'attente de
tâches RQ, `REDIS_CACHE_DATABASE=1` pour le cache.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> -n 0 llen rq:queue:default   # inspect the RQ default queue depth
  # Confirm the resolved Redis host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY` (secret cryptographique Django utilisé
pour les sessions, CSRF et les cookies signés) et `SUPERUSER_PASSWORD` (le mot
de passe du compte administrateur initial). Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements. Pour un déploiement interne uniquement (par exemple,
lorsque le quota d'adresses IP statiques est limité), basculez
`service_type = "ClusterIP"` et `reserve_static_ip = false`, puis accédez au
service avec `kubectl port-forward`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Internal-only access:
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8080
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte facultatives sont disponibles (les vérifications de disponibilité
nécessitent un point de terminaison accessible publiquement).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application NetBox {#3-netbox-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` à l'aide de
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de
  manière idempotente la base de données et l'utilisateur de l'application et
  accorde les privilèges. Le job peut être réexécuté en toute sécurité.
- **Migrations de base de données au démarrage.** `docker-entrypoint.sh true` exécute
  la propre séquence de premier démarrage de NetBox de manière synchrone à
  chaque démarrage de conteneur — attente de la base de données,
  `migrate --no-input`, nettoyage des types de contenu obsolètes, nettoyage des
  sessions et réindexation paresseuse de l'index de recherche — avant le
  démarrage du serveur web et du worker RQ.
- **Le bootstrap du superutilisateur est idempotent.** Le compte
  administrateur initial est créé à partir des variables d'environnement
  `SUPERUSER_*` lors du premier démarrage ; la création est ignorée —
  ce n'est pas une erreur — si un utilisateur portant ce nom existe déjà.
- **Les téléchargements de médias persistent sur le véritable
  `MEDIA_ROOT` — et c'est là que `kubectl
  exec` a fait ses
  preuves.** Le `MEDIA_ROOT` réel de NetBox est
  `/etc/netbox/media` (confirmé via `manage.py shell` sur un pod en
  direct), où le volume `media` GCS Fuse est monté. Avant que cela
  ne soit tracé, les téléchargements sur les deux plateformes semblaient
  fonctionner — un `201`, et le fichier était même lisible
  immédiatement via l'application — mais `gcloud storage ls` sur le bucket
  sous-jacent montrait **zéro objet**, même 50 minutes ou plus après le
  téléchargement. Un test de contrôle a exclu la latence d'écriture de gcsfuse
  et la contention multi-worker. Obtenir un véritable accès shell au pod en
  cours d'exécution (`kubectl exec ... manage.py shell` pour imprimer le propre
  paramètre `MEDIA_ROOT` résolu de NetBox) est ce qui a réellement
  résolu le problème : le module montait le bucket GCS à un chemin différent,
  d'apparence plausible (`/opt/netbox/netbox/media`), de celui où le propre
  `configuration.py` de NetBox écrit réellement. Chaque téléchargement
  atterrissait silencieusement sur le système de fichiers local éphémère du
  pod — lisible immédiatement car le lecteur et l'écrivain étaient le même
  disque local, mais jamais durable, et disparu au prochain redémarrage. Corrigé
  en corrigeant le chemin de montage ; revérifié en direct avec
  `gcloud storage ls` montrant le fichier de test téléchargé avec la taille
  en octets, le type de contenu et l'horodatage corrects en 5 secondes. **Ce
  n'est pas un écart de plateforme Cloud Run/GKE** — le bogue identique
  existait sur les deux plateformes, et Cloud Run n'offre pas d'accès shell
  pour le diagnostiquer comme le fait `kubectl exec` de GKE ; si cela
  n'avait été testé que sur Cloud Run, cela aurait ressemblé exactement à une
  limitation de plateforme irréparable.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell \
    -c "from django.conf import settings; print(settings.MEDIA_ROOT)"
  ```
- **Le worker RQ traite les tâches d'arrière-plan.** Les webhooks, les scripts
  personnalisés, les rapports et les tâches planifiées/système sont exécutés
  par `manage.py rqworker
  --with-scheduler`, co-localisé dans le même pod que le serveur web.
  Contrairement à Cloud Run, GKE maintient au moins `min_instance_count` pods en
  cours d'exécution en continu (pas de mise à l'échelle à zéro), de sorte que
  le worker est toujours actif par défaut.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/login/` — la page de connexion publique et non authentifiée de
  NetBox. `/api/status/` nécessite une authentification et échouerait à
  chaque sonde.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
NetBox sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netbox` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `NetBox - Network Documentation & IPAM` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de version de l'image du conteneur, transmis à l'ARG de build `APPLICATION_VERSION` du Dockerfile. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; partagé par le serveur web et le worker RQ. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `container_port` | `8080` | Le serveur Granian (WSGI) de NetBox écoute sur le port 8080. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE n'a pas de mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Réplicas maximum. |
| `enable_vertical_pod_autoscaling` | `false` | Désactive HPA lorsqu'il est activé pour éviter les conflits. |
| `enable_pod_disruption_budget` / `pdb_min_available` | `false` / `1` | Protection de la disponibilité pendant la maintenance des nœuds. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `SECRET_KEY`, `SUPERUSER_PASSWORD` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. Utilisez `ClusterIP` pour un usage interne uniquement. |
| `workload_type` | `Deployment` (auto) | `Deployment` (par défaut sans état) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions d'interface utilisateur. |
| `network_tags` | `["nfsserver"]` | Requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `gke_cluster_name` / `namespace_name` | auto-découverte | Laisser vide pour l'auto-découverte / l'auto-génération. |
| `deployment_timeout` | `1800` | Secondes maximales que Terraform attend pour le déploiement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC par pod. Non défini, donc la propre logique de résolution de `App_GKE` s'applique — l'état persistant de NetBox est Cloud SQL + GCS, donc aucun PVC n'est nécessaire. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | (par défaut) | Taille du PVC, chemin de montage, StorageClass. |
| `stateful_headless_service` | `null` | Noms DNS de pod stables. Non défini, donc la propre logique de résolution de `App_GKE` s'applique ; n'a de sens qu'avec un StatefulSet. |
| `stateful_pod_management_policy` | `null` (effectif : `OrderedReady`) | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` (effectif : `RollingUpdate`) | `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Scripts SQL personnalisés {#group-8--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 11 — Jobs et services {#group-11--jobs--services}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services Kubernetes supplémentaires déployés avec NetBox. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore ; utilisé comme hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires au-delà du bucket média auto-provisionné. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS Fuse CSI. Lorsqu'il est vide, un volume média par défaut est auto-monté à `/etc/netbox/media` avec des options `uid=0`/`gid=0` explicites — porteuses de charge sur GKE, contrairement à Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Paramètres de l'application NetBox {#group-15--netbox-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `time_zone` | `UTC` | Fuseau horaire pour les horodatages et les tâches planifiées de NetBox. |
| `admin_user` | `admin` | Nom d'utilisateur du superutilisateur auto-créé. La création est idempotente. |
| `admin_email` | `admin@example.com` | E-mail du superutilisateur auto-créé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `netbox` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `netbox` | Utilisateur de la base de données de l'application. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé / `90` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Non applicable — NetBox utilise PostgreSQL. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Routage de l'API Gateway + certificat SSL géré pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable lors des redéploiements. Définir `false` (avec `service_type = "ClusterIP"`) pour un déploiement interne uniquement, sans IP externe. |
| `static_ip_name` | `""` | Laisser vide pour générer automatiquement. |

### Groupe 20 — Proxy d'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant NetBox. Nécessite `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et cache Redis {#group-21--cloud-armor--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |
| `enable_redis` | `true` | **Obligatoire.** Prend en charge la file d'attente de tâches RQ et la couche de cache de NetBox. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Observabilité et santé (spécifiques à NetBox, remplaçant les sondes génériques App_GKE) {#observability--health-netbox-specific-superseding-the-generic-app_gke-probes}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/login/`, délai de 60s, seuil d'échec de 60 | Sonde de démarrage spécifique à NetBox. |
| `liveness_probe` | HTTP `/login/`, fenêtre d'échec de 30s | Sonde de vivacité spécifique à NetBox. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring facultative — n'a de sens que lorsque le service est accessible publiquement. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, des valeurs `redis_port`/`backup_retention_days` hors limites, des valeurs `quota_memory_*` entières brutes. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Chemin de montage `gcs_volumes` (défini automatiquement sur `/etc/netbox/media`) | Ne jamais remplacer par un chemin différent, sauf si vous avez confirmé le vrai `MEDIA_ROOT` de NetBox | Critique | Un chemin de montage incorrect laisse les téléchargements sur le système de fichiers éphémère du pod — lisibles immédiatement, mais perdus silencieusement à chaque redémarrage. Confirmé et corrigé sur ce module exact. |
| Montage GCS Fuse `uid`/`gid` (défini automatiquement sur `0`/`0`) | Correspondre à l'UID d'exécution réel du conteneur | Critique | Sur GKE (contrairement à Cloud Run), un montage non épinglé est par défaut la propriété de root ; un processus non-root obtiendrait `EACCES` à chaque écriture. Le conteneur de NetBox s'exécute déjà en tant que root, donc ceci est appliqué de manière défensive. |
| `SECRET_KEY` (généré automatiquement) | Ne jamais faire pivoter après le premier démarrage | Critique | Invalide toutes les sessions actives et les cookies signés ; NetBox impose également une longueur minimale de 50 caractères. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` | `true` (obligatoire) | Critique | Le système de tâches en arrière-plan et la couche de cache de NetBox ne fonctionnent pas sans Redis. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, le traitement en arrière-plan ne s'exécute jamais silencieusement. |
| `REDIS_DATABASE` / `REDIS_CACHE_DATABASE` | Garder séparés (`0` / `1`) | Élevé | Le partage d'une base de données Redis logique risque de perdre les tâches en arrière-plan en file d'attente lors d'un vidage du cache. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1Gi risquent des arrêts OOM, en particulier avec le worker RQ colocalisé dans le même pod. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; le maintenir à 1 garantit que NetBox et le worker RQ sont toujours disponibles. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL. |
| `service_type` / `reserve_static_ip` | Public par défaut ; `ClusterIP`/`false` pour usage interne uniquement | Moyen | Le passage à un usage interne uniquement échange l'accessibilité publique contre une consommation de quota d'IP statiques plus faible — vérifiez ce qui est réellement nécessaire avant le déploiement. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions d'interface utilisateur en cours peuvent être acheminées vers un pod différent en cours de requête. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_pod_disruption_budget` | `true` pour la production | Moyen | Désactivé par défaut ; sans cela, GKE peut expulser tous les pods simultanément pendant la maintenance des nœuds. |

---

Pour le comportement de la base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à NetBox
partagée avec la variante Cloud Run est décrite dans **[Netbox_Common](Netbox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NetBox sur GKE Autopilot](../labs/Netbox_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [NetBox sur Google Cloud Run](Netbox_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [NetBox Common — Configuration d'application partagée](Netbox_Common.md) — la configuration partagée par les deux cibles de déploiement.
