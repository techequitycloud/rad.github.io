---
title: "EvolutionAPI sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'EvolutionAPI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/EvolutionAPI_CloudRun.md @ e69407af sha256:09269f629b48 -->

# EvolutionAPI sur Google Cloud Run {#evolutionapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EvolutionAPI_CloudRun.png" alt="EvolutionAPI sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Evolution API est une passerelle API WhatsApp Business open source basée sur Node.js (construite sur la
bibliothèque Baileys) qui provisionne des instances WhatsApp, envoie et reçoit des messages, et
expose une API REST ainsi qu'une interface utilisateur de gestion pour intégrer WhatsApp à d'autres systèmes. Ce
module déploie Evolution API sur **Cloud Run v2** sur la base de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Evolution API et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Evolution API sur RAD, et comment cela se compare {#what-evolution-api-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, Evolution API sur le module Cloud Run de RAD coûte environ 181 US$ par mois, plus 30 US$ une fois par déploiement et aucune licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail qui doivent rester actives en continu ou s'exécuter à côté d'autres applications Kubernetes ; voir le [guide GKE](EvolutionAPI_GKE.md), environ 150 US$ par mois. Evolution API est une passerelle API WhatsApp Business open source utilisée pour envoyer et recevoir des messages et gérer plusieurs instances par programmation. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 181 US$. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 US$ au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **181 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **83 crédits par jour**, environ 2 490 par mois (environ 249 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, donc une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2 vCPU / 4 Gio, toujours actif | 110 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Serveur de fichiers NFS/cache : une petite VM | 13 US$ |
| Passerelle Cloud NAT et adresse IP | 5 US$ |
| Cloud Storage pour les add-ons et les sauvegardes | 1 US$ |
| **Total** | **environ 181 US$** |

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Evolution API au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, Cloud Run, votre propre projet** | **181 US$**, plus 30 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, GKE Autopilot | environ 150 US$ ; voir le [guide GKE Autopilot](EvolutionAPI_GKE.md) | RAD |

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Evolution API est une passerelle API WhatsApp Business open source utilisée pour envoyer et recevoir des messages et gérer plusieurs instances par programmation.** Cela détermine quelle colonne est importante : une opération prévisible et sans intervention est plus précieuse pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Evolution API s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 181 US$.** Déployez Evolution API, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et les heures où il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Ce module exécute Cloud Run en continu (`alwaysOn`) plutôt que de le mettre à l'échelle à zéro, de sorte que son coût de calcul ne s'arrête pas de lui-même entre les sessions. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305 crédits (30,50 US$). La suppression permet d'économiser de l'argent si Evolution API resterait inutilisée pendant environ 6 jours ou plus dans votre propre projet (environ 6,03 US$ par jour), ou environ 4 jours ou plus dans un projet géré par RAD (83 crédits par jour).
- **Supprimez tout ce qu'Evolution API utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez les paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Evolution API dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation quotidienne des crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Evolution API s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 Gio par défaut ; **épinglé à une seule instance toujours chaude** |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Evolution API utilise Prisma uniquement avec PostgreSQL |
| Cache | Redis | **Activé par défaut** (`CACHE_REDIS_URI`) ; met en cache l'état de l'instance/du message |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Secrets | Secret Manager | Auto-généré `AUTHENTICATION_API_KEY` ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` (publique) ; LB HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; Evolution API utilise Prisma et ne prend pas en charge d'autres moteurs.
- **Le service est épinglé à une seule instance** (`min_instance_count = 1`,
  `max_instance_count = 1`). Evolution API maintient des sessions de socket WhatsApp (Baileys)
  en mémoire, par instance ; ces sessions ne sont **pas** partagées entre les
  réplicas, donc la mise à l'échelle fragmente les connexions actives et une instance doit rester
  chaude. N'augmentez pas `max_instance_count`.
- **`AUTHENTICATION_API_KEY` est généré automatiquement** et stocké dans Secret
  Manager. C'est la clé d'administration globale d'Evolution API et elle ne doit **jamais être
  renouvelée après le premier démarrage** — la renouveler rend les instances WhatsApp déjà
  provisionnées inaccessibles et renvoie `401` à chaque client détenant
  toujours l'ancienne clé.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide pour
  utiliser l'IP de la VM du serveur NFS comme point de terminaison Redis (nécessite `enable_nfs = true`), ou
  pointez-le vers une instance gérée explicite.
- **L'ingress public est la valeur par défaut** (`ingress_settings = "all"`) afin que les systèmes externes
  puissent atteindre les points de terminaison de webhook et l'interface utilisateur de gestion. L'activation d'IAP bloque ces
  appels externes.
- **La mémoire est par défaut de 4 Gio** — Evolution API a besoin d'au moins 2 Gio pour un
  fonctionnement fiable.
- **`SERVER_URL` est défini par défaut sur l'URL réelle du service** au moment de l'exécution par le point d'entrée du conteneur, de sorte que les URL de code QR et de rappel de webhook reflètent l'adresse réelle de Cloud Run.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Evolution API {#a-cloud-run--the-evolution-api-service}

Evolution API s'exécute en tant que service Cloud Run v2 épinglé à une seule instance. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour
des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~evolutionapi"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Evolution API stocke toutes les données d'application (instances WhatsApp, contacts, chats,
historique des messages) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service
se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique
n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application ; les migrations Prisma créent ensuite le schéma au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=evolution --database=evolution --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour le stockage de fichiers d'Evolution
API. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache) {#d-redis-cache}

Redis est **activé par défaut** (`enable_redis = true`). Evolution API l'utilise pour
la mise en cache des instances/messages (`CACHE_REDIS_URI`, index de base de données Redis `6`). Lorsque `redis_host` est
laissé vide et `enable_nfs = true`, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis ;
le point d'entrée du conteneur assemble l'URI au moment de l'exécution.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the cache URI is set in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`AUTHENTICATION_API_KEY` — la clé API d'administration globale d'Evolution API, injectée comme variable d'environnement secrète. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet l'accès public requis pour les rappels de webhook WhatsApp et l'interface utilisateur de gestion. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des stratégies d'alerte facultatives. Le point d'entrée émet des marqueurs `[cloud-entrypoint]` qui confirment la configuration résolue de la base de données/Redis/URL au démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application EvolutionAPI {#3-evolutionapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  la base de données et le rôle `evolution`, accorde les privilèges et fait de l'utilisateur de l'application
  le propriétaire du schéma `public`. Le job peut être réexécuté en toute sécurité.
- **Migrations Prisma au démarrage.** Evolution API exécute `prisma migrate deploy` à chaque
  démarrage de conteneur (via le `deploy_database.sh` encapsulé), de sorte que la mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte. Le point d'entrée
  attend le socket Cloud SQL avant que cela ne s'exécute et exécute le script de migration en tant que
  sous-processus afin qu'une défaillance transitoire ne puisse pas empêcher le serveur de démarrer.
- **`AUTHENTICATION_API_KEY` est immuable après le premier démarrage.** La clé d'administration globale est
  générée une fois et écrite dans Secret Manager. La faire pivoter rend toutes les
  instances WhatsApp déjà provisionnées inaccessibles et renvoie `401` à chaque client
  détenant toujours l'ancienne clé. Ne la faites pivoter que lors d'une migration planifiée.
- **Instance unique par conception.** Les sessions de socket WhatsApp (Baileys) résident dans la
  mémoire de l'instance et ne sont pas partagées entre les réplicas. `min_instance_count = 1` en maintient
  une chaude ; `max_instance_count = 1` empêche la fragmentation des connexions actives. Ne
  mettez pas à l'échelle.
- **URL de rappel de webhook / QR.** Le point d'entrée définit par défaut `SERVER_URL` sur le `CLOUDRUN_SERVICE_URL` injecté,
  de sorte que les URL de code QR et de rappel de webhook utilisent l'adresse réelle du service.
  Vérifiez l'URL du service en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Configuration initiale.** Après le déploiement, récupérez `AUTHENTICATION_API_KEY` de Secret
  Manager et utilisez-le (comme en-tête `apikey`) pour accéder à l'interface utilisateur de gestion à `/manager`,
  créez une instance WhatsApp (`POST /instance/create`), puis scannez le code QR renvoyé
  depuis WhatsApp sur votre téléphone pour connecter le numéro.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/` — un point de terminaison de statut non authentifié qui répond une fois le serveur démarré. Prévoyez environ 7 minutes au premier démarrage (la sonde de démarrage donne un délai initial de 60 secondes plus une fenêtre de 30 tentatives pendant que Prisma migre).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Evolution API sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `evolutionapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Evolution API` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `v2.1.1` | Tag d'image Evolution API. `latest` correspond à un `v2.1.1` épinglé dans l'argument de build. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; **minimum 2 Gio** pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Maintient une instance chaude — les sockets WhatsApp sont conservés en mémoire. |
| `max_instance_count` | `1` | **Épinglé à 1.** Ne pas augmenter — les sessions ne sont pas partagées entre les réplicas. |
| `container_port` | `8080` | Evolution API écoute sur le port 8080 (`SERVER_PORT`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image `evoapicloud/evolution-api` dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les rappels de webhook publics et l'interface utilisateur de gestion. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les rappels de webhook WhatsApp externes.** |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `SERVER_*`, `DATABASE_*`, `CACHE_REDIS_*` et `AUTHENTICATION_*` sont définies automatiquement — ne définissez pas `AUTHENTICATION_API_KEY` ou `DATABASE_CONNECTION_URI` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne une instance Filestore NFS ; co-localise également le point de terminaison Redis sur la VM du serveur NFS lorsque `redis_host` est laissé vide (voir Groupe 21). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `evolution` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `evolution` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai, 30 tentatives | Démarrage lent (migrations Prisma) ; prévoir ~7 minutes. |
| `liveness_probe` | HTTP `/` 60s de délai | Sonde de vivacité sur le point de terminaison de statut racine. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active le cache Redis d'Evolution API (`CACHE_REDIS_URI`). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `redis_port`/`backup_retention_days` hors limites, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, une mémoire inférieure au seuil gen2. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTICATION_API_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend chaque instance WhatsApp déjà provisionnée inaccessible et renvoie `401` à tous les clients détenant l'ancienne clé. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tout l'historique des messages. |
| `max_instance_count` | `1` | Critique | La mise à l'échelle fragmente les sessions de socket WhatsApp en mémoire entre les instances, rompant les connexions actives et dupliquant les livraisons de webhook. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` | `true` | Élevé | La désactivation supprime le cache d'instance/message d'Evolution API ; l'application est configurée pour l'attendre (`CACHE_REDIS_ENABLED = true`). |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, l'URI du cache est vide et la mise en cache est silencieusement désactivée. |
| `memory_limit` | `4Gi` (min `2Gi`) | Élevé | En dessous de 2 Gio, Evolution API est sujette aux arrêts OOM sous charge de messages. |
| `ingress_settings` | `all` | Élevé | Le réglage à `internal` bloque tous les rappels de webhook WhatsApp externes. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhook externes. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro supprime les sessions de socket WhatsApp chaudes ; un démarrage à froid doit rétablir chaque connexion. |
| `application_version` | Épingler (par exemple `v2.1.1`) | Moyen | `latest` correspond à un tag épinglé, mais l'épinglage explicite évite les mises à niveau surprises qui exécutent de nouvelles migrations Prisma. |
| `startup_probe` timing | Par défaut (60s + 30 tentatives) | Moyen | Une fenêtre trop courte fait échouer la sonde avant la fin des migrations Prisma au premier démarrage. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Evolution-API
partagée avec la variante GKE est décrite dans
**[EvolutionAPI_Common](EvolutionAPI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Evolution API sur Cloud Run](../labs/EvolutionAPI_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EvolutionAPI sur GKE Autopilot](EvolutionAPI_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [EvolutionAPI Common — Configuration d'application partagée](EvolutionAPI_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md) dans la solution **Conversational Outreach**.
