---
title: "LobeChat sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LobeChat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LobeChat_GKE.md @ e69407af sha256:3176a8df656e -->

# LobeChat sur GKE Autopilot {#lobechat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LobeChat_GKE.png" alt="LobeChat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LobeChat est une interface de chat LLM moderne et open-source (construite avec Next.js) qui permet aux utilisateurs de converser avec de nombreux fournisseurs de modèles — OpenAI, Anthropic, Google et d'autres — via une interface polie unique, les utilisateurs fournissant leurs propres clés API côté client. Ce module déploie LobeChat sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par LobeChat et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de LobeChat sur RAD et comparaison {#what-lobechat-costs-on-rad-and-how-that-compares}

**LobeChat sur le module GKE Autopilot de RAD coûte environ 26 $ US par mois dans votre propre projet.** RAD facture 40 crédits une fois par déploiement dans votre propre projet (36 crédits, 10 % de moins, dans un projet géré par RAD), plus le temps de build. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de cela — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **26 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **55 crédits par jour**, soit environ 1 650 par mois (environ 165,00 $ US au prix de la recharge, moins sur un forfait) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins sur un forfait mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 1 GiB | 20 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ US si c'est votre seul cluster, sinon ~73 $ US |
| **Total** | **environ 26 $ US** |

### Comparaison {#how-it-compares}

- LobeChat est une **interface** de chat, pas un service hébergé avec son propre abonnement — il est sans état par défaut (pas de base de données, de Redis ou de stockage persistant), et les utilisateurs fournissent leurs propres clés API de fournisseur. Il n'y a pas d'équivalent SaaS à comparer avec un prix courant vérifiable : le coût qui compte ici est l'utilisation du modèle elle-même, qui est facturée par la clé du fournisseur que chaque utilisateur fournit, et non par RAD ou par LobeChat.
- Comparaison auto-gérée : à 0,5 vCPU / 1 GiB, l'empreinte de LobeChat est plus petite que n'importe quelle des classes de VPS de référence habituelles (un Hetzner CPX22 ou un droplet DigitalOcean de 4 Go, tous deux ~24 $ US/mois, sont dimensionnés pour une charge de travail plus lourde), donc une instance moins chère et plus petite que celles-ci ferait l'affaire — les 26 $ US par mois de RAD incluent la facturation par pod de GKE Autopilot, la gestion du réseau et du stockage plutôt qu'une simple VM que vous patchez vous-même.
- La vraie décision est généralement "héberger l'interface utilisateur soi-même ou utiliser le produit de chat hébergé d'un fournisseur (par exemple les applications web ChatGPT ou Gemini)" plutôt que "héberger soi-même ou payer pour un LobeChat hébergé" — personne ne vend LobeChat hébergé comme un produit payant aujourd'hui.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LobeChat s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à LobeChat dont vous n'avez besoin qu'occasionnellement — évaluation, environnement de démonstration, charge de travail saisonnière ou intermittente — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus les frais de module. Pour LobeChat derrière Services_GCP (un cluster GKE) et Project_GCP, cela représente environ **une poignée de crédits (moins de 1 $ US)** au total, contre environ 45 crédits (4,50 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 26 $ US.** Déployez LobeChat, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et le temps pendant lequel il a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'évaluation conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont écrits dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé LobeChat et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds — environ 45 crédits (4,50 $ US) au total. La suppression permet d'économiser de l'argent seulement si LobeChat resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ **6 jours ou plus**, à la fois dans votre propre projet (environ 0,86 $ US par jour) et dans un projet géré par RAD (55 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement partagée.** Pour LobeChat, c'est la base de données. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données d'abord.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LobeChat s'exécute comme une seule charge de travail web Next.js sans état sur Autopilot. Parce que son mode **stocké côté client** par défaut conserve tout l'état dans le navigateur, le déploiement relie un ensemble délibérément minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 500m vCPU / 1 GiB par défaut, autoscalés horizontalement |
| Base de données | *(aucune)* | `database_type = "NONE"` — aucune instance Cloud SQL n'est provisionnée ; l'état réside dans le navigateur |
| Stockage d'objets | *(aucun)* | Sans état — aucun bucket GCS, montage NFS ou PVC déclaré par défaut |
| Cache | Redis (optionnel, désactivé) | Uniquement pour la limitation de débit / détection de bots sur les déploiements publics |
| Secrets | Secret Manager (aucun par défaut) | LobeChat ne génère pas de secrets ; injectez vous-même les clés de fournisseur si vous le souhaitez |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de secrets, pas de stockage.** LobeChat est sans état en mode client-stocké — les utilisateurs ajoutent leurs propres clés API de modèle dans le navigateur. Il n'y a rien à sauvegarder et rien à migrer. (Un mode serveur Postgres optionnel existe en amont mais n'est pas câblé par ce module.)
- **Le port 3210 est fixe.** L'image personnalisée épingle `PORT=3210` et `container_port =
  3210` ; ne le changez pas sans reconstruire l'image.
- **Par défaut `500m` CPU / `1Gi` mémoire** (`container_resources`). Le processus SSR Next.js de LobeChat (plus ses dépendances de rendu `pdfjs-dist`/`@napi-rs/canvas`) OOM et `CrashLoopBackOff` à 512Mi (`JavaScript heap out of memory`) — 1Gi est le minimum pour un démarrage stable ; augmentez `container_resources.memory_limit` davantage sous une charge plus lourde.
- **Minimum 1 réplica** (`min_instance_count = 1`, forcé par le câblage). GKE ne prend pas en charge la mise à l'échelle à zéro, donc au moins un pod est toujours en cours d'exécution pour maintenir l'interface utilisateur accessible ; `max_instance_count = 3`.
- **Sans état — Déploiement, pas StatefulSet.** Il n'y a pas de volume persistant ; les pods peuvent être remplacés librement et mis à l'échelle horizontalement sans file d'attente ni prérequis de cache.
- **`service_type = LoadBalancer`, `session_affinity = None`.** Sans état de session côté serveur, les requêtes n'ont pas besoin de routage persistant.
- **Redis est optionnel et désactivé.** Activez-le uniquement pour ajouter une limitation de débit / détection de bots devant un déploiement public.
- **`latest` correspond à un véritable tag d'image.** L'ARG de build `LOBECHAT_VERSION` passe la version inchangée, donc `application_version = "latest"` se résout en le véritable `lobehub/lobe-chat:latest`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LobeChat {#a-gke-autopilot--the-lobechat-workload}

Les pods LobeChat sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum (1) et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail LobeChat pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Pas de base de données {#b-no-database}

LobeChat ne provisionne **aucune instance Cloud SQL** — `database_type = "NONE"`. En mode client-stocké, chaque conversation, paramètre et clé de fournisseur réside dans le navigateur de l'utilisateur, il n'y a donc pas de base de données côté serveur à laquelle se connecter, à sauvegarder ou à migrer, et aucun sidecar Cloud SQL Auth Proxy n'est injecté. L'activation du mode serveur Postgres en amont de LobeChat (pour la synchronisation inter-appareils) est hors de portée de ce module.

### C. Pas de stockage d'objets ni de volume persistant {#c-no-object-storage-or-persistent-volume}

Aucun bucket GCS, montage NFS ou PVC de bloc n'est déclaré par défaut (`storage_buckets` est vide, `enable_nfs = false`, `stateful_pvc_enabled` non défini/`null`). La charge de travail est sans état ; les pods ne transportent aucune donnée persistante.

- **CLI (pour confirmer qu'aucun n'est la propriété de l'application) :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"          # none expected
  ```

### D. Redis (optionnel — limitation de débit / détection de bots) {#d-redis-optional--rate-limiting--bot-detection}

Redis est **désactivé par défaut** (`enable_redis = false`). Activez-le uniquement pour ajouter une limitation de débit et une détection de bots devant une instance LobeChat publique. Lorsque `enable_redis = true` et `redis_host` est vide, l'application revient à `127.0.0.1` à moins que le Redis co-localisé NFS ne soit utilisé — définissez `redis_host` (ou `enable_nfs = true`) explicitement.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

LobeChat ne génère **aucun secret** — il n'y a pas de clés cryptographiques à protéger. Secret Manager (via le pilote CSI Secret Store) n'est utilisé que si *vous* choisissez d'injecter une clé de fournisseur côté serveur (par exemple `OPENAI_API_KEY`) via `secret_environment_variables`, qui fait référence à un secret que vous créez.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~lobechat"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LobeChat {#3-lobechat-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` et pas de schéma — la sortie `initialization_jobs` est vide. Le premier démarrage lance simplement le serveur Next.js.
- **Pas de migrations.** Sans base de données côté serveur en mode par défaut, la mise à niveau de `application_version` déploie simplement une nouvelle image ; il n'y a pas de schéma à migrer.
- **Pas de compte administrateur / pas d'identifiants par défaut.** Le mode client-stocké de LobeChat n'a pas de magasin d'utilisateurs côté serveur. La seule porte d'accès est la phrase secrète partagée optionnelle `ACCESS_CODE` (voir ci-dessous) ; sans elle, l'interface utilisateur est ouverte à quiconque atteint l'adresse IP du LoadBalancer.
- **Les utilisateurs fournissent leurs propres clés de modèle.** Chaque utilisateur colle les clés API du fournisseur dans l'interface utilisateur, conservées dans le `localStorage` du navigateur. Pour préconfigurer un fournisseur côté serveur à la place, injectez par exemple `OPENAI_API_KEY` (en tant que secret) et/ou `OPENAI_PROXY_URL` via `secret_environment_variables` / `environment_variables`.
- **Contrôlez l'accès avec `ACCESS_CODE`.** Pour tout déploiement exposé en externe, définissez une phrase secrète partagée afin que l'interface utilisateur de chat (et toutes les clés que les utilisateurs collent) ne soient pas exposées :
  ```bash
  # via the module: environment_variables = { ACCESS_CODE = "<passphrase>" }
  # verify it reached the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep ACCESS_CODE
  ```
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/` — le serveur Next.js de LobeChat renvoie HTTP 200 une fois démarré, sans authentification. Laissez la fenêtre de démarrage par défaut pour le démarrage à froid `next-server`.
- **Port fixe 3210.** L'image personnalisée épingle `PORT=3210` ; `container_port` doit rester `3210`.
- **`imagePullPolicy = Always` pour l'image miroir.** App_GKE force `Always` pour les images personnalisées/miroirs afin qu'un tag reconstruit soit ré-extrait lors du redéploiement plutôt que de servir une couche mise en cache obsolète.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour LobeChat sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lobechat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image LobeChat ; `latest` correspond au véritable `lobehub/lobe-chat:latest`. Épinglez un tag spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `500m` CPU / `1Gi` mémoire | Requêtes/limites par pod. Next.js `next-server` (plus les dépendances de rendu `pdfjs-dist`/canvas) OOM-plante au démarrage en dessous de 1Gi — augmentez la mémoire si vous constatez la même défaillance sous charge. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro) ; maintient l'interface utilisateur accessible. |
| `max_instance_count` | `3` | Sûr à augmenter — pas d'état de serveur partagé ni de prérequis de file d'attente. |
| `container_port` | `3210` | Port du serveur Next.js de LobeChat. Ne pas modifier sans reconstruire l'image. |
| `enable_image_mirroring` | `true` | Mettez en miroir `lobehub/lobe-chat` dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Remplacements optionnels — notamment `ACCESS_CODE` (protéger l'interface utilisateur) et les valeurs par défaut du fournisseur/thème. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utilisez ceci pour toute clé de fournisseur côté serveur (par exemple `OPENAI_API_KEY`). |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout en un déploiement sans état — LobeChat n'a pas besoin de PVC par pod. |
| `session_affinity` | `None` | Pas d'état de session côté serveur, donc pas de routage persistant requis. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser non défini — LobeChat est sans état en mode client-stocké ; il n'y a pas de données à persister par pod. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer uniquement pour la limitation de débit / détection de bots sur les déploiements publics. |
| `redis_host` | `""` | Point de terminaison Redis. Définir explicitement lorsque `enable_redis = true` (vide revient à `127.0.0.1`). |
| `redis_port` | `6379` | Port Redis. |

Les groupes Backend de base de données, Sauvegarde et maintenance, Système de fichiers (NFS) et Cloud Storage existent pour la mise en miroir des conventions mais sont **inertes** — `database_type = "NONE"` et aucun bucket/volume n'est déclaré, donc ces entrées ne créent aucune ressource. Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre LobeChat. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vide — LobeChat n'en a pas). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `workload_type = "Deployment"` à côté de `stateful_pvc_enabled = true`, IAP sans identités autorisées, unités de quota de mémoire binaires, un `redis_port` hors de portée. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `ACCESS_CODE` | Définir sur tout déploiement exposé | Élevé | Sans cela, l'interface utilisateur de chat — et toutes les clés de fournisseur que les utilisateurs collent — est ouverte à quiconque atteint l'adresse IP du LoadBalancer. |
| `container_resources` mémoire | `1Gi` (minimum) | Élevé | En dessous de 1 GiB, Next.js `next-server` OOM-plante au démarrage (`JavaScript heap out of memory`) et le pod ne devient jamais Prêt. |
| `container_port` | `3210` | Élevé | L'image épingle `PORT=3210` ; une non-concordance signifie que la sonde ne se connecte jamais et que le pod ne démarre pas. |
| Clés de fournisseur côté serveur | Injecter via `secret_environment_variables` | Élevé | Placer une clé API en clair `environment_variables` l'expose dans la spécification du pod et les journaux. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; le garde de validation rejette `0`. Maintenir 1 garantit que l'interface utilisateur reste accessible. |
| `stateful_pvc_enabled` | laisser non défini (`null`) | Moyen | L'activation d'un PVC ajoute un stockage par pod inutile — LobeChat ne persiste rien côté serveur en mode par défaut. |
| `enable_redis` | `false` sauf si public | Moyen | L'activation sans `redis_host` accessible (vide → `127.0.0.1`) rend la limitation de débit non fonctionnelle. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `application_version` | Épinglez un tag en production | Moyen | `latest` évolue avec l'amont ; une version surprise peut modifier le comportement lors du prochain déploiement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à LobeChat partagée avec la variante Cloud Run est décrite dans **[LobeChat_Common](LobeChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LobeChat sur GKE Autopilot](../labs/LobeChat_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [LobeChat Common — Configuration d'application partagée](LobeChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
