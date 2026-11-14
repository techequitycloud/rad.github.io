---
title: "ToolJet sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de ToolJet sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ToolJet_GKE.md @ 40c83c3f sha256:beca7a8b73cf -->

# ToolJet sur GKE Autopilot {#tooljet-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_GKE.png" alt="ToolJet sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet est une plateforme open source low-code pour la création et le
déploiement d'outils internes — tableaux de bord, panneaux d'administration,
applications CRUD et workflows — avec un constructeur par glisser-déposer sur
vos propres bases de données et API. Ce module déploie ToolJet sur **GKE
Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par ToolJet et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Coût de ToolJet sur RAD et comparaison {#what-tooljet-costs-on-rad-and-how-that-compares}

**L'exécution de ToolJet sur GKE Autopilot dans votre propre projet Google Cloud
coûte environ 149,81 $ US/mois en frais Google Cloud** (environ 222,81 $ US si
ce n'est pas votre seul cluster Autopilot), en plus d'un frais de module RAD de
300 crédits (30 $ US) facturé une seule fois au moment du déploiement. GKE
Autopilot convient à ToolJet qui doit rester opérationnel, s'adapter à travers
les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour
le coût le plus bas, consultez plutôt le [guide Cloud Run](ToolJet_CloudRun.md).
Dans un projet géré par RAD, les frais de module tombent à 270 crédits (10 % de
moins) et le coût d'exécution est mesuré à l'heure en crédits — voir [Mettez-le
en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 300 crédits | 270 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites, puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | 149,81 $ US/mois, facturé par Google au prix catalogue | ~141 crédits/jour (environ 4 230/mois, 423 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan
mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **149,81 $ US** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont
partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule,
sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comparaison {#how-it-compares}

- **ToolJet Cloud**, hébergé par ToolJet, facture par siège de **développeur** :
  Basic est à 23 $/développeur/mois (facturé annuellement), Pro est à 79
  $/développeur/mois, et Team — son niveau le plus populaire — est à 199
  $/développeur/mois, avec Enterprise sur devis — vérifié sur la page de prix de
  ToolJet, 8 octobre 2026. Le coût d'exécution de RAD pour un projet propre est
  un forfait d'environ 150 $/mois, quel que soit le nombre d'employés.
- Une comparaison autogérée, dimensionnée au-dessus de la classe micro-VPS
  habituelle pour le défaut 2 vCPU / 4 Gio de ToolJet : une instance GCP Compute
  Engine `e2-standard-4` (4 vCPU/16 Go) coûte environ 98 $/mois à elle seule, avant une
  instance Postgres gérée et un plan de contrôle Kubernetes — plus votre propre
  temps pour les correctifs et les sauvegardes, que la pile gérée de RAD couvre
  pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes
  monétaires ; l'avantage de RAD est ce qui est géré pour vous, et la capacité
  de mettre ToolJet en pause gratuitement (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet purement et simplement
— une suppression logique récupérable de 30 jours par Google. Contrairement à la
suppression d'un seul module, cela ne démantèle **pas** Cloud SQL, aucune VM ou
la ressource de calcul une par une : l'ensemble du projet s'arrête simplement,
et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être invoquée comme moyen de récupérer
> un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des
> sauvegardes appropriées des données et de la configuration de l'application et
> de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le
> projet restauré ne fonctionne pas, la solution de repli consiste à redéployer
> l'application (voir la section suivante) et à restaurer sa configuration et ses
> données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Étant donné que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le
prix (5 par mois pour chaque déploiement), donc une restauration ne coûte
normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google
affirme que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
jours. Si vous avez personnalisé ToolJet et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources définitivement, et le retour de ToolJet signifie un redéploiement à
partir de zéro. Cela coûte environ 303-306 crédits dans votre propre projet, ou
environ 273-276 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si ToolJet reste inutilisé
assez longtemps pour compenser le coût de redéploiement par rapport à son propre
coût d'exécution — environ 6 jours ou plus dans votre propre projet (environ
4,99 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (141
crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, de sorte que personne
ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et
les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de suppression/restauration de projet de Google](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ; [prix de ToolJet](https://www.tooljet.com/pricing).

## 1. Vue d'ensemble {#1-overview}

ToolJet s'exécute comme une seule charge de travail web NestJS + React — l'API
backend et le client compilé sont servis à partir du même processus (`SERVE_CLIENT = "true"`) sur
le port 80. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 Gio par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — **deux** bases de données sur une seule instance (métadonnées + ToolJet Database) |
| ToolJet Database | PostgREST (déploiement `additional_services`) | Sert la deuxième base de données (`<service_name>_tjdb`) aux requêtes d'application ; signé avec `PGRST_JWT_SECRET` |
| Cache et file d'attente | Redis | Activé par défaut ; prend en charge les files d'attente BullMQ de ToolJet ; la VM NFS co-héberge Redis lorsque `redis_host` est vide |
| Secrets | Secret Manager | `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **Deux bases de données sont créées.** Le job `db-init` de premier déploiement
  crée la base de données de métadonnées et la deuxième "ToolJet Database"
  (`<service_name>_tjdb`), et accorde à la rôle d'application partagé l'attribut **`CREATEROLE`**.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée du
  conteneur exécute `npm run db:migrate:prod` (TypeORM) **avant** de lancer le serveur.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont générés
  automatiquement** et stockés dans Secret Manager. Ces clés ne doivent jamais
  être renouvelées après le premier démarrage — le renouvellement de `LOCKBOX_MASTER_KEY`
  corrompt toutes les informations d'identification de source de données
  stockées, et le renouvellement de `SECRET_KEY_BASE` invalide toutes les sessions.
- **L'affinité de session est `ClientIP` par défaut.** Le constructeur d'applications
  de ToolJet utilise des connexions WebSocket persistantes pour l'édition
  multi-utilisateur ; les requêtes du même client doivent atteindre le même pod.
- **`PORT` est défini par défaut à 80 par le point d'entrée.** GKE n'injecte pas
  `PORT`, donc sans la valeur par défaut, ToolJet se lierait à 3000 tandis que le
  Service et les sondes cibleraient 80.
- **Redis est activé par défaut** et, avec un `redis_host` vide, l'IP de la VM du
  serveur NFS est injectée comme `REDIS_HOST` (`enable_nfs = true` provisionne cette VM).
- **Une IP externe stable + hôte HTTPS `nip.io`** sont provisionnés
  immédiatement (`reserve_static_ip = true`, `enable_custom_domain = true`).
- **L'inscription est désactivée par défaut.** `DISABLE_SIGNUPS = "true"` est activé ; la première
  exécution est un **assistant de configuration** qui crée l'utilisateur
  administrateur initial et l'espace de travail.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ToolJet {#a-gke-autopilot--the-tooljet-workload}

Les pods ToolJet sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail ToolJet pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 — deux bases de données {#b-cloud-sql-for-postgresql-15--two-databases}

ToolJet stocke toutes les données de l'application — applications,
configurations de sources de données, utilisateurs, espaces de travail, sessions
— dans une instance Cloud SQL pour PostgreSQL 15 gérée, et utilise une **seconde
base de données** (`<service_name>_tjdb`) sur la même instance pour la fonctionnalité intégrée
ToolJet Database. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth
Proxy** sur un point de terminaison TCP de bouclage (`127.0.0.1`) ; aucune IP
publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée les deux bases de données, le rôle partagé `CREATEROLE`,
`pgcrypto` et un schéma `postgrest` appartenant à l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<service_name>_tjdb --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

> **`enable_cloudsql_volume` doit rester `true` sur GKE.** Le sidecar Auth Proxy
> fournit le point de terminaison PostgreSQL `127.0.0.1` dont dépendent le pod et le
> job `db-create` ; le désactiver sur GKE bloque `db-create`.

### C. Redis (file d'attente et cache) {#c-redis-queue--cache}

Redis est **activé par défaut** et prend en charge les files d'attente BullMQ de
ToolJet (tâches en arrière-plan, notifications, éditeur multi-utilisateur).
Lorsque `redis_host` est laissé vide et `enable_nfs = true`, l'IP privée de la VM du serveur
NFS est injectée comme `REDIS_HOST` ; définissez `redis_host` explicitement pour pointer
vers une instance Memorystore à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY_BASE` (signe les sessions), `LOCKBOX_MASTER_KEY` (chiffre toutes les
informations d'identification de source de données stockées) et `PGRST_JWT_SECRET` (signe
les JWT PostgREST internes). Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing, avec un hôte HTTPS `nip.io` et un certificat géré par Google. Un
domaine personnalisé peut être activé, et une IP statique est réservée afin que
l'adresse survive aux redéploiements. `TOOLJET_HOST` (qui pilote les liens générés et
les URI de redirection OAuth) est par défaut l'URL de service calculée.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Storage et NFS {#f-cloud-storage--nfs}

ToolJet stocke les applications, les configurations de sources de données et les
téléchargements dans PostgreSQL ; un bucket Cloud Storage `data` est provisionné
par défaut (`storage_buckets`) mais ToolJet lui-même n'en dépend pas. NFS est activé par
défaut uniquement parce que sa VM co-héberge Redis lorsque `redis_host` est vide ; les
pods ToolJet eux-mêmes sont sans état.

- **Console :** Cloud Storage → Buckets ; Compute Engine → Instances de VM
  (serveur NFS).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ToolJet {#3-tooljet-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données de
  métadonnées et la ToolJet Database, le rôle partagé `CREATEROLE`, accorde `cloudsqlsuperuser`,
  pré-crée `pgcrypto` et réinitialise le schéma `postgrest` comme appartenant à
  l'application sur les deux bases de données. Sans un schéma `postgrest`
  appartenant à l'application, `reconfigurePostgrest` de ToolJet au démarrage échoue `permission denied for schema postgrest`
  et le pod redémarre en boucle. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent avant le démarrage du serveur.** `cloud-entrypoint.sh` exécute
  `npm run db:migrate:prod` (TypeORM `migration:run`) en premier — `start:prod` de ToolJet est `node dist/src/main` et
  ne migre **pas**. Sans cela, la base de données de métadonnées reste vide et
  toute action basée sur la base de données échoue (`relation "user_sessions" does not exist`).
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont immuables après le premier
  démarrage.** La modification de `LOCKBOX_MASTER_KEY` corrompt toutes les informations
  d'identification de source de données stockées ; la modification de `SECRET_KEY_BASE`
  invalide toutes les sessions. Ne les modifiez que pendant une fenêtre de
  maintenance planifiée.
- **La première exécution est un assistant de configuration.** Avec `DISABLE_SIGNUPS = "true"`,
  ouvrez l'URL externe et complétez l'assistant : il crée le premier
  utilisateur administrateur et l'espace de travail, puis vous amène dans le
  constructeur d'applications.
- **L'édition multi-utilisateur nécessite des sessions persistantes.** `session_affinity = "ClientIP"`
  maintient la connexion WebSocket d'un client sur un seul pod ; sans cela, la
  collaboration en temps réel dans le constructeur est perturbée.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont par défaut
  `/` (le client servi est public et non authentifié) ; `/api/health` est également
  disponible comme chemin de sonde. Prévoyez plusieurs minutes au premier
  démarrage pour l'étape de migration.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
ToolJet sont listés ; toutes les autres entrées sont héritées de
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
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Application et identité de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tooljet` | Nom de base pour les ressources (et la racine de l'espace de noms). Ne pas modifier après le premier déploiement. |
| `application_display_name` | `ToolJet` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `tooljet/tooljet-ce` ; épingler à une version spécifique en production. |
| `application_database_name` | `tooljet` | Nom de la base de données de métadonnées. Immuable après le premier déploiement. |
| `application_database_user` | `tooljet` | Utilisateur de la base de données d'application (partagé par les deux bases de données). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et requêtes CPU/mémoire par pod. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE exige ≥ 1. |
| `max_instance_count` | `5` | Réplicas maximum. **N'augmenter que lorsque Redis est activé** (il l'est, par défaut). |
| `enable_vertical_pod_autoscaling` | `false` | VPA pour l'ajustement automatique des requêtes. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis sur GKE. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image ToolJet dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ou `PG_*` ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (auto) | `Deployment` ou `StatefulSet` ; se résout en `Deployment` si non défini. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour l'éditeur WebSocket multi-utilisateur. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Activer les modèles PVC. Non recommandé — ToolJet stocke tout l'état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 60s | Sonde de démarrage avec un budget large (30 × 15s) pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | activé, HTTP `/` | Sondes d'infrastructure au niveau App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services d'aide supplémentaires, ajoutés au service PostgREST du module. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut ; sa VM co-héberge Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS configurés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée un bucket `data` (l'état propre de ToolJet réside dans PostgreSQL). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Prend en charge les files d'attente BullMQ de ToolJet. Transmis sans modification. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`), ou définir un point de terminaison Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16/17 — Backend de base de données {#group-1617--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods en continu. |

### Groupe 17/6 — Sauvegarde et maintenance {#group-176--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 10/19 — Domaine personnalisé, IP statique et réseau {#group-1019--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress + certificat géré (par défaut un hôte `nip.io`). |
| `application_domains` | `[]` | Noms d'hôtes supplémentaires à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 13/21 — Cloud Armor {#group-1321--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
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
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ToolJet. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de métadonnées. |
| `database_user` | Utilisateur de la base de données d'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
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
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1`
> avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension
> activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt définitivement toutes les informations d'identification de source de données stockées — elles ne peuvent pas être déchiffrées. |
| `SECRET_KEY_BASE` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Critique | Le renouveler invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `PGRST_JWT_SECRET` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler interrompt la couche de requête de la ToolJet Database jusqu'à ce que chaque pod redémarre. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE ; le désactiver bloque `db-create`. |
| Rôle d'application `CREATEROLE` (défini par `db-init`) | Laisser tel que provisionné | Élevé | Sans cela, la création d'espace de travail ToolJet échoue `permission denied to create role`. |
| Schéma `postgrest` appartenant à l'application (défini par `db-init`) | Laisser tel que provisionné | Élevé | Un schéma appartenant à `postgres` fait échouer `reconfigurePostgrest` et le pod redémarre en boucle. |
| `PORT` (valeur par défaut du point d'entrée 80) | Laisser tel que provisionné | Élevé | Si le pod se lie à 3000 alors que le service cible 80, il ne devient jamais prêt. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les reconnexions WebSocket sont acheminées vers différents pods, perturbant l'édition multi-utilisateur. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `memory_limit` | `4Gi` | Élevé | Le serveur ToolJet et son worker peuvent manquer de mémoire en dessous de ~2 Gio sous charge (PostgREST s'exécute comme son propre déploiement). |
| `enable_redis` | `true` | Moyen | Avec Redis désactivé, BullMQ se replie et les fonctionnalités en arrière-plan se dégradent. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `DISABLE_SIGNUPS` (auto-injecté `"true"`) | Garder activé après le premier administrateur | Élevé | L'ouverture de l'inscription permet à toute personne ayant l'URL de créer un compte. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à ToolJet
partagée avec la variante Cloud Run est décrite dans
**[ToolJet_Common](ToolJet_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : ToolJet sur GKE Autopilot](../labs/ToolJet_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ToolJet sur Google Cloud Run](ToolJet_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ToolJet Common — Configuration d'application partagée](ToolJet_Common.md) — la configuration partagée par les deux cibles de déploiement.
