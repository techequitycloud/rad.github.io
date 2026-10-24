---
title: "Strapi sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Strapi sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Strapi_GKE.md @ 1665a43e sha256:83c93aadf968 -->

# Strapi sur GKE Autopilot {#strapi-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Strapi_GKE.png" alt="Strapi sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Strapi est le principal CMS headless open source — offrant une API de contenu
entièrement personnalisable (REST et GraphQL) avec un panneau d'administration
riche, utilisé par les entreprises et les développeurs du monde entier pour la
gestion de contenu et les architectures API-first. Ce module déploie Strapi sur
**GKE Autopilot** sur la base du module [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Strapi et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide du module App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Coût de Strapi sur RAD et comparaison {#what-strapi-costs-on-rad-and-how-that-compares}

**Le module Strapi sur GKE Autopilot de RAD coûte environ 104,74 $ US par mois
dans un projet Google Cloud que vous possédez, les frais de module étant facturés
une seule fois en crédits RAD.** GKE convient à Strapi qui doit coexister avec
d'autres charges de travail Kubernetes ; pour le coût le plus bas, le
[module Cloud Run](Strapi_CloudRun.md) exécute le même Strapi pour environ
98,82 $ US par mois. Si vous n'avez besoin de Strapi qu'occasionnellement — un
projet de contenu entre deux lancements, un site client en cours d'évaluation —
un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour
une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste
inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont
ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3 à 6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **104,74 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **92 crédits par jour**, soit environ 2 760 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un abonnement
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1,
prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 0,5 Gio | 34,29 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **104,74 $ US** |

### Comparaison {#how-it-compares}

- Le plan hébergé de Strapi, **Strapi Cloud**, commence à **35 $/mois** (Starter :
  100 000 requêtes API, 50 Go de stockage/bande passante), et monte à
  **90 $/mois** (Pro) et **450 $/mois** (Business) pour plus de requêtes et de
  stockage (source : [strapi.io/pricing-cloud](https://strapi.io/pricing-cloud)).
  Le chiffre de RAD pour un projet propre est supérieur au prix affiché du plan
  Starter, mais il inclut le CMS headless plus une instance PostgreSQL dédiée,
  un partage NFS et un réseau que vous contrôlez directement, plutôt qu'un
  environnement Strapi géré avec une facturation à l'usage.
- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois,
  un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un
  GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — moins
  cher en termes de coûts, mais aucun n'inclut une base de données gérée, des
  sauvegardes ou TLS, que vous devriez gérer et patcher vous-même.
- La majeure partie du coût de fonctionnement d'un projet propre de RAD ici est
  la base de données et le serveur de fichiers NFS, pas le pod propre de Strapi
  — les mêmes ressources dont toute déploiement CMS sérieux a besoin, gérées
  plutôt qu'auto-administrées.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Strapi s'exécute dans un projet géré par RAD pour vous, la suppression de
l'ensemble du projet délie d'abord sa facturation, puis demande à Google de
supprimer purement et simplement le projet — la suppression logicielle
récupérable de 30 jours de Google. Contrairement à la suppression d'un seul
module, cela ne détruit pas Cloud SQL, la VM NFS ou la ressource de calcul une
par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
éléments.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours
— après cela, Google le supprime définitivement — et la restauration est admise
comme la création d'un nouveau projet, de sorte que votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé vos types de contenu ou téléchargé
des actifs que vous souhaitez conserver, copiez une sauvegarde (vers Google
Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une
installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
est passée, l'alternative est de supprimer Strapi purement et simplement et de
le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module,
plus les builds — environ 115 crédits (environ 11,50 $ US) dans votre propre
projet, ou 104 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Strapi resterait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût de fonctionnement quotidien — par rapport au total
du projet propre ci-dessus (environ 3,49 $ US par jour), cela représente
environ 4 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD
(92 crédits par jour). La majeure partie du coût de fonctionnement ici est la
base de données et le serveur de fichiers NFS ; ils ne s'arrêtent que si rien
d'autre dans le projet ne les utilise, donc la suppression de Strapi alors que
quelque chose d'autre partage le projet n'économise que la partie calcul de
cette application.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration ;
[strapi.io/pricing-cloud](https://strapi.io/pricing-cloud) pour les plans
hébergés de Strapi Cloud.

## 1. Vue d'ensemble {#1-overview}

Strapi s'exécute comme un conteneur Node.js sur GKE Autopilot. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 512 Mio par défaut, auto-mis à l'échelle horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Strapi nécessite PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Téléchargements de médias et actifs partagés entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement dédié (suffixe `strapi-uploads`) |
| Cache (optionnel) | Redis / Memorystore | Optionnel ; désactivé par défaut |
| Secrets | Secret Manager | Cinq secrets cryptographiques auto-générés plus le mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est requis.** La couche de données de Strapi est connectée à
  PostgreSQL ; MySQL et `NONE` empêchent le démarrage.
- **Une image de conteneur personnalisée est construite via Cloud Build.** `container_image_source`
  par défaut à `"custom"` — le module construit une image Node.js 20 en deux
  étapes prête pour la production à chaque incrément de version.
- **Cinq secrets cryptographiques sont auto-générés.** `JWT_SECRET`, `ADMIN_JWT_SECRET`,
  `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` et `APP_KEYS` sont générés et stockés dans
  Secret Manager lors du premier déploiement et ne doivent jamais changer après
  cela — ils signent toutes les sessions actives et les jetons API.
- **NFS est activé par défaut.** Strapi stocke les médias téléchargés sous `/uploads`.
  Sans volume NFS partagé, les médias sont perdus lors du redémarrage du pod.
- **Redis est désactivé par défaut.** Activez-le uniquement lorsque vous
  utilisez des plugins qui nécessitent explicitement un cache partagé ou un
  magasin de sessions.
- **Le port du conteneur est 1337.** Le serveur HTTP de Strapi se lie au port
  1337 par défaut.
- **Les variables du bucket média GCS sont auto-injectées — mais pointent
  actuellement vers le mauvais bucket.** `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont définies
  automatiquement, mais `Strapi_GKE/strapi.tf` calcule le nom du bucket à partir du préfixe de
  ressource réservé au locataire au lieu du nom de bucket à portée d'application
  que le module Foundation (`App_GKE`) crée réellement (`gcs-${service_name}-strapi-uploads`). Les
  valeurs injectées font donc référence à un bucket qui n'existe pas par défaut
  — voir la section 3 et les notes du README du module pour la correction.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Strapi {#a-gke-autopilot--the-strapi-workload}

Les pods Strapi sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre les nombres minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Strapi pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Strapi stocke toutes les données d'application (types de contenu, contenu,
utilisateurs, jetons API) dans une instance Cloud SQL pour PostgreSQL 15 gérée.
Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur un
socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur
de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits dans un partage **Filestore (NFS)** monté
dans chaque pod afin que toutes les répliques voient les mêmes fichiers. Un
bucket **Cloud Storage** dédié (suffixe `strapi-uploads`) est également provisionné
par le module Foundation et le compte de service de la charge de travail y a
accès automatiquement — mais voir le bug connu dans la section 3 : les valeurs
`GCS_BUCKET_NAME`/`GCS_BASE_URL` injectées dans le conteneur ne correspondent
actuellement pas au nom réel de ce bucket, de sorte que le fournisseur de
téléchargement GCS de Strapi ne s'y connecte pas directement.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage →
  Buckets pour le bucket de téléchargement.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Secret Manager {#d-secret-manager}

Cinq secrets cryptographiques Strapi sont générés lors du premier déploiement
et stockés dans Secret Manager : `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`,
`TRANSFER_TOKEN_SALT` et `APP_KEYS` (quatre clés jointes par des virgules). Le mot de
passe de la base de données y est également stocké. Tous les secrets sont
injectés dans les pods au moment de l'exécution ; le texte en clair n'apparaît
jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### E. Cache Redis (optionnel) {#e-redis-cache-optional}

Lorsque `enable_redis = true`, Redis est utilisé comme magasin de sessions et cache de
réponses de l'API REST via les plugins `strapi-plugin-redis` et `strapi-plugin-rest-cache`. Lorsque
`redis_host` est laissé vide et que NFS est activé, l'adresse IP de l'hôte NFS
est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS|ENABLE_REDIS"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud
Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Strapi {#3-strapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation s'exécute en utilisant `postgres:15-alpine` et crée de manière
  idempotente la base de données et l'utilisateur Strapi, accorde les
  privilèges nécessaires (y compris `CREATEDB`, requis par le système de
  migration de Strapi), et signale au Cloud SQL Auth Proxy de s'arrêter
  proprement.
- **Fournisseur de médias GCS — incompatibilité connue du nom de bucket.**
  `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont automatiquement injectés dans le conteneur,
  et le `config/plugins.js` de Strapi détecte ces variables et bascule vers le
  fournisseur `@strapi-community/strapi-provider-upload-google-cloud-storage`. Cependant, `Strapi_GKE/strapi.tf` construit `GCS_BUCKET_NAME`
  comme `${resource_prefix}-strapi-uploads` en utilisant le `tenant_resource_prefix` réservé au locataire,
  tandis que le module Foundation (`App_GKE`) nomme en fait le bucket créé
  `gcs-${service_name}-strapi-uploads` (à portée d'application). Les deux noms ne correspondent pas,
  donc par défaut la valeur injectée pointe vers un bucket qui n'a jamais été
  créé et les téléchargements de médias échouent. (Le module frère `Strapi_CloudRun`
  n'a pas ce bug — il résout le nom du bucket via `module.app_cloudrun.storage_buckets["strapi-uploads"]`.) Jusqu'à ce
  que cela soit corrigé, définissez `GCS_BUCKET_NAME`/`GCS_BASE_URL`
  explicitement dans `environment_variables` en utilisant le nom réel du bucket de la
  sortie `storage_buckets` de ce module.
- **Envoi d'e-mails (optionnel).** Si `SMTP_HOST` est défini dans `environment_variables`,
  `config/plugins.js` active automatiquement le fournisseur d'e-mails `nodemailer`
  pour les notifications Strapi (invitations d'utilisateurs, réinitialisations
  de mot de passe, événements de workflow). Définissez `SMTP_PASSWORD` via
  `secret_environment_variables`.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `/_health` — un point de terminaison Strapi qui renvoie 200
  uniquement lorsque l'application et la connexion à la base de données sont
  prêtes. La sonde de démarrage permet jusqu'à environ 300 secondes pour
  l'initialisation au premier démarrage.
- **Affinité de session.** Par défaut à `ClientIP` — recommandé car le panneau
  d'administration de Strapi utilise des connexions WebSocket persistantes pour
  les mises à jour de contenu en temps réel.
- **Les secrets cryptographiques sont immuables après le premier déploiement.**
  Les cinq secrets auto-générés signent les sessions actives et les jetons API.
  La régénération de l'un d'entre eux invalide immédiatement toutes les sessions
  et tous les jetons actifs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Strapi sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `strapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Strapi CMS` | Nom convivial affiché dans la console. |
| `application_description` | `Strapi Headless CMS on GKE` | Annotation de description de la charge de travail. |
| `application_version` | `5.0.0` | Tag d'image ; incrémenter pour déclencher une nouvelle exécution de Cloud Build et une révision de la charge de travail. Ne sélectionne **pas** la version du package Strapi — `@strapi/strapi` est épinglé dans `Strapi_Common/scripts/package.json` (actuellement `4.24.2`) et cette variable n'a aucun effet sur celle-ci. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` déclenche Cloud Build ; `"prebuilt"` déploie une URI d'image existante. |
| `container_image` | `""` | Remplace l'URI de l'image ; laissez vide pour l'image construite par le module. |
| `container_build_config` | `{ enabled = true }` | Chemin du Dockerfile, contexte de build et arguments de build pour Cloud Build. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Nombre minimal de répliques de pods. |
| `max_instance_count` | `10` | Nombre maximal de répliques de pods (plafond de l'autoscaler). |
| `container_port` | `1337` | Le serveur Node.js de Strapi écoute sur le port 1337. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites CPU/mémoire et requêtes optionnelles. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour les opérations de traitement de médias longues. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectés automatiquement, mais voir l'incompatibilité connue du nom de bucket dans la section 3 — remplacez-les explicitement si les téléchargements échouent. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager pour les secrets supplémentaires. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation Pub/Sub. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour les connexions d'administration WebSocket de Strapi. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Nom du cluster cible ; auto-découvert s'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; auto-généré s'il est vide. |

### Groupe 7 — Configuration de StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les PVC par pod dans un StatefulSet. Non nécessaire pour la configuration par défaut basée sur NFS. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. Immuable après la création. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour les PVC. |
| `stateful_headless_service` | `null` | Crée un service headless pour un DNS de pod stable. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/_health`, délai de 10s | Sonde de démarrage ciblant le point de terminaison de santé de Strapi. |
| `health_check_config` | HTTP `/_health`, délai de 15s | Sonde de vivacité ciblant le point de terminaison de santé de Strapi. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Strapi. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Strapi (garder activé). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket `strapi-uploads` auto-provisionné. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utiliser Redis pour le cache/les sessions (désactivé par défaut). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour revenir à l'adresse IP de l'hôte NFS lorsque `enable_nfs = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | PostgreSQL est requis — ne pas changer pour MySQL ou `NONE`. |
| `application_database_name` | `strapi` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `strapi` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_postgres_extensions` | `false` | Installer des extensions PostgreSQL supplémentaires après le provisionnement. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Strapi. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
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
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Strapi. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnel) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEYS` / `JWT_SECRET` / `ADMIN_JWT_SECRET` / `API_TOKEN_SALT` (auto-généré) | généré une fois, jamais modifié | Critique | La rotation de l'un de ces éléments après le premier déploiement invalide immédiatement toutes les sessions actives et les jetons d'API ; chaque utilisateur est déconnecté et toutes les intégrations client sont rompues. |
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critique | Strapi nécessite PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléchargements de médias sont perdus au redémarrage du pod et ne sont pas partagés entre les réplicas. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP et Kubernetes, déclenchant une recréation complète et une perte de données. |
| `application_database_name` / `application_database_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommer fait que Strapi se connecte à une base de données vide, perdant tout le contenu et les utilisateurs. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_file` valide échoue le job d'importation. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_cloudsql_volume` | `true` | Élevé | Requis pour la connectivité PostgreSQL ; bloqué au moment de la planification lorsqu'il est désactivé avec un type de base de données non-`NONE`. |
| `memory_limit` | `512Mi` minimum | Élevé | Strapi est une application Node.js ; trop peu de mémoire provoque des arrêts OOM lors des opérations du panneau d'administration. Augmenter à `1Gi` ou plus pour la production. |
| `enable_redis` | `false` | Élevé | Activer uniquement lorsque les plugins l'exigent ; l'activation sans `redis_host` valide (et sans repli NFS) provoque une erreur de connexion au démarrage. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les connexions WebSocket du panneau d'administration Strapi se déconnectent et produisent des avertissements de "modifications non enregistrées". |
| `min_instance_count` | `1` | Élevé | GKE ne prend pas en charge la véritable mise à l'échelle à zéro sans KEDA ; le réglage à `0` peut laisser le HPA dans un état incohérent. |
| `enable_iap` | activer pour l'administration | Moyen | Le panneau d'administration Strapi est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `enable_topology_spread` | envisager pour la production | Faible | Avec plusieurs réplicas, la répartition topologique empêche tous les pods d'atterrir dans la même zone. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Strapi partagée avec la
variante Cloud Run est décrite dans **[Strapi_Common](Strapi_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Strapi sur GKE Autopilot](../labs/Strapi_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Strapi sur Google Cloud Run](Strapi_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Strapi Common — Configuration d'application partagée](Strapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
