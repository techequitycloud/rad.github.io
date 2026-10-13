---
title: "FreshRSS sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de FreshRSS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FreshRSS_GKE.md @ e69407af sha256:18d00990fede -->

# FreshRSS sur GKE Autopilot {#freshrss-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreshRSS_GKE.png" alt="FreshRSS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreshRSS est un agrégateur de flux RSS et Atom gratuit, auto-hébergé et sous
licence GPL-3.0 — un « lecteur de nouvelles » léger et multi-utilisateur écrit
en PHP qui s'exécute derrière Apache et expose les API Google Reader et Fever
pour les clients mobiles. Ce module déploie FreshRSS sur **GKE Autopilot**
par-dessus la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par FreshRSS et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte FreshRSS sur RAD, et comment cela se compare {#what-freshrss-costs-on-rad-and-how-that-compares}

**L'exécution de FreshRSS dans votre propre projet Google Cloud coûte environ
110,13 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique
de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD).
FreshRSS est un agrégateur de flux RSS et Atom gratuit, open source et
auto-hébergé. Si vous déployez dans un projet géré par RAD, vous pouvez tout
mettre en pause gratuitement et le reprendre plus tard — voir « Mettre en pause
gratuitement » ci-dessous.

*FreshRSS est également disponible sur Cloud Run — voir le [guide Cloud Run](FreshRSS_CloudRun.md)
pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une seule fois) | **99 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~110,13 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~99 crédits/jour (~9,90 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **110,13 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officiellement hébergée/cloud de FreshRSS pour
  comparer, donc la comparaison honnête se fait avec une infrastructure
  auto-gérée, et non avec un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 2 Gio — un Hetzner CPX22 (2 vCPU/4Go,
  ~24 $ US/mois), un DigitalOcean 2 vCPU/4Go Droplet (24 $ US/mois), ou le
  Compute Engine e2-standard-2 de GCP (2 vCPU/8Go, ~49 $ US/mois) — est
  généralement moins cher que le prix affiché par RAD ; un VPS d'une ou deux
  tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de bases de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL
  géré, Secret Manager et la surveillance de RAD le font pour vous, ce qui est
  le véritable échange, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes de coûts — ce n'est
  généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si FreshRSS s'exécute dans un **projet géré par RAD**, vous pouvez arrêter de
le payer entièrement sans le détruire. La suppression de ce projet délie
d'abord sa facturation, puis demande à Google de supprimer purement et
simplement le projet — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression du module FreshRSS seul, cela ne
détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : tout
le projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car
la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter Update sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une
chaîne de déploiement typique de 2 à 3. Les frais de module de 99 crédits ne
sont pas facturés à nouveau.

Ce qu'il faut pour cela : vous devez être propriétaire du projet (pas un projet
dont RAD gère uniquement la facturation), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, de sorte que
votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo
conviennent). Google indique que la plupart des services fonctionnent à nouveau
pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé FreshRSS et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si FreshRSS se trouve dans votre propre projet (ou si plus de 30 jours se sont
écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds :
environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou
**99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si FreshRSS devait
rester inutilisé suffisamment longtemps pour compenser ce coût de
redéploiement par rapport à son propre coût d'exécution : environ **4 jours
ou plus** d'inactivité dans votre propre projet (par rapport à sa facture
Google Cloud d'environ 110,13 $ US/mois), ou **environ 2 jours ou plus**
d'inactivité dans un projet géré par RAD (par rapport à ses ~99 crédits/jour).

La majeure partie du coût d'exécution de FreshRSS est la base de données et la
VM de fichier/cache partagée. Ils ne s'arrêtent que si rien d'autre dans le
projet ne les utilise, donc la suppression de cette application alors que
quelque chose d'autre partage le projet n'économise que la part de calcul de
cette application du total ci-dessus.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre
  projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont conservées,
  afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
  remet le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ; [documentation de Google sur la
suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

FreshRSS s'exécute comme une charge de travail web PHP/Apache. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 80, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le point d'entrée s'installe avec `--db-type pgsql` |
| Stockage persistant | NFS (Filestore / auto-géré) ou PVC de bloc | Répertoire de données à `/var/www/FreshRSS/data` ; contient la configuration, l'état par utilisateur, le cache des flux. Pas de bucket GCS |
| Cache | Redis (optionnel) | Désactivé par défaut ; FreshRSS ne le requiert pas |
| Secrets | Secret Manager | `FRESHRSS_ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur pris en charge.** Le point d'entrée du
  conteneur code en dur `--db-type pgsql` et le job `db-init` est
  Postgres-only ; le schéma est créé par l'installateur de FreshRSS au premier
  démarrage.
- **Sur GKE, le proxy d'authentification Cloud SQL s'exécute en tant que
  sidecar** lié à `127.0.0.1:5432`, de sorte que FreshRSS compose
  l'adresse de bouclage (`DB_HOST = 127.0.0.1`) — le point d'entrée
  traite la bouclage comme un hôte TCP en texte clair (le proxy termine le
  TLS).
- **NFS est activé par défaut** (`enable_nfs = true`) et monté à
  `/var/www/FreshRSS/data`. FreshRSS y écrit sa configuration générée, l'état
  par utilisateur, les articles mis en cache et les favicons — sans volume
  persistant, cet état est perdu au redémarrage du pod. Un déploiement basé sur
  NFS utilise la stratégie `Recreate` afin que deux pods
  n'écrivent jamais le même volume pendant un déploiement progressif.
- **`FRESHRSS_ADMIN_PASSWORD` est généré automatiquement** et stocké dans
  Secret Manager. Il initialise le compte par défaut `admin`
  (et son mot de passe API) lors de la première installation.
- **L'affinité de session est `ClientIP` par défaut.** Maintient
  les requêtes d'un client sur le même pod.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`,
  `max_instance_count = 1`) ; GKE ne prend pas en charge la mise à l'échelle à
  zéro, donc le cron de rafraîchissement de flux dans le conteneur s'exécute
  toujours.
- **Une IP externe statique est réservée par défaut** (`reserve_static_ip = true`)
  et un Ingress de domaine personnalisé est provisionné par défaut
  (`enable_custom_domain = true`) — renseignez `application_domains` pour servir de
  vrais noms d'hôte.
- **Le conteneur écoute sur le port 80** (Apache), pas 8080.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail FreshRSS {#a-gke-autopilot--the-freshrss-workload}

Les pods FreshRSS sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Comme le répertoire de données est basé sur
NFS, le déploiement utilise la stratégie de mise à jour
`Recreate` plutôt qu'une mise à jour progressive.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail FreshRSS pour voir les pods et les événements. Kubernetes Engine →
  Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE" <service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

FreshRSS stocke toutes les données de l'application (flux, abonnements,
articles, catégories, utilisateurs) dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Les pods y accèdent en privé via le sidecar
**Cloud SQL Auth Proxy** sur la boucle de retour `127.0.0.1:5432` ;
aucune IP publique n'est exposée. Lors du premier déploiement, le job
`db-init` crée la base de données et l'utilisateur de
l'application, et l'installateur de FreshRSS crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Stockage persistant (NFS / PVC) {#c-persistent-storage-nfs--pvc}

Le répertoire de données de FreshRSS (`/var/www/FreshRSS/data`) est
soutenu par un **volume NFS** (`enable_nfs = true`), qui contient la
configuration générée, l'état par utilisateur, les articles mis en cache et les
favicons. Ce module ne déclare **aucun bucket GCS**. Un PVC de bloc
(StatefulSet) est un mode de persistance alternatif via les variables
StatefulSet du groupe 7.

- **Console :** Filestore → Instances (NFS géré) ; Kubernetes Engine → Stockage
  (PVC).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /var/www/FreshRSS/data
  ```

Voir [App_GKE](App_GKE.md) pour le modèle de serveur NFS, les PVC de bloc et
GCS Fuse.

### D. Redis (cache optionnel) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`) et FreshRSS
ne le requiert pas. Il est exposé comme une option avancée pour la parité avec
les modules PHP frères ; laissez-le désactivé sauf si vous avez une raison
spécifique de l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

Un secret d'application est généré automatiquement : `FRESHRSS_ADMIN_PASSWORD`,
qui initialise le compte par défaut `admin` et son mot de
passe API lors de la première installation. Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freshrss"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing avec une adresse IP statique réservée, et un Ingress de domaine
personnalisé est provisionné. Ajoutez des noms d'hôte via `application_domains`
pour un certificat géré par Google.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application FreshRSS {#3-freshrss-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` s'exécute en utilisant `postgres:15-alpine`. Il se
  connecte via le proxy d'authentification Cloud SQL et crée de manière
  idempotente la base de données et l'utilisateur de l'application et accorde
  les privilèges. Le job peut être réexécuté en toute sécurité.
- **Installation au premier démarrage.** Le `platform-entrypoint.sh` du
  conteneur résout l'hôte de la base de données (bouclage du proxy
  `127.0.0.1` sur GKE), puis pilote le propre
  `cli/do-install.php` de FreshRSS (crée `data/config.php` et le
  schéma) et `cli/create-user.php` (crée le compte
  `admin` à partir de `FRESHRSS_ADMIN_PASSWORD`), puis
  chaîne le point d'entrée amont. L'installation est idempotente — ignorée une
  fois que `data/config.php` existe sur le volume persistant.
- **Cron de rafraîchissement des flux.** L'image amont démarre un cron
  dans le conteneur (`CRON_MIN = */15`) qui actualise les flux
  abonnés toutes les 15 minutes. Comme GKE maintient au moins un réplica en
  cours d'exécution, le cron se déclenche toujours.
- **Identifiant administrateur.** La connexion par défaut est
  `admin` avec le `FRESHRSS_ADMIN_PASSWORD` généré ;
  la même valeur est définie comme mot de passe API utilisé par les clients
  mobiles Google Reader / Fever API. Changez-le dans l'interface utilisateur de
  FreshRSS après la première connexion — la rotation de la valeur Secret
  Manager seule ne réinitialisera pas un compte déjà installé.
- **Stratégie de déploiement progressif.** Avec NFS activé, le déploiement
  utilise `Recreate` (pas `RollingUpdate`) afin que
  deux pods n'écrivent jamais simultanément dans le répertoire de données
  partagé — une mise à jour progressive sur cette application avec état
  entraînerait un blocage sur les verrous de fichier/base de données.
- **Chemin de santé.** La sonde de démarrage est une vérification TCP sur le
  port 80 ; la sonde de vivacité est un HTTP GET sur `/i/`,
  qui renvoie un `200` littéral et rend à partir de la
  base de données (`/` répond avec une redirection 302,
  qu'une vérification de santé de l'équilibreur de charge rejette). FreshRSS
  sert également un point de terminaison JSON non authentifié
  `/status` adapté aux vérifications de disponibilité.
  Prévoyez une fenêtre généreuse au premier démarrage pendant que
  l'installateur crée le schéma.
- **Définissez l'URL externe une fois l'IP connue.** Confirmez l'IP de
  l'équilibreur de charge / l'hôte Ingress et définissez
  `BASE_URL` (via `environment_variables`) ou
  `application_domains` afin que les liens auto-référencés de FreshRSS
  se résolvent correctement :
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
FreshRSS sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freshrss` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image FreshRSS ; `latest` est épinglé à un tag connu et fonctionnel (`1.26.3`) au moment de la construction. Épinglez explicitement en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | FreshRSS livre une version personnalisée légère ; utilisez `prebuilt` uniquement avec un `container_image` externe. |
| `cpu_limit` | `1000m` | CPU par pod (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par pod ; maintenir ≥ 512 Mio. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE requiert ≥ 1. Maintient FreshRSS et son cron de rafraîchissement en cours d'exécution. |
| `max_instance_count` | `1` | Maintenir à 1 — un seul pod possède le cron de rafraîchissement et l'état basé sur les fichiers. |
| `container_port` | `80` | FreshRSS/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions Postgres. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout en `Deployment` ; basé sur NFS, il utilise donc la stratégie `Recreate`. Définissez `StatefulSet` uniquement avec un PVC de bloc. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un seul pod. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC de bloc par pod comme alternative à NFS pour le répertoire de données. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/var/www/FreshRSS/data` | Chemin de montage du conteneur pour le PVC ; doit correspondre au chemin de montage NFS afin que le répertoire de données persiste dans tous les cas. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s de délai, seuil 20 | Sonde de démarrage ; le seuil élevé permet le temps d'installation au premier démarrage. |
| `liveness_probe` | HTTP `/i/` 300s de délai | Sonde de vivacité ; `/status` est un point de terminaison JSON non authentifié alternatif. |
| `uptime_check_config` | `{enabled=false, path="/"}` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métriques optionnelles. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un volume NFS persistant pour le répertoire de données FreshRSS. **Maintenir activé** — requis pour persister la configuration et l'état par utilisateur. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Où le volume NFS est monté à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Version du moteur PostgreSQL. FreshRSS s'installe avec `--db-type pgsql`. |
| `application_database_name` | `freshrss` | Nom de la base de données de l'application. Immuable après le premier déploiement. |
| `application_database_user` | `freshrss` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir ; définissez pour obtenir un certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut ; FreshRSS ne requiert pas Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis si activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre FreshRSS. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (FreshRSS n'en déclare aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — une charge de
> travail `Deployment` avec `stateful_pvc_enabled = true`, IAP sans
> identités autorisées, des valeurs de quota de mémoire sans suffixes d'unité
> binaire, un `redis_port`/`backup_retention_days` hors plage. Une
> configuration invalide échoue la **planification** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (ou un PVC de bloc) | `true` | Critique | Sans volume persistant, le répertoire de données FreshRSS est éphémère — `config.php`, l'état par utilisateur et le cache sont effacés au redémarrage du pod, forçant une réinstallation. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Critique | Le montage ailleurs rend le répertoire de données éphémère (même effet que pas de NFS). |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données de flux. |
| `database_type` | `POSTGRES_15` | Critique | FreshRSS s'installe avec `--db-type pgsql` ; un moteur non-Postgres casse l'installateur et `db-init`. |
| `container_port` | `80` | Élevé | FreshRSS/Apache écoute sur le port 80 ; un mauvais port fait échouer la sonde de démarrage et les pods ne deviennent jamais prêts. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur la boucle de retour `127.0.0.1`. |
| `max_instance_count` | `1` | Élevé | L'exécution de plus d'un pod duplique le cron de rafraîchissement dans le conteneur et divise l'état de session/cache basé sur les fichiers ; une mise à jour progressive sur le répertoire NFS partagé se bloque. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes d'un client se dispersent sur les pods, perturbant les sessions connectées. |
| `min_instance_count` | `1` | Élevé | GKE requiert min ≥ 1 ; la garde de validation rejette les valeurs invalides. Maintenir 1 maintient FreshRSS et son cron de rafraîchissement en cours d'exécution. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_iap` | uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients mobiles utilisant l'API Google Reader / Fever. |
| `FRESHRSS_ADMIN_PASSWORD` (auto-généré) | Modifier dans l'interface utilisateur après la première connexion | Moyen | La rotation du secret seul ne réinitialise pas un compte déjà installé ; le premier mot de passe reste valide jusqu'à ce qu'il soit modifié dans l'application. |
| `application_domains` | Définir avec `enable_custom_domain` | Moyen | `enable_custom_domain = true` sans noms d'hôte provisionne un Ingress qui ne sert aucun certificat géré. |
| `memory_limit` | `2Gi` | Moyen | Les valeurs inférieures à 512 Mio risquent un OOM en cas de rafraîchissement intensif des flux. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à FreshRSS
partagée avec la variante Cloud Run est décrite dans
**[FreshRSS_Common](FreshRSS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreshRSS sur GKE Autopilot](../labs/FreshRSS_GKE.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) — la même application
  sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [FreshRSS Common — Configuration d'application partagée](FreshRSS_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
