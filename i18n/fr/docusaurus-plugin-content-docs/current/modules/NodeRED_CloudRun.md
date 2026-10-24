---
title: "Node-RED sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Node-RED sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/NodeRED_CloudRun.md @ 1665a43e sha256:b65c83d23c2e -->

# Node-RED sur Google Cloud Run {#node-red-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_CloudRun.png" alt="Node-RED sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED est un outil de programmation open source basé sur les flux, permettant
de connecter des appareils IoT, des API et des services en ligne via un éditeur
visuel basé sur un navigateur. Ce module déploie Node-RED sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Node-RED et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte NodeRED sur RAD, et comment cela se compare {#what-nodered-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de NodeRED sur RAD coûte environ 31 $ US par mois, avec les frais de module facturés une seule fois en crédits RAD.** Si vous avez besoin que NodeRED reste opérationnel en continu, qu'il s'adapte à plusieurs pods ou qu'il fonctionne avec d'autres charges de travail Kubernetes, consultez le [guide GKE](NodeRED_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **NodeRED**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **31 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour**, soit environ 270 par mois (environ 27 $ US au prix de la recharge, 22 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 31 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour NodeRED lui-même**, la comparaison honnête est donc un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et plus petite que les boîtiers de référence ci-dessous ferait également l'affaire ; les chiffres sont présentés pour une comparaison équivalente.
- Aucune offre SaaS gérée pour ce projet open source exact n'a pu être vérifiée avec un prix actuel et publié, donc aucun chiffre n'est donné ici. Node-RED est généralement exécuté avec d'autres infrastructures d'automatisation plutôt que d'être acheté comme un abonnement autonome, de sorte que l'alternative réaliste est un petit VPS autogéré.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui corrigez le système d'exploitation, faites pivoter les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Le Cloud SQL géré, Secret Manager et la surveillance de RAD s'en occupent pour vous, ce qui est le véritable argument en faveur de RAD par rapport à un boîtier moins cher — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si NodeRED fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet, et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à NodeRED dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 31 $ US.** Déployez NodeRED, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps pendant lequel NodeRED était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé NodeRED et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45 crédits (4,50 $ US) dans votre propre projet, ou 41 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que NodeRED resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 1,03 $ US par jour), ou environ 5 jours ou plus dans un projet géré par RAD (9 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de NodeRED alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit NodeRED dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute NodeRED pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Node-RED s'exécute comme un conteneur Node.js sur Cloud Run v2 (gen2) écoutant
sur le port 1880. Le déploiement connecte un ensemble ciblé de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, autoscaling basé sur les requêtes |
| Stockage de flux persistant | Filestore (NFS) | Flux, identifiants et nœuds installés dans `/data` (nécessite gen2) |
| Stockage d'objets | Cloud Storage | Un bucket de données d'application dédié |
| Stockage de contexte | Redis (optionnel) | Désactivé par défaut ; permet le partage de contexte entre les redémarrages et les instances |
| Secret d'identifiant | Secret Manager | `NODE_RED_CREDENTIAL_SECRET` auto-généré chiffre les identifiants de flux |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Aucune base de données n'est requise.** Node-RED stocke tout l'état dans
  son répertoire `/data` ; `database_type` par défaut est `"NONE"`.
- **NFS est activé par défaut.** Le répertoire `/data` est monté à partir
  d'un partage Filestore (nécessite `execution_environment = "gen2"`) afin que les flux, les
  identifiants et les nœuds installés survivent aux redémarrages de conteneurs
  et aux nouveaux déploiements.
- **La mise à l'échelle à zéro est prise en charge** (`min_instance_count = 0`). Définissez
  sur `1` pour les charges de travail de webhook de production afin
  d'éviter les retards de démarrage à froid et les webhooks manqués pendant la
  fenêtre de remontage NFS.
- **`max_instance_count = 1` par défaut.** Node-RED n'est pas conçu pour la mise à l'échelle
  horizontale active-active ; chaque instance a son propre contexte en mémoire.
  Augmentez uniquement lors de l'utilisation d'un stockage de contexte externe
  basé sur Redis.
- **`NODE_RED_CREDENTIAL_SECRET` est auto-généré.** Il chiffre tous les identifiants de flux
  stockés et est conservé dans Secret Manager. La rotation après le déploiement
  des flux rend les identifiants existants illisibles.
- **Les sondes de santé utilisent HTTP GET `/`**, qui renvoie l'interface
  utilisateur de l'éditeur une fois que Node-RED est prêt (un délai initial de
  30 secondes est suffisant).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Node-RED {#a-cloud-run--the-node-red-service}

Node-RED s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Filestore (NFS) — stockage de flux persistant {#b-filestore-nfs--persistent-flow-storage}

Node-RED stocke toutes les données persistantes — flux (`flows.json`),
identifiants chiffrés (`flows_cred.json`), nœuds de palette installés et fichier
de paramètres — dans son répertoire `/data`. Un partage NFS Filestore est
monté à `/data` (gen2 requis) afin que les données survivent aux
redémarrages de conteneurs et aux nouvelles révisions de service.

- **Console :** Filestore → Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Inspect the mounted volume from an active instance:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### C. Cloud Storage {#c-cloud-storage}

Un bucket GCS dédié est provisionné pour les données d'application Node-RED
(exportations de flux, archives de sauvegarde). Le compte de service se voit
accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options CMEK.

### D. Secret Manager — chiffrement des identifiants de flux {#d-secret-manager--flow-credential-encryption}

`NODE_RED_CREDENTIAL_SECRET` est généré automatiquement pendant le déploiement et stocké
comme un secret Secret Manager. Node-RED utilise cette clé pour chiffrer tous
les identifiants stockés dans les flux. Aucun autre secret spécifique à
l'application n'est généré par ce module.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Redis (stockage de contexte optionnel) {#e-redis-optional-context-storage}

Lorsque `enable_redis = true`, Node-RED est configuré pour stocker le contexte de flux
en externe dans Redis, permettant aux données de contexte de persister après
les redémarrages d'instance et d'être partagées entre plusieurs instances.
Redis est désactivé par défaut.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

Lorsque `enable_redis = true` et `redis_host` est vide mais `enable_nfs = true`, l'IP du
serveur NFS est utilisée comme hôte Redis ; sinon `redis_host` doit être
défini explicitement.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Node-RED {#3-node-red-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Node-RED stocke
  tout l'état dans `/data`. Aucune instance Cloud SQL n'est provisionnée
  et aucun job d'initialisation de schéma n'est requis. Le premier démarrage
  crée automatiquement les fichiers de flux par défaut si `/data` est vide.
- **Chiffrement des identifiants de flux.** `NODE_RED_CREDENTIAL_SECRET` est injecté à
  l'exécution depuis Secret Manager. Cette clé chiffre le fichier `flows_cred.json`
  sur le partage NFS. Changer ou faire pivoter la clé après le déploiement des
  flux rend tous les identifiants stockés (clés API, mots de passe, jetons)
  illisibles.
- **Mode sécurisé.** `NODE_RED_ENABLE_SAFE_MODE` est toujours défini sur `"false"`,
  garantissant l'exécution des flux au démarrage. Remplacez-le par `"true"`
  via `environment_variables` pour démarrer Node-RED avec les flux désactivés pour le
  débogage.
- **Mise à l'échelle à zéro et démarrages à froid.** Avec `min_instance_count = 0`,
  Node-RED se met à l'échelle à zéro lorsqu'il est inactif. Lors de la mise à
  l'échelle, le volume NFS doit se remonter avant que la vérification de santé
  ne passe (environ 10 à 20 secondes). Les webhooks déclenchés pendant cette
  fenêtre peuvent être perdus. Définissez `min_instance_count = 1` pour les charges de
  travail de webhook de production.
- **Sonde de santé.** Les sondes de démarrage et de vivacité envoient toutes
  deux un HTTP GET à `/`, qui renvoie l'interface utilisateur de
  l'éditeur une fois que Node-RED est prêt. Un délai initial de 30 secondes
  est suffisant.
- **Tâches planifiées.** Node-RED n'a pas de commandes planifiées
  intégrées. Utilisez `cron_jobs` pour provisionner des jobs Cloud Run
  déclenchés par Cloud Scheduler pour les tâches de maintenance périodiques
  telles que les exportations de flux ou les vidages de cache :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Accéder à l'éditeur.** Naviguez vers la sortie `service_url` et
  connectez-vous. Pour les déploiements de production, activez IAP
  (`enable_iap = true`) pour contrôler l'accès avec l'authentification Google
  Identity — l'éditeur expose l'édition complète des flux et la gestion des
  identifiants.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Node-RED sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nodered` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Node-RED` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag d'image pour `nodered/node-red`. Épinglez à une version spécifique (par exemple `4.0.9`) pour des déploiements reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU est suffisant pour la plupart des déploiements. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmentez à `2Gi` pour les flux qui traitent de grandes charges utiles. |
| `min_instance_count` | `0` | Instances minimales. `0` active la mise à l'échelle à zéro ; définissez sur `1` pour les charges de travail de webhook de production. |
| `max_instance_count` | `1` | Instances maximales. Conservez à `1` sauf si les flux sont sans état ou basés sur Redis. |
| `execution_environment` | `gen2` | **Doit être `gen2` pour que les montages de volume NFS fonctionnent.** |
| `timeout_seconds` | `300` | Durée maximale de la requête avant qu'un 504 ne soit renvoyé. |
| `cpu_always_allocated` | `false` | Lorsque `false`, le CPU est limité au ralenti. Définissez `true` uniquement si les tâches en arrière-plan nécessitent un CPU continu. |
| `enable_image_mirroring` | `true` | Mettez en miroir depuis Docker Hub vers Artifact Registry pour éviter les limites de débit. |
| `traffic_split` | `[]` | Alloue le trafic entre les révisions pour les déploiements canary/blue-green. |
| `max_revisions_to_retain` | `7` | Révisions Cloud Run à conserver après chaque déploiement. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Utilisez `"internal-and-cloud-load-balancing"` avec Cloud Armor pour les webhooks de production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routage sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. Fortement recommandé pour la production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NODE_RED_CREDENTIAL_SECRET` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde NFS automatisé (UTC). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_*` | désactivé | Non applicable à Node-RED ; conservé pour la compatibilité API. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. `application_domains` est optionnel — un certificat `nip.io` est dérivé lorsqu'il n'est pas défini. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés avec SSL géré par Google. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le répertoire `/data` de Node-RED. Fortement recommandé. Nécessite gen2. |
| `nfs_mount_path` | `/data` | Doit correspondre au répertoire de données natif de Node-RED. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Secret d'identifiant {#group-12--credential-secret}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du `NODE_RED_CREDENTIAL_SECRET` auto-généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du secret d'identifiant. La rotation de la clé rend les identifiants de flux existants illisibles. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED ne nécessite pas de jobs d'initialisation. Fournissez des jobs personnalisés pour les importations de flux ou les installations de palettes. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 30s | Sonde HTTP vers le chemin de l'éditeur Node-RED. |
| `liveness_probe` | HTTP `/`, délai de 30s | Sonde de vivacité — redémarre le conteneur si l'éditeur ne répond pas. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Stockage de contexte Redis {#group-21--redis-context-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage de contexte Node-RED. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` (sauf si `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service Node-RED. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Sans NFS, tous les flux, identifiants et nœuds installés sont perdus à chaque redémarrage d'instance ou nouveau déploiement. |
| `NODE_RED_CREDENTIAL_SECRET` (de `database_password_length`) | auto-généré | Critique | Chiffre tous les identifiants de flux. La rotation ou la modification de la clé après le déploiement des flux rend les identifiants existants illisibles de manière permanente. |
| `enable_auto_password_rotation` | `false` | Critique | La rotation automatique modifie la clé de chiffrement ; tous les identifiants de flux stockés deviennent inaccessibles. N'activez qu'avec une procédure de rechiffrement en place. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée toutes les ressources GCP et déconnecte le partage NFS. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job de restauration. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2 ; l'utilisation de gen1 entraîne des échecs de montage et des erreurs de démarrage de conteneur. |
| `max_instance_count` | `1` | Élevé | Node-RED n'est pas conçu pour la mise à l'échelle active-active. Plusieurs instances sans contexte partagé entraînent un état conflictuel. |
| `min_instance_count` | `1` pour les webhooks | Élevé | La mise à l'échelle à zéro provoque des démarrages à froid de 10 à 20 secondes ; les webhooks déclenchés pendant le remontage NFS sont perdus. |
| `nfs_mount_path` | `/data` | Élevé | Doit correspondre au répertoire de données natif de Node-RED. Le modifier achemine les écritures vers un stockage éphémère. |
| `database_type` | `NONE` | Élevé | La définition sur `MYSQL` ou `POSTGRES` provisionne un sidecar Cloud SQL inutile. |
| `enable_redis` sans `redis_host` | définir `redis_host` explicitement | Élevé | Sans repli NFS, un hôte Redis vide entraîne des échecs de stockage de contexte. |
| `enable_iap` | `true` pour la production | Élevé | L'éditeur expose l'édition complète des flux et la gestion des identifiants et ne doit pas être accessible publiquement. |
| `ingress_settings` | `internal-and-cloud-load-balancing` pour la production | Moyen | `"internal"` bloque tous les webhooks externes ; `"all"` expose le service directement sans WAF. |
| `memory_limit` | `1Gi` | Moyen | Les flux traitant de grandes charges utiles ou utilisant des nœuds de traitement d'images peuvent nécessiter `2Gi`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — identité de service, mise
à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Node-RED partagée avec la variante GKE est décrite
dans **[NodeRED_Common](NodeRED_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : NodeRED sur Cloud Run](../labs/NodeRED_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Node-RED sur GKE Autopilot](NodeRED_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [NodeRED Common — Configuration d'application partagée](NodeRED_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [n8n sur Google Cloud Run](N8N_CloudRun.md), [Activepieces sur Google Cloud Run](Activepieces_CloudRun.md), [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md), [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) dans la solution **Workflow Automation Hub**.
