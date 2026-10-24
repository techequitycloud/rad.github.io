---
title: "EvolutionAPI sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'EvolutionAPI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/EvolutionAPI_GKE.md @ 1665a43e sha256:d3e494e51ba0 -->

# EvolutionAPI sur GKE Autopilot {#evolutionapi-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EvolutionAPI_GKE.png" alt="EvolutionAPI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Evolution API est une passerelle API WhatsApp Business open-source en Node.js (construite sur la
bibliothèque Baileys) qui provisionne des instances WhatsApp, envoie et reçoit des messages, et
expose une API REST ainsi qu'une interface utilisateur de gestion pour connecter WhatsApp à d'autres systèmes. Ce
module déploie Evolution API sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Evolution API utilise et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toute application GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes, et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Evolution API sur RAD, et comment cela se compare {#what-evolution-api-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot d'Evolution API sur RAD coûte environ 150 US$ par mois, plus 30 US$ une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](EvolutionAPI_CloudRun.md) exécute la même Evolution API pour environ 181 US$ par mois. Evolution API est une passerelle API WhatsApp Business open-source utilisée pour envoyer et recevoir des messages et gérer plusieurs instances par programmation. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 150 US$. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 US$ au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, environ 3 330 par mois (environ 333 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 Gio, fonctionnant en permanence | 79 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Serveur de fichiers NFS/cache : une petite VM | 13 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les modules complémentaires et les sauvegardes | 1 US$ |
| **Total** | **environ 150 US$** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, de sorte que le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 US$ par mois.

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Evolution API au 8 octobre 2026, donc la comparaison honnête est avec le fait de l'exécuter vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **150 US$**, plus 30 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, Cloud Run | environ 181 US$ ; voir le [guide Cloud Run](EvolutionAPI_CloudRun.md) | RAD |

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Evolution API est une passerelle API WhatsApp Business open-source utilisée pour envoyer et recevoir des messages et gérer plusieurs instances par programmation.** Cela détermine quelle colonne est importante : une opération prévisible et sans intervention est plus précieuse pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Evolution API s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 150 US$.** Déployez Evolution API, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et les heures où il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, de sorte qu'Evolution API ne se met jamais à l'échelle zéro par elle-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305 crédits (30,50 US$). La suppression permet d'économiser de l'argent si Evolution API resterait autrement inutilisée pendant environ 7 jours ou plus dans votre propre projet (environ 5 US$ par jour), ou environ 3 jours ou plus dans un projet géré par RAD (111 crédits par jour).
- **Supprimez tout ce qu'Evolution API utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous devez saisir à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit Evolution API dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Evolution API s'exécute comme une charge de travail web Node.js sur GKE Autopilot. Le déploiement connecte
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 2 vCPU / 4 Gio par défaut ; **épinglé à un seul réplica** |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Evolution API utilise Prisma uniquement avec PostgreSQL |
| Cache | Redis | **Activé par défaut** (`CACHE_REDIS_URI`) ; met en cache l'état de l'instance/message |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Secrets | Secret Manager | `AUTHENTICATION_API_KEY` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec affinité de session `ClientIP` ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; Evolution API utilise Prisma et ne prend pas en charge d'autres moteurs.
- **La charge de travail est épinglée à un seul réplica** (`min_instance_count = 1`,
  `max_instance_count = 1`). Evolution API maintient des sessions de socket WhatsApp (Baileys) actives
  en mémoire, par pod ; ces sessions ne sont **pas** partagées entre les réplicas, donc
  la mise à l'échelle fragmente les connexions actives. N'augmentez pas `max_instance_count`.
- **`AUTHENTICATION_API_KEY` est généré automatiquement** et stocké dans Secret
  Manager. C'est la clé d'administration globale d'Evolution API et elle ne doit **jamais être renouvelée après
  le premier démarrage** — la renouveler rend les instances WhatsApp déjà provisionnées inaccessibles
  et renvoie `401` à chaque client détenant encore l'ancienne clé.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide pour
  utiliser l'IP de la VM du serveur NFS comme point d'accès Redis (nécessite `enable_nfs = true`), ou
  pointez-le vers une instance gérée explicite.
- **L'affinité de session est `ClientIP`** et le type de service est `LoadBalancer` par défaut,
  exposant une IP externe pour les rappels de webhook WhatsApp et l'interface utilisateur du gestionnaire.
- **La mémoire par défaut est de 4 Gio** — Evolution API a besoin d'au moins 2 Gio pour un
  fonctionnement fiable.
- **`SERVER_URL` est défini par défaut au moment de l'exécution** par le point d'entrée du conteneur à partir de l'URL de service injectée, de sorte que les URL de rappel de code QR et de webhook reflètent la véritable adresse.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION`, et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Evolution API {#a-gke-autopilot--the-evolution-api-workload}

Les pods Evolution API sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. La charge de travail s'exécute en un seul réplica par conception.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Evolution API pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Evolution API stocke toutes les données d'application (instances WhatsApp, contacts, chats,
historique des messages) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods y accèdent
privément via le sidecar **Cloud SQL Auth Proxy** sur une boucle de retour TCP
(`127.0.0.1`) ; aucune IP publique n'est exposée. Lors du premier déploiement, un Job d'initialisation crée
la base de données et l'utilisateur de l'application ; les migrations Prisma créent ensuite le schéma au
démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=evolution --database=evolution --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`evolution`), l'utilisateur (`evolution`) et le secret Secret Manager
contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour le stockage de fichiers
Evolution API. Le compte de service de la charge de travail se voit accorder l'accès. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache) {#d-redis-cache}

Redis est **activé par défaut** (`enable_redis = true`). Evolution API l'utilise pour
la mise en cache des instances/messages (`CACHE_REDIS_URI`, index de base de données Redis `6`). Lorsque `redis_host` est
laissé vide et `enable_nfs = true`, l'IP de la VM du serveur NFS est utilisée comme point d'accès Redis ;
le point d'entrée du conteneur assemble l'URI au moment de l'exécution.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the cache URI is injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CACHE_REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`AUTHENTICATION_API_KEY` — la clé API d'administration globale d'Evolution API, montée via le
pilote CSI Secret Store. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing avec
affinité de session `ClientIP` — requise pour que les requêtes d'un client WhatsApp restent sur le
seul pod détenant son socket. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Le point d'entrée émet des marqueurs `[cloud-entrypoint]` qui confirment la
configuration résolue de la base de données/Redis/URL au démarrage. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont
disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application EvolutionAPI {#3-evolutionapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  la base de données et le rôle `evolution`, accorde les privilèges et fait de l'utilisateur de l'application
  le propriétaire du schéma `public`, puis signale au sidecar proxy de s'arrêter afin que le
  pod du Job se termine. Le Job peut être réexécuté en toute sécurité.
- **Migrations Prisma au démarrage.** Evolution API exécute `prisma migrate deploy` à chaque
  démarrage de conteneur (via le `deploy_database.sh` encapsulé), de sorte que la mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte. Sur GKE, le
  sidecar cloud-sql-proxy est une boucle de retour TCP, de sorte que le point d'entrée se connecte avec
  `sslmode=disable`.
- **`AUTHENTICATION_API_KEY` est immuable après le premier démarrage.** La clé d'administration globale est
  générée une seule fois et écrite dans Secret Manager. La faire pivoter rend toutes les
  instances WhatsApp déjà provisionnées inaccessibles et renvoie `401` à chaque client
  détenant encore l'ancienne clé. Ne la faites pivoter que lors d'une migration planifiée.
- **Réplica unique par conception.** Les sessions de socket WhatsApp (Baileys) résident dans la mémoire du pod
  et ne sont pas partagées entre les réplicas. `min_instance_count = 1` en maintient une
  en cours d'exécution ; `max_instance_count = 1` empêche la fragmentation des connexions actives. Ne
  pas mettre à l'échelle. L'affinité de session `ClientIP` maintient chaque client épinglé au pod.
- **URL de rappel Webhook / QR.** Le point d'entrée définit par défaut `SERVER_URL` sur l'URL de service injectée.
  Une fois l'IP externe du LoadBalancer attribuée, définissez `SERVER_URL` (via
  `environment_variables`) sur l'URL externe afin que les rappels de code QR et de webhook utilisent une
  adresse accessible :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
- **Configuration initiale.** Après le déploiement, récupérez `AUTHENTICATION_API_KEY` de Secret
  Manager et utilisez-le (comme en-tête `apikey`) pour accéder à l'interface utilisateur du gestionnaire à l'adresse `/manager`,
  créez une instance WhatsApp (`POST /instance/create`), puis scannez le code QR renvoyé
  depuis WhatsApp sur votre téléphone pour connecter le numéro.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/` — un point d'accès de statut non authentifié
  qui répond une fois le serveur démarré. Prévoyez plusieurs minutes au premier
  démarrage pendant l'exécution des migrations Prisma.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Evolution API sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `evolutionapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `v2.1.1` | Tag d'image Evolution API ; `latest` correspond à un `v2.1.1` épinglé dans l'argument de build. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas de pod minimum ; maintient un réplica en cours d'exécution pour les sockets WhatsApp en mémoire. |
| `max_instance_count` | `1` | **Épinglé à 1.** Ne pas augmenter — les sessions ne sont pas partagées entre les pods. |
| `container_port` | `8080` | Evolution API écoute sur le port 8080 (`SERVER_PORT`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité PostgreSQL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une IP externe pour les rappels de webhook et l'interface utilisateur du gestionnaire. |
| `workload_type` | `null` (résolution automatique vers `Deployment`) | Déploiement sans état (tout l'état réside dans PostgreSQL + Redis). |
| `session_affinity` | `ClientIP` | Routage persistant pour que les requêtes d'un client atteignent le pod détenant son socket WhatsApp. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne la VM du serveur NFS, qui co-localise également le point d'accès Redis (voir Groupe 15). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active le cache Redis d'Evolution API (`CACHE_REDIS_URI`). |
| `redis_host` | `""` | Point d'accès Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `evolution` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `evolution` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Evolution API. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnels). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un conflit `StatefulSet`, IAP sans identités autorisées, unités `quota_memory_*` non binaires, un `redis_port`/`backup_retention_days` hors de portée, `enable_cloudsql_volume = false` sur une application basée sur une base de données. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTICATION_API_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend chaque instance WhatsApp déjà provisionnée inaccessible et renvoie `401` à tous les clients détenant l'ancienne clé. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tout l'historique des messages. |
| `max_instance_count` | `1` | Critique | La mise à l'échelle fragmente les sessions de socket WhatsApp en mémoire entre les pods, rompant les connexions actives et dupliquant les livraisons de webhook. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; le désactiver rompt la connexion à la base de données. |
| `enable_redis` | `true` | Élevé | La désactivation supprime le cache d'instance/message d'Evolution API ; l'application est configurée pour l'attendre (`CACHE_REDIS_ENABLED = true`). |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais NFS est désactivé et qu'aucun hôte n'est défini, l'URI du cache est vide et la mise en cache est silencieusement désactivée. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes peuvent être acheminées loin du pod unique détenant le socket WhatsApp, rompant les opérations d'instance. |
| `service_type` | `LoadBalancer` | Élevé | `ClusterIP` rend l'interface utilisateur du gestionnaire et les points d'accès webhook inaccessibles depuis l'extérieur du cluster. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. Garder 1 préserve les sockets WhatsApp chauds. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhook externes. |
| `application_version` | Épingler (par exemple `v2.1.1`) | Moyen | `latest` correspond à un tag épinglé, mais l'épinglage explicite évite les mises à niveau surprises qui exécutent de nouvelles migrations Prisma. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Evolution-API partagée
avec la variante Cloud Run est décrite dans
**[EvolutionAPI_Common](EvolutionAPI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Evolution API sur GKE Autopilot](../labs/EvolutionAPI_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [EvolutionAPI Common — Configuration d'application partagée](EvolutionAPI_Common.md) — la configuration partagée par les deux cibles de déploiement.
