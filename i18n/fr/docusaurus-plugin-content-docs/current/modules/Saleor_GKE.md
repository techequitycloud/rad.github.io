---
title: "Saleor sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Saleor sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Saleor_GKE.md @ 40c83c3f sha256:57e26447c86a -->

# Saleor sur GKE Autopilot {#saleor-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_GKE.png" alt="Saleor sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor est une plateforme e-commerce headless open source, GraphQL-first, basée
sur Python/Django (catalogue de produits, paiement, commandes et plugins de
paiement, tous exposés via une API GraphQL plutôt qu'une vitrine intégrée). Ce
module déploie Saleor sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Saleor et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Saleor sur RAD, et comparaison {#what-saleor-costs-on-rad-and-how-that-compares}

**L'exécution de Saleor dans votre propre projet GCP coûte environ 106,53 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option la moins chère ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | ~106,53 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~127 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Pourquoi les deux colonnes diffèrent.** Le chiffre pour les projets gérés par RAD inclut les frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre du projet propre suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore suffisamment d'historique GKE géré par RAD pour le mesurer, de sorte que la confirmation de déploiement ne le mentionne pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **106,53 $** |

### Comparaison {#how-it-compares}

- L'offre gérée officielle de Saleor, Saleor Cloud, commence à **1 599 $/mois** (niveau Select, jusqu'à 200 000 $ de GMV ; source : https://saleor.io/pricing) — elle vise les vitrines de production avec un volume de transactions réel, ce n'est donc pas une comparaison directe avec un déploiement en libre-service unique, mais c'est le seul prix commercial vérifié pour cette plateforme exacte.
- L'empreinte de Saleor ici (1x vCPU / 1 Gio) est plus petite que cette classe de référence, donc un niveau VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Saleor est une API de commerce dont dépendent les vitrines en direct, donc la disponibilité a tendance à être plus importante ici que de réduire les coûts d'exécution — mais le même mécanisme de pause ci-dessous s'applique toujours à une vitrine de staging ou de démonstration qui ne prend pas de commandes en direct.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logique récupérable de 30 jours de Google.
Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL,
aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être invoquée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le
prix (5 par mois pour chaque déploiement), donc une restauration ne coûte
normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
affirme que la plupart des services sont de nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Saleor purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) — 110 crédits.

La suppression ne permet d'économiser de l'argent que si Saleor reste inutilisé suffisamment longtemps pour que le coût de ce redéploiement soit compensé par son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données d'abord :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://saleor.io/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Saleor s'exécute comme un conteneur personnalisé (`ghcr.io/saleor/saleor:3.23` enveloppé d'un
point d'entrée cloud) sur GKE Autopilot. Le déploiement connecte un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Deux charges de travail Kubernetes : l'API Saleor principale (uvicorn, 2 workers + Celery worker/beat colocalisé) et un tableau de bord pré-construit séparé ; 2 vCPU / 3 Gio par défaut sur le pod principal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — fixé par `Saleor_Common` quelle que soit la valeur de `database_type` |
| Stockage d'objets | Cloud Storage | Un bucket `media` dédié provisionné automatiquement |
| Cache et broker | Redis (facultatif) | Prend en charge `CACHE_URL`/`CELERY_BROKER_URL` pour le worker Celery colocalisé |
| Secrets | Secret Manager | `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Valeur par défaut du module `LoadBalancer` ; **le déploiement en direct de ce projet exécute actuellement `ClusterIP`** en raison d'un quota d'IP épuisé — voir Notes ci-dessous |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** `Saleor_Common` fixe le moteur de base de données ;
  la sélection de toute autre valeur dans `database_type` n'a aucun effet.
- **Le worker Celery (traitement des commandes, webhooks, e-mails, tâches
  planifiées) s'exécute en colocation à l'intérieur du conteneur du pod
  principal**, démarré comme un processus en arrière-plan par le point d'entrée
  cloud — et non un déploiement `additional_services` séparé. GKE n'a pas de chemin de
  partage de build entre l'application principale et un déploiement sidecar, pas
  plus que Cloud Run.
- **Le dimensionnement des ressources est pré-réglé : `2000m` CPU / `3Gi`
  mémoire.** Confirmé en direct sur GKE Autopilot que des tailles plus petites
  (même `1Gi`/`2` vCPU, arrondies par Autopilot à `2176Mi`)
  provoquent des OOMKill sous la charge combinée de 2 workers uvicorn + Django +
  worker/beat Celery.
- **Trois secrets sont générés automatiquement** : `SECRET_KEY`, `RSA_PRIVATE_KEY`
  (paire de clés de signature JWT de Saleor — ne doit jamais être renouvelée
  sans précaution), et `DJANGO_SUPERUSER_PASSWORD`.
- **Une charge de travail de tableau de bord séparée, véritablement pré-construite**
  (`ghcr.io/saleor/saleor-dashboard:3.23`) est déployée à côté de l'API en tant qu'entrée `additional_services`. Son
  `API_URL` est intégré à l'interface utilisateur servie au démarrage du
  conteneur, résolu à partir du sentinelle de temps de plan de la Fondation
  `$(GKE_SERVICE_URL)` + `/graphql/`.
- **La valeur par défaut du module `service_type` est `LoadBalancer` ; ce déploiement
  exécute actuellement `ClusterIP`** — un choix opérationnel fait dans
  `config/deploy.tfvars` car le quota d'IP externes de ce projet (`IN_USE_ADDRESSES`) était
  épuisé au moment du déploiement, et non une décision de conception du module.
  Revenez en arrière une fois que le quota d'IP est disponible.
- **Redis est facultatif et désactivé par défaut** (`enable_redis = false`). Lorsqu'il est
  activé avec `redis_host` laissé vide, il revient à l'IP de la VM du serveur
  NFS.
- **Les sondes de santé ciblent `/health/`**, non authentifiées, confirmées 200
  localement et en direct.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — les charges de travail de l'API et du tableau de bord Saleor {#a-gke-autopilot--the-saleor-api-and-dashboard-workloads}

Les pods de l'API de Saleor sont planifiés sur Autopilot, qui facture le CPU/la
mémoire que les pods demandent réellement. Le tableau de bord s'exécute comme
une deuxième charge de travail indépendante (une entrée `additional_services`) servant le
bundle d'interface utilisateur d'administration statique.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe (lorsque `service_type = LoadBalancer`).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-dashboard --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Saleor stocke toutes les données de l'application (produits, commandes,
paniers, utilisateurs, enregistrements de paiement) dans une instance Cloud SQL
gérée pour PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud
SQL Auth Proxy** sur la boucle locale ; aucune IP publique n'est exposée. Lors
du premier déploiement, `db-init` crée la base de données et le rôle de
l'application, puis `db-migrate` (qui dépend de `db-init`) applique les
migrations de schéma de Django.

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

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `media` dédié est provisionné automatiquement pour
les actifs de produits/médias téléchargés par Saleor. Le compte de service de
la charge de travail se voit accorder l'accès. Des buckets supplémentaires
peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache et broker Celery) {#d-redis-cache--celery-broker}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini et que
`redis_host` est laissé vide, l'IP de la VM du serveur NFS est utilisée comme
point de terminaison Redis (nécessite `enable_nfs = true`). Le point d'entrée cloud
compose `CACHE_URL` (base de données Redis `/0`) et `CELERY_BROKER_URL` (base de
données Redis `/1`) à partir de `REDIS_HOST`/`REDIS_PORT`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs from the running pod's env:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'CACHE_URL|CELERY_BROKER_URL'
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (clé de signature cryptographique de Django), `RSA_PRIVATE_KEY` (paire de
clés de signature JWT pour tous les jetons d'accès/actualisation émis) et
`DJANGO_SUPERUSER_PASSWORD` (mot de passe du compte administrateur de démarrage). Le mot de
passe de la base de données est géré séparément par la fondation.

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

Par défaut, la charge de travail serait exposée via une IP externe de Cloud
Load Balancing (`service_type = LoadBalancer`). **Le déploiement en direct de ce projet exécute
actuellement `service_type = ClusterIP`** car le quota d'IP externes du projet
(`IN_USE_ADDRESSES`) était épuisé au moment du déploiement — vérifiez avec
`kubectl
port-forward` plutôt que de vous attendre à une IP publique. Une fois le quota
disponible, revenez à `service_type = "LoadBalancer"` avec `reserve_static_ip = true`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8000
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte facultatifs sont disponibles (les
tests de disponibilité nécessitent un point de terminaison accessible
publiquement).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Saleor {#3-saleor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init`
  (`postgres:15-alpine`) crée de manière idempotente la base de données et le rôle de
  l'application. `db-migrate` (l'image de l'application, `depends_on_jobs = ["db-init"]`) exécute
  ensuite `python3 manage.py migrate --noinput`. Les deux jobs peuvent être réexécutés en toute
  sécurité.
- **Extensions toujours installées.** `pg_trgm`, `unaccent`, `hstore` et
  `citext` sont installées inconditionnellement par la configuration
  assemblée de `Saleor_Common` — les variables `enable_postgres_extensions`/`postgres_extensions` du module
  appelant n'ont aucun effet supplémentaire sur cet ensemble de base.
- **Le worker Celery + beat s'exécute en colocation, et non comme une charge de
  travail séparée.** Le traitement des commandes, les webhooks, les e-mails et
  les tâches planifiées s'exécutent tous à l'intérieur du processus de worker
  en arrière-plan du pod principal.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY` et `DJANGO_SUPERUSER_PASSWORD` sont immuables après le premier
  démarrage.** `RSA_PRIVATE_KEY` en particulier signe chaque JWT émis par Saleor —
  le renouveler invalide toutes les sessions actives. Ne le renouvelez que
  pendant une fenêtre de maintenance planifiée.
- **Démarrage du superutilisateur.** Le point d'entrée cloud exécute
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` à chaque démarrage lorsque `DJANGO_SUPERUSER_PASSWORD` est défini (idempotent
  — une opération nulle une fois que l'utilisateur existe). `SALEOR_SUPERUSER_EMAIL` prend
  par défaut la valeur `admin@example.com` et n'est pas exposé comme variable sur ce
  module — c'est la valeur par défaut fixe de `Saleor_Common`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health/` — le point de terminaison de santé non authentifié de Saleor,
  confirmé pour renvoyer `200` dès que le serveur ASGI accepte les
  connexions.
- **L'API `API_URL` du tableau de bord est intégrée au démarrage du
  conteneur**, et non lue dynamiquement — confirmé via le propre
  `/docker-entrypoint.d/50-replace-env-vars.sh` de l'image officielle du tableau de bord, qui remplace par sed
  `API_URL` dans le `index.html` construit. Sur GKE, cela utilise
  `$(GKE_SERVICE_URL)` — la sentinelle de temps de plan de la Fondation résolue en URL
  de service réelle de l'application principale, car Kubernetes n'interpole pas
  `$(VAR)` entre les conteneurs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Saleor sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `saleor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Correspond à l'ARG de build `SALEOR_VERSION` (`3.23` lorsque `latest`) et au propre tag de l'image du tableau de bord. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Dimensionné pour la charge de travail combinée uvicorn + Celery — voir Vue d'ensemble. |
| `min_instance_count` | `0` | Réplicas minimum (HPA minReplicas). |
| `max_instance_count` | `1` | Réplicas maximum (HPA maxReplicas). |
| `container_port` | `8000` | Port de liaison d'uvicorn — doit correspondre à `CMD` de l'image de base. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions en boucle locale. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, fusionnés par-dessus les valeurs par défaut de `Saleor_Common` (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Ne définissez pas `SECRET_KEY`, `RSA_PRIVATE_KEY` ou `DJANGO_SUPERUSER_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | **Ce déploiement est actuellement remplacé par `ClusterIP` dans `deploy.tfvars`** en raison d'un quota d'IP épuisé — voir Vue d'ensemble. |
| `workload_type` | `Deployment` (impliqué par `null`) | Saleor se déploie en tant que `Deployment` ; `StatefulSet` n'est pas utilisé. |
| `session_affinity` | `ClientIP` | Routage persistant. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL — donne au worker Celery le temps de terminer les tâches en cours. |

### Groupe 8 — Scripts SQL personnalisés {#group-8--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 11/12 — Jobs et tâches planifiées {#group-1112--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour la paire intégrée `db-init` → `db-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, commandes de gestion Saleor). |

### Groupe 13/15 — Système de fichiers (NFS) et Redis {#group-1315--filesystem-nfs--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Déclaré mais non utilisé par le propre chemin de stockage de Saleor — les médias sont servis à partir du bucket GCS `media`. Également la source du repli Redis NFS-IP lorsque `enable_redis = true` et `redis_host = ""`. |
| `enable_redis` | `false` | Active le cache/broker de Saleor sur Redis. |
| `redis_host` | `""` | Revient à l'IP du serveur NFS lorsque `enable_nfs = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 14/16 — Cloud Storage et base de données {#group-1416--cloud-storage--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires, en plus du bucket `media` déclaré par `Saleor_Common`. |
| `database_type` | `POSTGRES` | Déclaré pour la parité de convention ; `Saleor_Common` fixe toujours PostgreSQL 15 quelle que soit cette valeur. |
| `application_database_name` | `gkeapp` | Nom de la base de données PostgreSQL. Remplacement recommandé : `saleor_db`. Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de la base de données de l'application. Remplacement recommandé : `saleor_user`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Gateway API + une IP statique pour les noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | Recommandé une fois que `service_type` est repassé à `LoadBalancer`. |

### Groupe 10/22 — Observabilité et santé {#group-1022--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, délai de 90s | Sonde de démarrage transmise à `Saleor_Common` — laisse le temps à `db-migrate` de se terminer en premier. |
| `liveness_probe` | HTTP `/health/`, délai de 60s | Sonde de vivacité transmise à `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif — nécessite un point de terminaison accessible publiquement. |
| `alert_policies` | `[]` | Stratégies d'alerte métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options standard de VPC-SC et de journalisation d'audit d'App_GKE — voir
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes (API principale). |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer — renseignée uniquement lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée ; vide sur le déploiement `ClusterIP` actuel de ce projet. |
| `service_url` | URL pour atteindre Saleor. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image API déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

L'URL de la charge de travail du tableau de bord est renvoyée dans l'environnement
de l'API principale sous le nom `SALEOR_DASHBOARD_URL` plutôt que comme une sortie Terraform
de premier niveau.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide chaque JWT émis — toutes les sessions actives doivent se réauthentifier. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | Élevé | Des tailles plus petites provoquent des OOMKill sous l'arrondi de mémoire d'Autopilot, confirmé en direct pour la charge de travail combinée uvicorn + Celery. |
| `service_type` | `LoadBalancer` une fois que le quota IP le permet | Moyen | `ClusterIP` (état actuel de ce projet) rend Saleor inaccessible sauf via `kubectl port-forward` ou depuis l'intérieur du cluster. |
| `enable_redis` / `redis_host` | Cohérent — définir les deux ensemble, ou aucun | Élevé | L'activation de Redis sans hôte accessible (et sans `enable_nfs` pour le repli) interrompt la composition `CACHE_URL`/`CELERY_BROKER_URL`. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Récupérer rapidement de Secret Manager | Élevé | Le compte administrateur de démarrage est le seul moyen d'accéder au premier déploiement. |
| `termination_grace_period_seconds` | ≥ 30s | Moyen | Trop court coupe le worker Celery en pleine tâche lors d'une mise à jour progressive ou d'une réduction d'échelle. |
| `enable_iap` | uniquement lorsque le tableau de bord/l'API n'ont pas besoin d'accès public | Élevé | IAP bloque les requêtes non authentifiées vers les services API et tableau de bord. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Saleor
partagée avec la variante Cloud Run est décrite dans
**[Saleor_Common](Saleor_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Saleor sur GKE Autopilot](../labs/Saleor_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Saleor sur Google Cloud Run](Saleor_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Saleor Common — Configuration d'application partagée](Saleor_Common.md) — la configuration partagée par les deux cibles de déploiement.
