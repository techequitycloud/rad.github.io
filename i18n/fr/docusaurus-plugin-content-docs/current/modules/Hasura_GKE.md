---
title: "Hasura sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Hasura sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Hasura_GKE.md @ 40c83c3f sha256:8ce3994f6c35 -->

# Hasura sur GKE Autopilot {#hasura-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hasura_GKE.png" alt="Hasura sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hasura est un moteur open source sous licence Apache 2.0 qui fournit une API
GraphQL (et REST) instantanée et en temps réel sur une base de données
PostgreSQL, avec une autorisation granulaire basée sur les rôles, des
déclencheurs d'événements et une console d'administration intégrée. Ce module
déploie le moteur GraphQL Hasura (`hasura/graphql-engine`) sur **GKE Autopilot**
par-dessus la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Hasura et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
—, reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## Ce que coûte Hasura sur RAD, et comment cela se compare {#what-hasura-costs-on-rad-and-how-that-compares}

**L'exécution d'un pod Hasura sur GKE Autopilot dans votre propre projet Google
Cloud coûte environ 104,74 $/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 110 crédits facturé une fois au moment du déploiement. Le
produit cloud commercial de Hasura s'est éloigné de l'hébergement du moteur
GraphQL open source classique que ce module déploie — sa page de tarification
actuelle (vérifiée le 8 octobre 2026) ne liste que le nouveau produit supergraph
« DDN », sans plan séparé pour le moteur Community Edition, ce n'est donc pas
une comparaison juste à citer ici. Dans un projet géré par RAD, les frais de
module tombent à 99 crédits (10 % de moins) et le coût d'exécution est mesuré
toutes les heures en crédits au lieu d'être facturé directement par Google —
voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut
pas égaler — ou voir le [guide Cloud Run](Hasura_CloudRun.md) pour l'option la
moins chère.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Identique |
| Coût d'exécution Google Cloud | 104,74 $/mois, facturé par Google au prix catalogue | ~122 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel
que soit le montant des frais : une fois par compte, pour un module que vous
déployez et payez vous-même (dans une solution, les frais d'une application : la
première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 0,5 GiB | 34,29 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **104,74 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont
partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule,
sinon environ 73 $/mois répartis entre le nombre d'applications que vous
exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24
  $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois,
  et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois
  — suffisant pour exécuter le moteur Hasura et sa base de données Postgres
  ensemble sur une seule machine.
- Le moteur lui-même (1 vCPU/0,5 GiB) est léger ; la majeure partie du coût
  d'exécution ci-dessus est l'instance Postgres dédiée dont l'introspection
  GraphQL a besoin pour rester rapide, ce qu'une machine auto-gérée aurait
  également besoin.
- Comme ailleurs, les chiffres VPS ci-dessus sont moins chers en termes
  monétaires mais n'incluent pas les sauvegardes gérées, les correctifs ou la
  rotation des secrets — Cloud SQL, Secret Manager et la surveillance de RAD
  s'en chargent pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet purement et
simplement — la suppression logique récupérable de 30 jours de Google. Contrairement
à la suppression d'un module, cela ne démantèle **pas** Cloud SQL, aucune VM,
ni la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être invoquée comme moyen de récupérer
> un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des
> sauvegardes appropriées des données et de la configuration de l'application
> et de les avoir stockées en dehors du projet. Si une restauration échoue, ou
> si le projet restauré ne fonctionne pas, la solution de repli consiste à
> redéployer l'application (voir la section suivante) et à restaurer sa
> configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
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
indique que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé Hasura et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression retire les
ressources définitivement, et ramener Hasura signifie redéployer à partir de
zéro. Cela coûte 110 crédits (les frais de module ; les builds sont inclus).

La suppression ne permet d'économiser de l'argent que si Hasura reste inutilisé
assez longtemps pour que le coût de redéploiement soit compensé par son propre
coût d'exécution — pour Hasura, c'est environ 4 jours ou plus. La majeure
partie de ce coût d'exécution est généralement la base de données (et, lorsque
ce module en utilise un, la VM de serveur de fichiers partagé ou le cluster GKE)
— ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise,
donc la suppression de cette application alors que quelque chose d'autre partage
le projet n'économise que sa propre part de calcul.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, afin que personne ne
reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les
déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Hasura s'exécute comme une charge de travail web Haskell sans état. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Haskell, 1 vCPU / 512 Mio par défaut, auto-scalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le catalogue de métadonnées de Hasura et la source de données par défaut résident tous deux dans Postgres |
| Stockage d'objets | Aucun | Hasura est sans état ; aucun bucket n'est provisionné |
| Secrets | Secret Manager | `HASURA_GRAPHQL_ADMIN_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, nom de domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; Hasura conserve son propre catalogue de
  métadonnées dans Postgres.
- **Le secret d'administration protège tout ce qui est sensible.** `HASURA_GRAPHQL_ADMIN_SECRET` est
  généré automatiquement, stocké dans Secret Manager et matérialisé dans
  l'espace de noms via le pilote CSI Secret Store. Il protège l'interface
  utilisateur `/console` et les API `/v1/graphql` et `/v1/metadata` ; `/healthz` reste public pour les sondes.
- **Deux URL de connexion sont assemblées dans le conteneur.** Le point
  d'entrée de l'image personnalisée construit `HASURA_GRAPHQL_DATABASE_URL` et `HASURA_GRAPHQL_METADATA_DATABASE_URL`
  à partir des variables `DB_*` injectées. Sur GKE, le sidecar Cloud SQL Auth
  Proxy écoute sur `127.0.0.1`, donc le point d'entrée utilise un DSN de bouclage
  simple sans `sslmode` (le proxy termine TLS).
- **Déploiement sans état, pas de routage persistant.** `workload_type = "Deployment"` et
  `session_affinity = "None"` — chaque pod est interchangeable car tout l'état est dans
  Postgres, donc les mises à jour progressives sont sûres et aucun PVC/NFS
  n'est utilisé.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la
  mise à l'échelle à zéro) afin que l'API soit toujours accessible ; un
  PodDisruptionBudget (`pdb_min_available = "1"`) préserve la disponibilité pendant les mises à
  niveau des nœuds.
- **Exposé sur une IP externe stable.** `service_type = "LoadBalancer"`, `reserve_static_ip = true` et `enable_custom_domain = true` par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Hasura {#a-gke-autopilot--the-hasura-workload}

Les pods Hasura sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre les nombres de réplicas minimum et maximum.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Hasura pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Hasura stocke son catalogue de métadonnées (tables suivies, relations,
permissions, déclencheurs d'événements) **et** vos données d'application dans
une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent
privatement via le sidecar **Cloud SQL Auth Proxy** en bouclage ; aucune IP
publique n'est exposée. Lors du premier déploiement, un job d'initialisation
crée la base de données et l'utilisateur de l'application ; Hasura installe son
schéma de métadonnées au premier démarrage.

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

### C. Secret Manager {#c-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `HASURA_GRAPHQL_ADMIN_SECRET`. Il est matérialisé dans l'espace de noms via le pilote CSI
Secret Store et injecté comme variable d'environnement. Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing, avec une IP statique réservée afin que l'adresse survive aux
redéploiements et un certificat géré par Google pour le domaine personnalisé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Hasura {#3-hasura-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur de l'application, et accorde les privilèges. Le job peut être
  réexécuté en toute sécurité.
- **Catalogue de métadonnées au démarrage.** Hasura installe et migre son
  propre schéma de catalogue de métadonnées dans Postgres au démarrage, de sorte
  que la mise à niveau de la version de l'image applique les modifications du
  catalogue sans étape de migration distincte. Les métadonnées des tables
  suivies persistent dans la base de données lors des redémarrages de pods et
  des mises à jour progressives.
- **Deux URL de connexion, assemblées dans le conteneur.** Le point d'entrée
  construit à la fois `HASURA_GRAPHQL_DATABASE_URL` et `HASURA_GRAPHQL_METADATA_DATABASE_URL` à partir des variables `DB_*`
  injectées. Comme le sidecar Auth Proxy écoute sur `127.0.0.1`, le DSN est un
  bouclage simple sans SSL.
- **Le secret d'administration est la limite de sécurité.** Envoyez-le comme
  en-tête `x-hasura-admin-secret` :
  ```bash
  ADMIN=$(gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT")
  curl -s "http://${EXTERNAL_IP}/v1/graphql" \
    -H "x-hasura-admin-secret: $ADMIN" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/healthz`
  — le point de terminaison public, non authentifié, qui renvoie 200 une fois
  que le moteur est opérationnel et connecté à Postgres. Ne redirigez pas les
  sondes vers `/v1/graphql` ou `/console` (tous deux 401 sans le secret
  d'administration), sinon les pods ne deviendront jamais Ready.
- **Accès à la console.** Accédez à la console à l'adresse `http://<external-ip>/console` (ou au
  domaine personnalisé) et collez le secret d'administration pour suivre les
  tables et exécuter des requêtes GraphQL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Hasura sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; un suffixe `-gke` est ajouté en interne afin que les variantes CloudRun et GKE n'entrent jamais en collision. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hasura` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Hasura` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Hasura GraphQL Engine on GKE Autopilot` | Description du service. |
| `application_version` | `v2.36.0` | Tag d'image Hasura ; `latest` est remappé vers un tag v2.x épinglé au moment du build. |
| `application_database_name` | `hasura` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `hasura` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit une image wrapper qui assemble les DSN ; `prebuilt` nécessite une configuration d'URL manuelle. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Limites et requêtes CPU/mémoire. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE nécessite ≥ 1 (pas de mise à l'échelle à zéro). |
| `max_instance_count` | `10` | Réplicas maximum. Hasura s'adapte horizontalement. |
| `workload_type` | `Deployment` | Sans état — Hasura conserve tout l'état dans Postgres. |
| `container_port` | `8080` | Hasura lie `HASURA_GRAPHQL_SERVER_PORT = 8080`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connexion Postgres. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Hasura dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant l'Ingress (API incluse). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `None` | Pas de routage persistant — Hasura est sans état. |
| `network_tags` | `[]` | Tags réseau de nœud/pod. Ajoutez `nfsserver` si vous activez `enable_nfs`. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser vide. Non recommandé — Hasura stocke tout l'état dans PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` | `10Gi` / `/data` | Pertinent uniquement si un StatefulSet est forcé. |

### Groupe 8 — Variables d'environnement et secrets {#group-8--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `HASURA_GRAPHQL_*` supplémentaires. Ne définissez pas les deux valeurs `*_DATABASE_URL` ou le secret d'administration ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms (les valeurs de mémoire nécessitent des suffixes binaires, par exemple `4Gi`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, `failure_threshold=30` | Sonde de démarrage. |
| `health_check_config` | HTTP `/healthz`, `failure_threshold=3` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Hasura. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis pour Hasura. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Hasura ne nécessite aucun stockage de fichiers. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Déclaré pour la mise en miroir des variables de la Fondation mais non transmis à [App_GKE](App_GKE.md) dans ce module — Hasura ne nécessite pas Redis, donc cette variable n'a aucun effet quelle que soit sa valeur. |
| `redis_host` / `redis_port` | `""` / `6379` | Également inerte pour la même raison que `enable_redis`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — Hasura nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods en continu. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` | `false` | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir ; vide utilise l'hôte nip.io de l'IP réservée. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id` pour les projets imbriqués dans des dossiers). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Hasura. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Hasura). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1`
> avec des montages NFS/GCS, une `database_type` qui ne correspond pas à une extension
> activée, une `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `HASURA_GRAPHQL_ADMIN_SECRET` (auto-généré) | Conserver dans Secret Manager ; faire pivoter délibérément | Critique | C'est la seule protection sur les API GraphQL/métadonnées et la console — l'exposer accorde un accès complet en lecture/écriture à toutes les tables suivies. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline le catalogue de métadonnées et toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `startup_probe_config` / `health_check_config` chemin | `/healthz` | Élevé | Pointer une sonde vers `/v1/graphql` ou `/console` renvoie 401 — les pods ne deviennent jamais Ready même si le moteur a démarré. |
| `container_image_source` | `custom` | Élevé | `prebuilt` ignore le point d'entrée qui assemble les deux valeurs `*_DATABASE_URL` — le moteur démarre sans base de données et chaque requête échoue. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une protection de validation au moment de la planification. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la protection de validation rejette les valeurs invalides. Maintenir 1 garantit que l'API est toujours accessible. |
| `workload_type` / `stateful_pvc_enabled` | `Deployment` / non défini | Moyen | Forcer un StatefulSet ne gagne rien (l'état est dans Postgres) et complique les mises à jour progressives. |
| `HASURA_GRAPHQL_ENABLE_CONSOLE` | `false` en production | Moyen | Laisser la console activée élargit la surface d'attaque ; gérer les métadonnées via la CLI/les migrations `hasura` à la place. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Hasura
partagée avec la variante Cloud Run est décrite dans
**[Hasura_Common](Hasura_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Hasura sur GKE Autopilot](../labs/Hasura_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Hasura sur Google Cloud Run](Hasura_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hasura Common — Configuration d'application partagée](Hasura_Common.md) — la configuration partagée par les deux cibles de déploiement.
