---
title: "OpenEMR sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'OpenEMR sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenEMR_GKE.md @ e69407af sha256:afa989221cac -->

# OpenEMR sur GKE Autopilot {#openemr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_GKE.png" alt="OpenEMR sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenEMR est le système de gestion des dossiers médicaux électroniques (DME) et de
gestion de cabinet open source le plus largement adopté au monde, utilisé par plus de
100 000 professionnels de la santé dans plus de 100 pays. Ce module déploie OpenEMR sur
**GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par OpenEMR et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte OpenEMR sur RAD, et comparaison {#what-openemr-costs-on-rad-and-how-that-compares}

**Pour un petit cabinet, OpenEMR sur le module GKE Autopilot de RAD coûte environ 150 $ US par mois, sans licence par utilisateur.** GKE convient à un OpenEMR qui doit rester disponible pendant les heures d'ouverture de la clinique, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes. Pour le coût le plus bas, le [module Cloud Run](OpenEMR_CloudRun.md) exécute le même OpenEMR pour environ 181 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 150 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **112 crédits par jour**, soit environ 3 360 crédits par mois (environ 336 $ US au prix de la recharge, 269 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum de crédits achetés est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 150 $ US**, ou environ 223 $ US sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, il ne s'applique donc que si c'est votre seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1 (Johannesburg) ; le pod et la VM coûtent environ 10 % de plus là-bas.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod OpenEMR fonctionne toujours, donc le coût ci-dessus est le même que quelqu'un l'utilise ou non ; des pods supplémentaires ne sont ajoutés qu'en cas de charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comparaison {#how-it-compares}

- **Aucun SaaS OpenEMR commercial vérifié n'est nommé ici.** La plupart des offres OpenEMR hébergées sont de petits revendeurs régionaux sans liste de prix publique et actuelle, donc cette comparaison se fait plutôt avec un serveur nu.
- Un VPS nu dimensionné près de l'empreinte propre à OpenEMR de 2 vCPU / 4 GiB — Hetzner CPX22 ou un Droplet DigitalOcean de 2 vCPU/4 Go, tous deux à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois — semble moins cher en espèces que les deux chiffres RAD ci-dessus.
- La différence réside dans ce qui est géré pour vous. Les données des patients sont stockées dans Cloud SQL avec des sauvegardes quotidiennes et sept jours de récupération ponctuelle ; les secrets vivent dans Secret Manager ; les journaux et la surveillance proviennent de Google Cloud. Sur un VPS nu, les sauvegardes, les correctifs du système d'exploitation, les mises à niveau de la base de données et la journalisation des accès sont votre propre travail.
- RAD n'est pas l'option la moins chère en termes d'argent — un VPS nu l'est généralement — mais pour un système de dossiers de santé, qui corrige le serveur et qui peut voir les sauvegardes n'est pas un détail à négliger.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenEMR fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du
projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux
à une utilisation occasionnelle — étudier pour une certification, un environnement de
démonstration, une activité saisonnière — que de faire fonctionner OpenEMR en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou le cluster
  GKE un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête
  simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  récupérer le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une
  mise à jour ne facture plus jamais les frais de module. Cela coûte une poignée de
  crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les
  305 crédits (30,50 $ US) qu'un redéploiement complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 150 $
  US.** Déployez OpenEMR, utilisez-le un certain temps, supprimez le projet.
  Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de
  module une seule fois, les builds, et le temps pendant lequel OpenEMR était
  réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement. La
  restauration est admise comme la création d'un nouveau projet : votre solde de
  crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
  niveau sandbox que la plupart des utilisations d'étude et de démo conviennent).
  Google indique que la plupart des services fonctionnent à nouveau pleinement dans les
  36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  d'OpenEMR sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est
  **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très
  probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
  lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à
  OpenEMR que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un
  bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de
  redéploiement ci-dessous. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne s'adapte pas à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois que la
fenêtre de 30 jours est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 305 crédits (30,50 $ US), car RAD recrée le projet et les services
  partagés avant OpenEMR. La suppression ne permet d'économiser de l'argent que si
  OpenEMR resterait inutilisé pendant environ 7 jours ou plus, à la fois dans votre
  propre projet (environ 4,99 $ US par jour) et dans un projet géré par RAD (112
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM
  de fichier/cache partagée.** Ils ne s'arrêtent que lorsque rien d'autre dans le
  projet ne les utilise, donc la suppression d'OpenEMR pendant que quelque chose
  d'autre partage le projet n'économise que la partie calcul d'OpenEMR.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à
  l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
  dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous entrez à nouveau les
  paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google Cloud
  pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie
  la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés
  retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements
  deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais de
RAD et les estimations de crédits quotidiens ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage
sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

OpenEMR s'exécute comme une charge de travail Apache/PHP 8.3 FPM sur Alpine 3.20. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Apache/PHP, 2 vCPU / 4 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — OpenEMR ne prend pas en charge PostgreSQL |
| Documents patient | Filestore (NFS) | Répertoire `sites/` avec les documents patient, le cache de session et l'état de l'application partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket de données à usage général |
| Stockage de session | Redis | Activé par défaut ; revient à l'adresse IP du serveur NFS si aucun hôte Redis n'est spécifié |
| Secrets | Secret Manager | Mot de passe administrateur (`OE_PASS`) et mot de passe de base de données (`MYSQL_PASS`) générés automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; la sélection
  de PostgreSQL ou `NONE` interrompt le démarrage.
- **NFS est obligatoire.** Le répertoire `sites/` d'OpenEMR — contenant
  `sqlconf.php`, les documents patient, les caches Twig/Smarty et les fichiers
  téléchargés — doit se trouver sur un volume NFS partagé. L'application ne peut pas
  fonctionner sans lui.
- **Redis est activé par défaut.** Lorsque `max_instance_count > 1`, un stockage de session
  partagé est requis pour éviter la perte de session PHP entre les pods.
- **L'affinité de session est `ClientIP`.** OpenEMR s'appuie sur les sessions PHP,
  donc les requêtes d'un navigateur sont épinglées à un pod.
- **L'installation au premier démarrage est automatisée et lente.** Lors du premier
  déploiement, trois jobs d'initialisation s'exécutent en séquence : `nfs-init`
  (configuration du répertoire NFS), `db-init` (création de l'utilisateur et de la
  base de données MySQL) et `openemr-install` (installation du schéma via
  `auto_configure.php`). La sonde de démarrage autorise jusqu'à 120 secondes pour que
  l'application soit prête après la fin des jobs.
- Le **mot de passe administrateur** d'OpenEMR est généré automatiquement et stocké
  dans Secret Manager ; vous ne le définissez jamais en texte clair.
- **`min_instance_count` est par défaut à 1.** La mise à l'échelle à zéro n'est pas
  recommandée pour les systèmes DME cliniques — les démarrages à froid ajoutent 20 à
  40 secondes de latence que les cliniciens peuvent interpréter comme une défaillance
  du système.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenEMR {#a-gke-autopilot--the-openemr-workload}

Les pods OpenEMR sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail OpenEMR pour voir les pods, les événements et l'état de la sonde. Kubernetes
  Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

OpenEMR stocke toutes les données cliniques (dossiers patients, planification,
facturation) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte
qu'aucune IP publique n'est exposée. Lors du premier déploiement, le job
`db-init` crée la base de données et l'utilisateur de l'application avant que le
job `openemr-install` n'exécute l'installateur de schéma OpenEMR.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la
rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `sites/` d'OpenEMR est écrit sur un partage **Filestore (NFS)** monté
dans chaque pod à `/var/www/localhost/htdocs/openemr/sites`. Ce répertoire contient `sqlconf.php` (qui signale
l'achèvement de l'installation), les documents téléchargés par les patients, les caches
de modèles Twig/Smarty et les données de session. Tous les réplicas doivent partager le
même montage NFS. Un bucket **Cloud Storage** à usage général est également
provisionné.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  # Confirm the NFS share is mounted and sites directory exists:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    ls /var/www/localhost/htdocs/openemr/sites/default/
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Stockage de session Redis {#d-redis-session-store}

Redis prend en charge le stockage de session PHP d'OpenEMR. Lorsque `redis_host` est
laissé vide et que NFS est activé, l'instance Redis colocalisée du serveur NFS est
utilisée automatiquement. Dans les déploiements multi-réplicas, un stockage de session
partagé est requis pour éviter la perte de session.

- **Console :** Memorystore → Redis (si vous utilisez une instance Memorystore gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_SERVER is set inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur d'OpenEMR (`OE_PASS`) et le mot de passe de la base de
données MySQL (`MYSQL_PASS`) sont stockés en tant que secrets Secret Manager et
injectés dans les pods au moment de l'exécution via le pilote CSI Secret Store. Le
texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password to log in for the first time:
  gcloud secrets versions access latest \
    --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

L'ID du secret du mot de passe administrateur est exposé en tant que sortie
`admin_password_secret_id`. Le nom du secret du mot de passe de la base de données se trouve dans
`database_password_secret`. Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret
Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé,
et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Test the login page from within the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost/interface/login/login.php
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques
GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenEMR {#3-openemr-application-behaviour}

- **Initialisation en trois étapes au premier déploiement.** Les jobs Kubernetes
  suivants s'exécutent en séquence à chaque apply :

  | Job | But | Dépend de |
  |---|---|---|
  | `nfs-init` | Prépare la structure du répertoire NFS `sites/`, définit la propriété à l'UID 1000 (Apache) et restaure éventuellement une sauvegarde | — |
  | `db-init` | Crée la base de données MySQL et l'utilisateur de l'application | — |
  | `openemr-install` | Exécute `auto_configure.php` en mode `K8S=admin` pour installer le schéma de la base de données et créer le compte administrateur ; écrit `$config=1` dans `sqlconf.php` sur NFS | `nfs-init`, `db-init` |

  Le pod de l'application principale ne démarre qu'après que `openemr-install` soit terminé
  et qu'il voie `$config=1` dans `sqlconf.php` — il ignore alors l'installateur et
  commence à servir. Inspectez les jobs :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/nfs-init
  kubectl logs -n "$NAMESPACE" job/openemr-install
  ```

- **Le démarrage peut prendre 5 à 20 minutes au premier boot.** Le job `openemr-install`
  exécute l'installateur de schéma PHP complet, ce qui est lent. La sonde de démarrage
  (TCP sur le port 80, seuil de 12 échecs) autorise 120 secondes pour que le pod soit
  prêt après la fin des jobs. Lors d'une installation vraiment fraîche, envisagez
  d'augmenter `failure_threshold` dans la sonde de démarrage.

- **Mises à niveau conscientes de la version.** Lors des déploiements ultérieurs, le
  script de démarrage compare la version de l'image à la version stockée sur NFS et
  exécute automatiquement les scripts de mise à niveau appropriés
  (`fsupgrade-N.sh`).

- **Serveur de sonde de santé temporaire.** Pendant la phase d'installation,
  `openemr.sh` démarre un serveur web PHP intégré sur le port 80 qui renvoie HTTP
  200 sur le chemin de la sonde de santé, empêchant le pod d'être tué pendant
  l'exécution de l'installateur.

- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  `admin`. Le mot de passe est généré automatiquement et stocké dans Secret
  Manager — récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```
  Si le compte administrateur est verrouillé après des tentatives de connexion
  échouées, utilisez l'utilitaire `/root/unlock_admin.sh <new_password>` à l'intérieur du conteneur.

- **Variable d'environnement `K8S=yes`.** L'application reçoit `K8S=yes` au
  moment de l'exécution, ce qui indique à `openemr.sh` d'utiliser le chemin de
  démarrage compatible Kubernetes (en ignorant les opérations récursives lentes
  `chown` qui entraîneraient des échecs de délai d'attente).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour OpenEMR sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` / `module_documentation` / `module_dependency` / `module_services` | _(défini)_ | Métadonnées du catalogue de la plateforme. |
| `credit_cost` | `300` | Crédits de plateforme consommés par déploiement. |
| `require_credit_purchases` | `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts ou d'événement. |
| `enable_purge` | `true` | Autoriser la suppression complète des ressources lors de la destruction. |
| `public_access` | `true` | Rendre le module visible dans le catalogue public. |
| `require_services_gcp_module` | `true` | Échouer au moment de la planification si aucun VPC géré par `Services_GCP` n'est détecté dans le projet. |
| `shared_users` / `technical_support_users` | `[]` | Utilisateurs ayant accès / requêtes de support acheminées, indépendamment de `public_access`. |
| `resource_creator_identity` | `rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com` | Compte de service que Terraform utilise pour créer des ressources. |
| `impersonation_service_account` | `""` | SA à emprunter pour les scripts shell (découverte, mise en miroir d'images, configuration NFS). Laisser vide pour utiliser les identifiants du runner. |
| `job_execution_wait_timeout` | `900` | Nombre maximal de secondes qu'un déploiement attend pour le job `db-init` avant d'annuler l'apply. |
| `explicit_secret_values` / `scripts_dir` | `{}` / `""` | Mise en miroir de la fondation, **non référencée** par ce module. |
| `requires_services` | _(create_postgres=true, create_mysql=false, create_redis=false, create_network_filesystem=true, create_google_kubernetes_engine=true, others false)_ | Indique à la plateforme quelles ressources `Services_GCP` auto-provisionner pour ce module. |

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openemr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` / `application_description` | _(Valeurs par défaut de la fondation)_ | Champs mis en miroir de la fondation. **Non référencés** — utilisez `display_name` / `description` à la place. |
| `application_version` | `7.0.4` | Tag de version de l'image OpenEMR ; incrémenter pour déployer une nouvelle version. |
| `display_name` | `OpenEMR` | Nom convivial affiché dans la console et les tableaux de bord. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` / `container_image` / `container_build_config` | _(Valeurs par défaut de la fondation)_ | Sourcing d'images mis en miroir de la fondation. **Non référencé** — `OpenEMR_Common` construit toujours une image personnalisée. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image OpenEMR dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `container_port` | `80` | Port de conteneur mis en miroir de la fondation. **Non référencé** — `main.tf` code en dur le port `80`. |
| `container_protocol` | `http1` | Protocole HTTP mis en miroir de la fondation. **Non référencé.** |
| `container_resources` | _(Valeurs par défaut de la fondation)_ | Objet CPU/mémoire mis en miroir de la fondation. **Non référencé** — utilisez `cpu_limit`/`memory_limit`/`ephemeral_storage_limit` à la place. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour les charges de travail cliniques concurrentes. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB minimum pour la production. |
| `ephemeral_storage_limit` | `8Gi` | Stockage éphémère pour l'opcache PHP, les journaux Apache et les fichiers temporaires. GKE Autopilot plafonne le stockage éphémère total des pods à 10 GiB ; le sidecar Auth Proxy utilise ~1 GiB, laissant un maximum de 9 GiB. |
| `min_instance_count` | `1` | Nombre minimum de réplicas. Maintenir ≥ 1 pour éviter les retards de démarrage à froid pour les utilisateurs cliniques. |
| `max_instance_count` | `1` | Augmenter uniquement après avoir confirmé que le partage de session Redis est opérationnel. |
| `enable_cloudsql_volume` | `true` | Bascule du sidecar Cloud SQL Auth Proxy mis en miroir de la fondation. **Non référencé** — `openemr.tf` force toujours cela à `true` en interne. |
| `cloud_sql_proxy_version` | `2-alpine` | Tag de l'image du sidecar Cloud SQL Auth Proxy. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du socket Auth Proxy mis en miroir de la fondation. **Non référencé.** |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes de service Kubernetes personnalisées. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes (0–3600). |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement. Prolongé pour la longue installation au premier démarrage d'OpenEMR. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires en texte clair. Les valeurs principales `MYSQL_*` et `OE_*` sont définies automatiquement. Ajouts courants : `PHP_MEMORY_LIMIT`, `SMTP_HOST`, `SMTP_PORT`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. À utiliser pour les valeurs sensibles telles que les identifiants SMTP. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Laisser vide pour la découverte automatique. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection de cluster mise en miroir de la fondation. **Non référencée.** |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laisser vide pour générer automatiquement. |
| `prereq_gke_subnet_cidr` / `prereq_subnet_cidr_override` / `prereq_gke_pod_cidr_override` / `prereq_gke_service_cidr_override` | _(auto-dérivé)_ | Substitutions CIDR pour un cluster VPC/GKE en ligne lorsque `Services_GCP` n'existe pas déjà. Définir sur les valeurs précédemment appliquées sur les déploiements existants pour éviter le remplacement. |
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP OpenEMR. |
| `enable_multi_cluster_service` | `false` | Bascule des services multi-clusters mis en miroir de la fondation. **Non référencée.** |
| `extra_service_ports` | `[]` | Ports de service supplémentaires mis en miroir de la fondation pour les charges de travail multi-protocoles. **Non référencé** — déclaré uniquement pour la parité de convention. |
| `configure_service_mesh` | `false` | Activer l'injection de sidecar Istio pour l'espace de noms. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `termination_grace_period_seconds` | `30` | Secondes pendant lesquelles Kubernetes attend après SIGTERM avant SIGKILL. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Requis pour la connectivité NFS via les règles de pare-feu VPC. Ne pas supprimer. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC. OpenEMR utilise NFS, pas les PVC — laisser non défini. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Options PVC lorsque le mode StatefulSet est explicitement nécessaire. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` ou `Parallel`. Par défaut à `OrderedReady`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. Par défaut à `RollingUpdate`. |
| `stateful_fs_group` | `0` | GID fsGroup défini dans le contexte de sécurité du pod ; `0` laisse fsGroup non défini. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Requêtes/limites totales de CPU autorisées sur tous les pods de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Nombre maximal de pods / services / PVC dans l'espace de noms. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Désactivé par défaut car `max_instance_count = 1` — un PDB avec `min_available = 1` bloque les vidanges de nœuds sur un seul pod. Activer uniquement lors de l'exécution de 2 réplicas ou plus. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |
| `topology_spread_strict` | `false` | Lorsque `true`, rejeter les pods (`DoNotSchedule`) si la contrainte de répartition de zone ne peut pas être satisfaite au lieu de `ScheduleAnyway`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | _(Valeurs par défaut de la fondation)_ | Objets de sonde mis en miroir de la fondation. **Non référencés** — utilisez `startup_probe` / `liveness_probe` à la place. |
| `startup_probe` | TCP sur le port 80, 12 échecs × 10s | Sonde TCP ; autorise jusqu'à 120 secondes pour le démarrage. Augmenter `failure_threshold` pour les premiers déploiements avec de grandes bases de données. |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 10 échecs × 30s | La page de connexion renvoie HTTP 200 uniquement lorsque Apache, PHP-FPM et la connexion à la base de données sont tous opérationnels. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la séquence intégrée `nfs-init` / `db-init` / `openemr-install`. |
| `cron_jobs` | `[]` | CronJobs planifiés (par exemple, sauvegarde, génération de rapports). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec OpenEMR. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (mode d'application —
`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, ou `ALWAYS_DENY` — utilisé uniquement lorsque
`enable_binary_authorization = true` et `Services_GCP` n'a pas préconfiguré
la politique).

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Doit rester `true`.** OpenEMR nécessite NFS pour le répertoire `sites/`. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Chemin de montage à l'intérieur du conteneur. Doit correspondre au chemin du répertoire des sites OpenEMR. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | VM GCE NFS existante à cibler directement. Laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM GCE NFS en ligne lorsqu'aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets supplémentaires. |
| `gcs_volumes` | `[]` | Buckets GCS montés via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images deviennent éligibles à la suppression. |

### Groupe 15 — Stockage de session Redis {#group-15--redis-session-store}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le stockage de session PHP. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS ; définir explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Sélecteur de moteur de base de données mis en miroir de la fondation. **Non référencé** — `OpenEMR_Common` définit toujours `MYSQL_8_0`. |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Ciblage d'instance Cloud SQL mis en miroir de la fondation. **Non référencé.** |
| `application_database_name` / `application_database_user` | `gkeappdb` / `gkeappuser` | Nom/utilisateur de la base de données mis en miroir de la fondation. **Non référencé** — utilisez `db_name` / `db_user` à la place. |
| `db_name` | `openemr` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `openemr` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installateur d'extensions PostgreSQL mis en miroir de la fondation. **Non référencé** — OpenEMR utilise MySQL. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Installateur de plugins MySQL mis en miroir de la fondation. **Non référencé** par ce module. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. Nécessite un redémarrage du pod pour prendre en compte le nouveau secret. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |
| `db_password_env_var_name` | `""` | Variable d'environnement de mot de passe supplémentaire mise en miroir de la fondation. **Non référencée** — `main.tf` code en dur `MYSQL_PASS`. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` | `""` | Noms de variables d'environnement de base de données supplémentaires mis en miroir de la fondation. **Non référencés** par ce module. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). **Ne pas désactiver pour les déploiements réglementés par HIPAA.** |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` | `false` | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_source` | `gcs` | Source d'importation : `gcs` ou `gdrive`. |
| `backup_file` | `backup.sql` | Nom de fichier de sauvegarde mis en miroir de la fondation. **Non référencé** — utilisez `backup_uri` à la place. |
| `backup_uri` | `""` | URI GCS (`gs://bucket/path`) ou ID de fichier Google Drive. Lorsqu'il est défini, injecté dans `nfs-init` comme `BACKUP_FILEID`. |
| `backup_format` | `sql` | Format du fichier de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, ou `zip`. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner la passerelle Kubernetes pour les noms d'hôte personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir. Si vide, un domaine nip.io basé sur l'IP statique auto-générée est utilisé. |
| `gateway_backend_stage` | `dev` | Étape Cloud Deploy dont le service est ciblé par la route HTTP de la passerelle. Ignoré lorsque `enable_cloud_deploy` est faux. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `static_ip_name` | `""` | Nom de l'IP statique réservée. Laisser vide pour générer automatiquement. |
| `network_name` | `""` | Nom explicite du réseau VPC. Laisser vide pour découvrir automatiquement le réseau géré par `Services_GCP`. **Non référencé** par ce module. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant OpenEMR. Recommandé pour restreindre l'accès au personnel clinique. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN via GCPBackendPolicy sur le backend GKE Ingress. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. Nécessite que `organization_id` soit défini explicitement. Recommandé pour les environnements HIPAA. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés (DATA_READ, DATA_WRITE). Recommandé pour la conformité HIPAA. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre OpenEMR. |
| `admin_password_secret_id` | ID du secret Secret Manager pour le mot de passe administrateur d'OpenEMR (`OE_PASS`). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données (`MYSQL_PASS`). |
| `database_host` / `database_port` | Point d'accès de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `nfs_server_ip` | IP interne du serveur NFS (sensible). |
| `nfs_mount_path` | Chemin de montage NFS à l'intérieur du conteneur. |
| `nfs_share_path` | Chemin de partage NFS sur le serveur. |
| `nfs_setup_job` | Nom du job de configuration NFS. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | OpenEMR ne peut pas fonctionner sans NFS. Le répertoire `sites/`, `sqlconf.php` et les documents des patients résident tous sur NFS. La désactivation entraîne un échec immédiat au démarrage. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Critique | Doit correspondre au chemin du répertoire des sites OpenEMR. Une non-concordance signifie que `openemr-install` écrit `sqlconf.php` à un emplacement que le pod principal ne vérifie jamais — le pod attend indéfiniment la fin de la configuration. |
| `database_type` (via OpenEMR_Common) | `MYSQL_8_0` | Critique | OpenEMR nécessite MySQL ; PostgreSQL ou `NONE` rompt l'installateur et tous les appels de base de données PHP. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données des patients. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation et peut corrompre le répertoire des sites NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `backup_schedule` | `0 2 * * *` | Critique | La désactivation des sauvegardes pour un DSE contenant des informations de santé protégées (PHI) est une violation de la conformité HIPAA. |
| `ephemeral_storage_limit` | `8Gi` | Critique | OpenEMR écrit l'opcache PHP, les journaux Apache et les fichiers temporaires dans la couche du conteneur. Les 1 GiB par défaut de GKE Autopilot sont insuffisants — le pod est expulsé pendant le démarrage. |
| `enable_redis` | `true` | Élevé | Avec >1 réplica, les sessions PHP isolées par pod entraînent des échecs de connexion et des pertes de session. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Un hôte Redis inaccessible provoque des échecs de session PHP et empêche toutes les connexions. |
| `memory_limit` | `4Gi` | Élevé | La génération de PDF et les rapports de facturation d'OpenEMR sont gourmands en mémoire. Moins de 2 GiB provoque des arrêts OOM en cours de requête. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les déploiements multi-réplicas perdent l'état de la session entre les requêtes. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro entraîne des retards de démarrage à froid de 20 à 40 secondes — inacceptable pour l'accès clinique. |
| `enable_pod_disruption_budget` | activer lorsque `min_instance_count` > 1 | Élevé | Désactivé par défaut car `max_instance_count = 1` — un PDB bloquerait de manière permanente les vidanges de nœuds sur un déploiement à un seul pod. Activer lors de la mise à l'échelle au-delà d'un réplica. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Les environnements réglementés par HIPAA devraient conserver au moins 90 jours. |
| `enable_iap` / `enable_cloud_armor` | activer pour les soins de santé | Moyen | L'interface d'administration d'OpenEMR est publiquement accessible sans ces contrôles. |
| `enable_audit_logging` | `true` pour HIPAA | Moyen | HIPAA exige la journalisation d'audit de l'accès aux PHI. |
| `enable_vpc_sc` | définir `organization_id` explicitement | Moyen | Sans ID d'organisation explicite, VPC-SC ignore silencieusement la création de périmètre — laissant un faux sentiment de sécurité. |
| `container_image_source` / `container_port` / `container_resources` / `database_type` / `application_database_name` / `db_password_env_var_name` (Groupe 4/16/10) | laisser par défaut | Faible | Ce sont des variables reflétées par la Fondation déclarées uniquement pour la parité `check_conventions.py` et ne sont **pas transmises** par `main.tf` — les modifier n'a aucun effet. Utilisez `cpu_limit`/`memory_limit`/`ephemeral_storage_limit`, `db_name`/`db_user` et `startup_probe`/`liveness_probe` à la place. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
mise à l'échelle automatique, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à OpenEMR partagée avec la variante Cloud Run est décrite dans
**[OpenEMR_Common](OpenEMR_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenEMR sur GKE Autopilot](../labs/OpenEMR_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenEMR sur Google Cloud Run](OpenEMR_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenEMR Common — Configuration d'application partagée](OpenEMR_Common.md) — la configuration partagée par les deux cibles de déploiement.
