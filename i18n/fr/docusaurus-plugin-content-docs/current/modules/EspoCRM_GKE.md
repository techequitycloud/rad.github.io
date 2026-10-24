---
title: "EspoCRM sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'EspoCRM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/EspoCRM_GKE.md @ e69407af sha256:b066fb1ca16a -->

# EspoCRM sur GKE Autopilot {#espocrm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EspoCRM_GKE.png" alt="EspoCRM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

EspoCRM est une plateforme de gestion de la relation client (CRM) open source, sous licence
GPLv3, basée sur PHP et Apache. Ce module déploie EspoCRM sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'EspoCRM utilise et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte EspoCRM sur RAD, et comparaison {#what-espocrm-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot d'EspoCRM sur RAD coûte environ 110 $ US par mois, plus 11 $ US une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](EspoCRM_CloudRun.md) exécute le même EspoCRM pour environ 84 $ US par mois. EspoCRM est un CRM gratuit et open source qui gère les comptes, les contacts, les prospects, les opportunités et les cas. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 110 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 par mois (environ 297 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio, fonctionnant en permanence | 40 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache : une petite VM | 13 $ US |
| Passerelle Cloud NAT et adresse IP | 5 $ US |
| Cloud Storage pour les modules complémentaires et les sauvegardes | 1 $ US |
| **Total** | **environ 110 $ US** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 $ US par mois.

### Comparaison {#how-it-compares}

EspoCRM a son propre plan hébergé officiel, **EspoCRM Cloud** : les plans hébergés officiels d'EspoCRM sont de 11 £/utilisateur/mois (Basic, minimum 3 utilisateurs), 19 £/utilisateur/mois (Enterprise, minimum 5 utilisateurs) et 49 £/utilisateur/mois (Ultimate, minimum 10 utilisateurs) — lu le 8 octobre 2026.

| Option | Par mois | Qui l'exécute |
|---|---|---|
| EspoCRM Cloud, Basic (3 utilisateurs min.) | 33 £/mois (3 × 11 £) | EspoCRM |
| EspoCRM Cloud, Enterprise (5 utilisateurs min.) | 95 £/mois (5 × 19 £) | EspoCRM |
| **RAD, GKE Autopilot, votre propre projet** | **110 $ US**, plus 11 $ US une fois | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **environ 2 970 crédits (297 $ US)** | RAD |
| RAD, Cloud Run | environ 84 $ US ; voir le [guide Cloud Run](EspoCRM_CloudRun.md) | RAD |

Le prix d'EspoCRM Cloud a été lu sur sa propre page de tarification le 8 octobre 2026 et a pu changer depuis — vérifiez la source avant de vous fier au chiffre.

- **EspoCRM Cloud est la comparaison fixe ; un serveur autogéré est la comparaison flexible.** Sur votre propre machine Hetzner ou DigitalOcean (2 vCPU/4 Go, environ 24 $ US/mois) ou une instance GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 $ US/mois), vous paieriez moins en espèces que l'une ou l'autre option, mais vous géreriez vous-même le système d'exploitation, la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau — exactement ce que les services Cloud SQL, Secret Manager et de surveillance gérés par RAD font pour vous.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.** Sur RAD, les sauvegardes, la récupération à un point dans le temps, la rotation des mots de passe via Secret Manager, ainsi que la journalisation et la surveillance proviennent de Google Cloud par défaut. Sur votre propre serveur, ou sur un plan hébergé à prix fixe sans contrôle de l'infrastructure, chacun de ces éléments est un travail que quelqu'un doit encore faire ou une limite que vous ne pouvez pas modifier.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si EspoCRM s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne démantèle pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 110 $ US.** Déployez EspoCRM, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, donc EspoCRM ne se met jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 $ US). La suppression permet d'économiser de l'argent si EspoCRM resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 3,67 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (99 crédits par jour).
- **Supprimez tout ce qu'EspoCRM utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient EspoCRM dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation quotidienne des crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration ; [Tarification EspoCRM Cloud](https://www.espocrm.com/pricing/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

EspoCRM fonctionne comme une charge de travail web PHP/Apache. Le déploiement connecte un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Apache/PHP, 1 vCPU / 2 Gio par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — EspoCRM ne prend pas en charge PostgreSQL ; accessible via le sidecar Auth Proxy |
| Stockage d'objets | Cloud Storage + NFS (Filestore) | Bucket `gcs-espocrm<tenant-prefix>-espocrm-data` ; NFS partagé monté sur `/var/www/html/data` pour les téléchargements |
| Cache | Redis (facultatif) | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `ESPOCRM_ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (`database_type = "MYSQL_8_0"`) ; EspoCRM ne prend pas en charge PostgreSQL.
- **La base de données est accessible via le sidecar Auth Proxy sur loopback.** La
  variante GKE surcharge `DB_HOST = "127.0.0.1"` afin qu'EspoCRM compose le sidecar Cloud SQL
  Auth Proxy colocalisé sur `127.0.0.1:3306` ; `enable_cloudsql_volume = true` par défaut.
- **Le compte administrateur est amorcé automatiquement.** L'installateur amont crée
  l'utilisateur `admin` avec le `ESPOCRM_ADMIN_PASSWORD` auto-généré au premier
  démarrage — récupérez-le depuis Secret Manager pour vous connecter.
- **Le schéma est créé au premier démarrage, pas par un job de migration.** `db-init`
  crée la base de données et l'utilisateur ; le `docker-entrypoint.sh` amont exécute ensuite
  l'action d'installation/migration automatiquement au démarrage du pod.
- **NFS est activé par défaut.** `enable_nfs = true` monte un volume Filestore partagé sur
  `/var/www/html/data`, de sorte que les pièces jointes téléchargées et les données d'exécution
  d'EspoCRM persistent lors des redémarrages de pod et sont partagées entre les réplicas.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1` — GKE maintient au
  moins un pod en cours d'exécution (pas de mise à l'échelle à zéro) afin que le CRM soit
  toujours accessible.
- **L'affinité de session est `ClientIP` par défaut**, acheminant les requêtes d'un client
  vers le même pod — utile une fois que vous dépassez un réplica.
- **`ESPOCRM_SITE_URL` est dérivé de l'URL du service** afin que les liens absolus et les
  vérifications de l'installateur d'EspoCRM utilisent l'hôte accessible plutôt que
  `localhost`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail EspoCRM {#a-gke-autopilot--the-espocrm-workload}

Les pods EspoCRM sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
les nombres minimum et maximum de réplicas. Comme l'application est basée sur NFS, la
fondation utilise la stratégie de mise à jour `Recreate` afin que deux pods n'écrivent
jamais sur le même volume NFS pendant un déploiement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  EspoCRM pour voir les pods et les événements. Kubernetes Engine → Services et Ingress
  affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de
charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

EspoCRM stocke toutes les données de l'application (contacts, prospects, opportunités,
activités, utilisateurs) dans une instance Cloud SQL pour MySQL 8.0 gérée. Les pods y
accèdent en privé via le sidecar **Cloud SQL Auth Proxy** lié à `127.0.0.1:3306` ; aucune
adresse IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
voir [App_GKE](App_GKE.md).

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket **Cloud Storage** dédié (`gcs-espocrm<tenant-prefix>-espocrm-data`) est provisionné automatiquement, et un
volume **NFS (Filestore)** partagé est monté sur `/var/www/html/data` pour les pièces jointes
téléchargées et les données d'exécution d'EspoCRM. Le compte de service de la charge de
travail se voit accorder l'accès au bucket.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /var/www/html/data
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK, les montages GCS Fuse et le modèle de
serveur NFS.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini, `REDIS_HOST` et
`REDIS_PORT` sont injectés et EspoCRM utilise Redis comme backend de cache d'objets
pour réduire la charge de la base de données. Lorsque `redis_host` est laissé vide et
`enable_nfs` est vrai, l'adresse IP de la VM du serveur NFS est utilisée comme point de
terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de la première exécution (`ESPOCRM_ADMIN_PASSWORD`) est généré
automatiquement et stocké dans Secret Manager, puis injecté dans le pod en tant que
variable d'environnement secrète via le pilote CSI Secret Store. Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du
CSI Secret Store.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google
peut être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des
adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles. Le `cloud-entrypoint.sh` affiche les valeurs
résolues `ESPOCRM_DATABASE_*` et `ESPOCRM_SITE_URL` au démarrage du pod — un moyen rapide de
confirmer l'hôte de la base de données et l'URL du site.

- **Console :** Journalisation → Explorateur de journaux ; Surveillance → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application EspoCRM {#3-espocrm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il résout la
  connexion Cloud SQL (socket Auth Proxy si présent, sinon TCP), crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde les privilèges
  et vérifie que l'utilisateur de l'application peut se connecter (réchauffant le cache
  d'authentification `caching_sha2_password` de MySQL 8). Le job s'exécute lors de l'apply et peut
  être relancé en toute sécurité.
- **Schéma créé au premier démarrage.** Il n'y a pas de job de migration séparé. Une fois
  que `db-init` a provisionné la base de données, le `docker-entrypoint.sh` EspoCRM amont
  exécute l'action d'installation/migration automatiquement au démarrage du pod, créant le
  schéma et l'utilisateur `admin`.
- **La connexion administrateur est auto-générée.** Le mot de passe de l'utilisateur
  `admin` provient du secret `ESPOCRM_ADMIN_PASSWORD`. Récupérez-le avant votre première
  connexion :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Changez-le dans l'interface utilisateur d'EspoCRM (Administration → Utilisateurs) une
  fois connecté.
- **Les téléchargements persistent sur NFS.** Avec `enable_nfs = true` (par défaut), les pièces
  jointes et les données d'exécution d'EspoCRM résident sous le montage Filestore partagé
  `/var/www/html/data`, survivant aux redémarrages de pod et partagées entre les réplicas.
- **L'URL du site doit correspondre à l'hôte accessible.** EspoCRM construit des liens
  absolus à partir de `ESPOCRM_SITE_URL` ; le point d'entrée le définit à partir de l'URL du
  service. Une fois l'adresse IP du LoadBalancer ou le domaine personnalisé connus,
  assurez-vous que l'URL du site reflète l'hôte externe afin que les liens et les
  redirections OAuth soient corrects.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  `HTTP GET /` — EspoCRM y sert sa page de connexion non authentifiée
  (`200`). La sonde de démarrage (`startup_probe_config`) a par défaut un délai initial de
  10 secondes, une période de 10 secondes et un seuil de 3 échecs ; la sonde de vivacité
  (`health_check_config`) a par défaut un délai initial de 15 secondes, une période de 30
  secondes et un seuil de 3 échecs. Ceux-ci sont nettement plus stricts que les valeurs
  par défaut de la variante Cloud Run — lors d'un démarrage lent (l'étape
  d'installation/migration), les pods peuvent basculer avant qu'EspoCRM ne termine son
  initialisation ; augmentez le délai initial / le seuil d'échec via `startup_probe_config` /
  `health_check_config` si vous observez cela.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour EspoCRM sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et
ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `espocrm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image pour `espocrm/espocrm` ; `latest` est épinglé en interne à `10.0.2`. Épinglez à une version spécifique en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez pour les plugins lourds ou les médias volumineux. |
| `upload_max_filesize` / `post_max_size` | `64M` | Limites de taille de téléchargement / POST ; `post_max_size` doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; minimum 1 vCPU pour EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Mémoire par pod ; minimum 512 Mio (PHP 8.x). |
| `min_instance_count` | `1` | Réplicas minimum ; GKE maintient ≥ 1 pour que le CRM soit toujours accessible. |
| `max_instance_count` | `1` | Réplicas maximum. Augmentez uniquement avec NFS partagé + affinité `ClientIP` confirmée. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (loopback `127.0.0.1:3306`). |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (Deployment) | `Deployment` (par défaut) ou `StatefulSet` avec des PVC par pod. |
| `session_affinity` | `ClientIP` | Routage persistant vers le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un volume Filestore partagé pour les téléchargements/données d'exécution d'EspoCRM. |
| `nfs_mount_path` | `/var/www/html/data` | Chemin de montage du volume NFS dans le conteneur. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis comme backend de cache d'objets d'EspoCRM. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (EspoCRM_Common définit également `MYSQL_8_0` dans sa sortie `config`) | Moteur Cloud SQL. EspoCRM nécessite MySQL — ne sélectionnez pas PostgreSQL. |
| `application_database_name` | `espocrm` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `application_database_user` | `espocrm` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre EspoCRM. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur
> de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au
> moment du plan — quotas de mémoire en unités binaires, un conflit `StatefulSet`, IAP
> sans identités autorisées, un `redis_port`/`backup_retention_days` hors de portée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | EspoCRM ne prend en charge que MySQL ; la sélection de PostgreSQL interrompt le démarrage. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `ESPOCRM_ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager ; modifier dans l'interface utilisateur | Critique | Ne définit le mot de passe administrateur que lors de la **première** installation ; le perdre vous bloque jusqu'à la réinitialisation via la base de données. |
| `enable_nfs` | `true` | Critique | Le désactiver stocke les téléchargements sur un disque de pod éphémère — les pièces jointes sont perdues lors du redémarrage/replanification du pod. |
| `DB_HOST` (surchargé à `127.0.0.1`) | Laisser tel quel | Élevé | EspoCRM compose le sidecar Auth Proxy sur loopback ; le modifier interrompt la connectivité de la base de données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité MySQL sur GKE. |
| `ESPOCRM_SITE_URL` (auto-dérivé) | URL du LoadBalancer externe / domaine personnalisé | Élevé | Une URL de site incorrecte rompt les liens absolus, la vérification de l'installateur et les redirections OAuth. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, PHP 8.x tue les processus par manque de mémoire lors de l'installation/migration et sous charge. |
| `max_instance_count` | `1` sauf si affinité + NFS confirmés | Élevé | La mise à l'échelle avec un `RollingUpdate` sur une application basée sur NFS peut provoquer un blocage ; la fondation utilise `Recreate` pour les applications NFS. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions multi-réplicas rebondissent entre les pods. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_iap` | uniquement lorsque l'interface utilisateur publique n'est pas nécessaire | Moyen | IAP nécessite une connexion Google pour chaque requête, y compris les intégrations d'API. |
| `application_version` | Épingler en production | Moyen | `latest` correspond à un tag épinglé en interne, mais l'épinglage explicite évite les mises à niveau surprises lors du redéploiement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à EspoCRM partagée avec la variante Cloud Run est
décrite dans **[EspoCRM_Common](EspoCRM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : EspoCRM sur GKE Autopilot](../labs/EspoCRM_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EspoCRM sur Google Cloud Run](EspoCRM_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [EspoCRM Common — Configuration d'application partagée](EspoCRM_Common.md) — la configuration partagée par les deux cibles de déploiement.
