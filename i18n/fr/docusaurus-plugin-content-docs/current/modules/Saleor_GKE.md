---
title: "Saleor sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Saleor sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Saleor_GKE.md @ 1665a43e sha256:2cf6f19dc422 -->

# Saleor sur GKE Autopilot {#saleor-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_GKE.png" alt="Saleor sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor est une plateforme e-commerce headless open-source, GraphQL-first, basée
sur Python/Django (catalogue de produits, paiement, commandes et plugins de
paiement, tous exposés via une API GraphQL plutôt que via une vitrine
intégrée). Ce module déploie Saleor sur **GKE Autopilot** sur la base de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Saleor et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## Coût de Saleor sur RAD et comparaison {#what-saleor-costs-on-rad-and-how-that-compares}

**L'exécution de Saleor dans votre propre projet GCP coûte environ 106,53 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits une seule fois (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits au fur et à mesure de l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~106,53 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~97 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **106,53 $** |

### Comparaison {#how-it-compares}

- L'offre gérée officielle de Saleor, Saleor Cloud, commence à **1 599 $/mois** (niveau Select, jusqu'à 200 000 $ de GMV ; source : https://saleor.io/pricing) — destinée aux vitrines de production avec un volume de transactions réel, ce n'est donc pas une comparaison directe avec un déploiement en libre-service unique, mais c'est le seul prix commercial vérifié pour cette plateforme exacte.
- L'empreinte propre de Saleor ici (1x vCPU / 1 GiB) est plus petite que cette classe de référence, donc un niveau de VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Saleor est une API de commerce dont dépendent les vitrines en direct, de sorte que la disponibilité a tendance à être plus importante ici que de réduire le coût d'exécution — mais le même mécanisme de pause ci-dessous s'applique toujours à une vitrine de staging ou de démonstration qui ne prend pas de commandes en direct.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression d'un module, cela ne supprime pas Cloud
SQL, une VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte que quelques crédits (moins
de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD
gère uniquement pour la facturation), vous devez le restaurer vous-même dans
les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, de sorte que
votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
crédits pour le niveau sandbox qui convient à la plupart des utilisations
d'étude/démo). Google indique que la plupart des services fonctionnent à nouveau
pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Saleor
purement et simplement et de le redéployer plus tard. Un redéploiement coûte à
nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de
temps de build.

La suppression ne permet d'économiser de l'argent que si Saleor reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son coût
d'exécution quotidien — par rapport au total du projet propre ci-dessus, cela
représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici
est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent
que si rien d'autre dans le projet ne les utilise, donc la suppression de cette
application pendant que quelque chose d'autre partage le projet n'économise que
la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est mise en pause et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
radmodules.dev/pricing pour les frais propres de RAD et les estimations de
crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects
pour les mécanismes de pause/restauration ; https://saleor.io/pricing pour le
prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Saleor s'exécute en tant que conteneur personnalisé (`ghcr.io/saleor/saleor:3.23` encapsulé avec un
point d'entrée cloud) sur GKE Autopilot. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Deux charges de travail Kubernetes : l'API Saleor principale (uvicorn, 2 workers + Celery worker/beat co-localisés) et un tableau de bord pré-construit séparé ; 2 vCPU / 3 GiB par défaut sur le pod principal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — fixé par `Saleor_Common` quelle que soit la valeur de `database_type` |
| Stockage d'objets | Cloud Storage | Un bucket `media` dédié provisionné automatiquement |
| Cache et broker | Redis (optionnel) | Prend en charge `CACHE_URL`/`CELERY_BROKER_URL` pour le Celery worker co-localisé |
| Secrets | Secret Manager | `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Valeur par défaut du module `LoadBalancer` ; **le déploiement en direct de ce projet exécute actuellement `ClusterIP`** en raison d'un quota d'IP épuisé — voir Notes ci-dessous |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Saleor_Common` fixe le moteur de base de données ;
  la sélection de toute autre valeur dans `database_type` n'a aucun effet.
- **Le Celery worker (traitement des commandes, webhooks, e-mails, tâches
  planifiées) s'exécute co-localisé à l'intérieur du conteneur du pod
  principal**, démarré en tant que processus d'arrière-plan par le point
  d'entrée cloud — pas un déploiement `additional_services` séparé. GKE n'a pas de chemin de
  partage de build entre l'application principale et un déploiement sidecar,
  pas plus que Cloud Run.
- **Le dimensionnement des ressources est pré-réglé : `2000m` CPU / `3Gi`
  mémoire.** Confirmé en direct sur GKE Autopilot que des tailles plus petites
  (même `1Gi`/`2` vCPU, arrondies par Autopilot à `2176Mi`)
  OOMKill sous la charge combinée de 2 workers uvicorn + Django + Celery
  worker/beat.
- **Trois secrets sont générés automatiquement** : `SECRET_KEY`, `RSA_PRIVATE_KEY`
  (paire de clés de signature JWT de Saleor — ne doit jamais être tournée de
  manière occasionnelle), et `DJANGO_SUPERUSER_PASSWORD`.
- **Une charge de travail de tableau de bord séparée, véritablement
  pré-construite** (`ghcr.io/saleor/saleor-dashboard:3.23`) est déployée à côté de l'API en tant
  qu'entrée `additional_services`. Son `API_URL` est intégré à l'interface
  utilisateur servie au démarrage du conteneur, résolu à partir de la sentinelle
  de temps de plan de la Fondation `$(GKE_SERVICE_URL)` + `/graphql/`.
- **La valeur par défaut du module `service_type` est `LoadBalancer` ; ce déploiement
  exécute actuellement `ClusterIP`** — un choix opérationnel fait dans
  `config/deploy.tfvars` car le quota d'IP externes de ce projet (`IN_USE_ADDRESSES`)
  était épuisé au moment du déploiement, et non une décision de conception du
  module. Revenir en arrière une fois le quota d'IP disponible.
- **Redis est optionnel et désactivé par défaut** (`enable_redis = false`). Lorsqu'il est
  activé avec `redis_host` laissé vide, il revient à l'IP de la VM du
  serveur NFS.
- **Les sondes de santé ciblent `/health/`**, non authentifiées, confirmées 200
  à la fois localement et en direct.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — les charges de travail de l'API et du tableau de bord Saleor {#a-gke-autopilot--the-saleor-api-and-dashboard-workloads}

Les pods de l'API de Saleor sont planifiés sur Autopilot, qui facture le CPU/la
mémoire que les pods demandent réellement. Le tableau de bord s'exécute comme
une deuxième charge de travail indépendante (une entrée `additional_services`) servant le
bundle d'interface utilisateur statique de l'administration.

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

Saleor stocke toutes les données d'application (produits, commandes, paiements,
utilisateurs, enregistrements de paiement) dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Les pods y accèdent en privé via le sidecar **Cloud SQL
Auth Proxy** en boucle locale ; aucune IP publique n'est exposée. Lors du
premier déploiement, `db-init` crée la base de données et le rôle de
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
les actifs de produits/médias téléchargés de Saleor. Le compte de service de la
charge de travail se voit accorder l'accès. Des buckets supplémentaires peuvent
être déclarés via `storage_buckets`.

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
compose `CACHE_URL` (base de données Redis `/0`) et `CELERY_BROKER_URL`
(base de données Redis `/1`) à partir de `REDIS_HOST`/`REDIS_PORT`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs from the running pod's env:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'CACHE_URL|CELERY_BROKER_URL'
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (clé de signature cryptographique de Django), `RSA_PRIVATE_KEY` (paire
de clés de signature JWT pour tous les jetons d'accès/actualisation émis) et
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

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8000
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles (les vérifications de disponibilité
nécessitent un point de terminaison publiquement accessible).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
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
  `citext` sont installées sans condition par la configuration assemblée de
  `Saleor_Common` — les variables `enable_postgres_extensions`/`postgres_extensions` du module appelant
  n'ont aucun effet supplémentaire sur cet ensemble de base.
- **Le Celery worker + beat s'exécute en co-localisation, et non en tant que
  charge de travail séparée.** Le traitement des commandes, les webhooks, les
  e-mails et les tâches planifiées s'exécutent tous à l'intérieur du processus
  worker d'arrière-plan du pod principal.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY` et `DJANGO_SUPERUSER_PASSWORD` sont immuables après le
  premier démarrage.** `RSA_PRIVATE_KEY` en particulier signe chaque JWT émis par
  Saleor — le faire pivoter invalide toutes les sessions actives. Ne le faites
  pivoter que pendant une fenêtre de maintenance planifiée.
- **Démarrage du superutilisateur.** Le point d'entrée cloud exécute
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` à chaque démarrage lorsque `DJANGO_SUPERUSER_PASSWORD` est défini
  (idempotent — une opération nulle une fois que l'utilisateur existe).
  `SALEOR_SUPERUSER_EMAIL` est par défaut `admin@example.com` et n'est pas exposé en tant que
  variable sur ce module — c'est la valeur par défaut fixe de `Saleor_Common`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health/` — le point de terminaison de santé non authentifié de Saleor,
  confirmé pour renvoyer `200` dès que le serveur ASGI accepte les
  connexions.
- **L'`API_URL` du tableau de bord est intégré au démarrage du conteneur**,
  non lu dynamiquement — confirmé via le propre `/docker-entrypoint.d/50-replace-env-vars.sh` de l'image
  officielle du tableau de bord, qui remplace `API_URL` par sed dans le
  `index.html` construit. Sur GKE, cela utilise `$(GKE_SERVICE_URL)` — la sentinelle
  de temps de plan de la Fondation résolue à l'URL de service réelle de
  l'application principale, car Kubernetes n'interpole pas `$(VAR)` entre
  les conteneurs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Saleor sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `saleor` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Correspond à l'ARG de build `SALEOR_VERSION` (`3.23` lorsque `latest`) et au tag de l'image du tableau de bord. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Dimensionné pour la charge de travail combinée uvicorn + Celery — voir Vue d'ensemble. |
| `min_instance_count` | `0` | Réplicas minimum (HPA minReplicas). |
| `max_instance_count` | `1` | Réplicas maximum (HPA maxReplicas). |
| `container_port` | `8000` | Port de liaison d'uvicorn — doit correspondre au `CMD` de l'image de base. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions en boucle locale. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés en plus des valeurs par défaut de `Saleor_Common` (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Ne pas définir `SECRET_KEY`, `RSA_PRIVATE_KEY` ou `DJANGO_SUPERUSER_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | **Ce déploiement remplace actuellement par `ClusterIP` dans `deploy.tfvars`** en raison d'un quota d'IP épuisé — voir Vue d'ensemble. |
| `workload_type` | `Deployment` (impliqué par `null`) | Saleor se déploie en tant que `Deployment` ; `StatefulSet` n'est pas utilisé. |
| `session_affinity` | `ClientIP` | Routage persistant. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL — donne au Celery worker le temps de terminer les tâches en cours. |

### Groupe 8 — Scripts SQL personnalisés {#group-8--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 11/12 — Jobs et tâches planifiées {#group-1112--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour la paire intégrée `db-init` → `db-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, commandes de gestion Saleor). |

### Groupe 13/15 — Système de fichiers (NFS) et Redis {#group-1315--filesystem-nfs--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Déclaré mais non utilisé par le propre chemin de stockage de Saleor — les médias sont servis à partir du bucket GCS `media`. Également la source du repli IP NFS de Redis lorsque `enable_redis = true` et `redis_host = ""`. |
| `enable_redis` | `false` | Active le cache/broker de Saleor sur Redis. |
| `redis_host` | `""` | Revient à l'IP du serveur NFS lorsque `enable_nfs = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 14/16 — Cloud Storage et base de données {#group-1416--cloud-storage--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires, en plus du bucket `media` déclaré par `Saleor_Common`. |
| `database_type` | `POSTGRES` | Déclaré pour la parité de convention ; `Saleor_Common` fixe toujours PostgreSQL 15 quelle que soit cette valeur. |
| `application_database_name` | `gkeapp` | Nom de la base de données PostgreSQL. Surcharge recommandée : `saleor_db`. Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de la base de données de l'application. Surcharge recommandée : `saleor_user`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Gateway API + IP statique pour les noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | Recommandé une fois que `service_type` est repassé à `LoadBalancer`. |

### Groupe 10/22 — Observabilité et santé {#group-1022--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, délai de 90s | Sonde de démarrage transmise à `Saleor_Common` — permet à `db-migrate` de se terminer en premier. |
| `liveness_probe` | HTTP `/health/`, délai de 60s | Sonde de vivacité transmise à `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring optionnelle — nécessite un point de terminaison publiquement accessible. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

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
| `service_external_ip` | IP externe de l'équilibreur de charge — renseignée uniquement lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée ; vide sur le déploiement `ClusterIP` actuel de ce projet. |
| `service_url` | URL pour atteindre Saleor. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image API déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

L'URL propre à la charge de travail du tableau de bord est renvoyée dans
l'environnement de l'API principale en tant que `SALEOR_DASHBOARD_URL` plutôt que comme
une sortie Terraform de niveau supérieur.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide échoue le **plan** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide chaque JWT émis — toutes les sessions actives doivent se réauthentifier. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | Élevé | Des tailles plus petites OOMKill sous l'arrondi de mémoire d'Autopilot, confirmé en direct pour la charge de travail combinée uvicorn + Celery. |
| `service_type` | `LoadBalancer` une fois que le quota d'IP le permet | Moyen | `ClusterIP` (état actuel de ce projet) rend Saleor inaccessible sauf via `kubectl port-forward` ou depuis l'intérieur du cluster. |
| `enable_redis` / `redis_host` | Cohérent — définir les deux ensemble, ou aucun | Élevé | L'activation de Redis sans hôte accessible (et sans `enable_nfs` pour le repli) interrompt la composition `CACHE_URL`/`CELERY_BROKER_URL`. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Récupérer rapidement de Secret Manager | Élevé | Le compte administrateur de démarrage est le seul moyen d'accéder au premier déploiement. |
| `termination_grace_period_seconds` | ≥ 30s | Moyen | Trop court coupe le Celery worker en plein milieu d'une tâche lors d'une mise à jour progressive ou d'une réduction d'échelle. |
| `enable_iap` | uniquement lorsque le tableau de bord/l'API n'ont pas besoin d'un accès public | Élevé | IAP bloque les requêtes non authentifiées vers les services API et tableau de bord. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Saleor
partagée avec la variante Cloud Run est décrite dans
**[Saleor_Common](Saleor_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Saleor sur GKE Autopilot](../labs/Saleor_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Saleor sur Google Cloud Run](Saleor_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Saleor Common — Configuration d'application partagée](Saleor_Common.md) — la configuration partagée par les deux cibles de déploiement.
