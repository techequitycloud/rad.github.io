---
title: "Agent Hermes sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de l'Agent Hermes sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Hermes_GKE.md @ e69407af sha256:4e8bf7e15c98 -->

# Agent Hermes sur GKE Autopilot {#hermes-agent-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hermes_GKE.png" alt="Agent Hermes sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

L'Agent Hermes est un agent IA personnel auto-hébergé et auto-améliorant,
open-source (licence MIT) de Nous Research : il apprend des compétences par
l'expérience, persiste la mémoire entre les sessions et se connecte aux
plateformes de messagerie ainsi qu'à une API compatible OpenAI à partir d'un
seul processus de passerelle
([documentation](https://hermes-agent.nousresearch.com/docs/)). Ce module
déploie l'image officielle `nousresearch/hermes-agent` sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Hermes utilise et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Hermes sur RAD, et comment cela se compare {#what-hermes-costs-on-rad-and-how-that-compares}

**L'exécution du pod Hermes sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 142,62 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 110 crédits facturé une seule fois au moment du déploiement. L'Agent Hermes est un agent IA personnel auto-hébergé avec une mémoire persistante, ce déploiement comprend donc à la fois une base de données pour cette mémoire et un petit serveur de fichiers pour son état de fonctionnement — il n'existe pas de version commerciale hébergée de ce projet exact pour comparer. Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) et le coût de fonctionnement est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Hermes_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût de fonctionnement Google Cloud | 142,62 $/mois, facturé par Google au prix catalogue | ~108 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **142,62 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est le seul, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — sur l'empreinte 1 vCPU/2 GiB de la variante Cloud Run, une classe plus petite ferait également l'affaire ; les 2 vCPU de la variante GKE correspondent plus étroitement aux boîtiers cités.
- Ce qu'un VPS nu ne vous offre pas ici est plus important que d'habitude pour un agent qui persiste la mémoire entre les sessions : sauvegardes automatiques de Postgres, rotation des secrets pour ses clés API et surveillance si le processus s'arrête — tout cela est couvert par la pile gérée de RAD.
- Les coûts de votre propre API LLM ne sont pas affectés dans les deux cas — cette comparaison ne concerne que l'infrastructure d'hébergement sur laquelle Hermes s'exécute, pas les appels de modèle qu'il effectue.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer
le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais
les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Hermes et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Hermes signifie redéployer à partir de
zéro. Cela coûte environ 113-116 crédits (les frais de module de 110 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Hermes devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût de fonctionnement — pour Hermes, c'est environ 3 jours ou
plus. La majeure partie de ce coût de fonctionnement est généralement la base de données (et, lorsque ce module en utilise une, le serveur de fichiers partagé VM ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Hermes s'exécute comme un pod de passerelle à réplica unique sur GKE Autopilot. Le déploiement
relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de passerelle, 2 vCPU / 2 GiB par défaut, `min=1` / `max=1` réplicas |
| État de l'agent | NFS auto-géré (Services_GCP) | Monté à `/opt/data` — configuration SQLite, sessions, compétences, mémoires. **Pas de Cloud SQL** |
| Secrets | Secret Manager (+ SecretSync) | `ANTHROPIC_API_KEY`, `API_SERVER_KEY` auto-généré et mot de passe du tableau de bord, `OPENAI_API_KEY` / `TELEGRAM_BOT_TOKEN` facultatifs |
| Image conteneur | Artifact Registry (miroir) | Image officielle pré-construite mise en miroir ; pas de build personnalisé, pas d'étape Cloud Build |
| Réseau | VPC + Cloud Load Balancing | Service LoadBalancer externe avec IP statique réservée par défaut |
| Base de données / cache | — | **Pas de Cloud SQL, pas de Redis** — Hermes est entièrement SQLite-sur-NFS |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Tout l'état de l'agent se trouve à `/opt/data`, et ce chemin est fixe à l'intérieur de
  l'image.** La plateforme partagée NFS est montée directement par-dessus
  (`enable_nfs = true`, `nfs_mount_path = "/opt/data"`, tous deux par défaut et
  **appliqués par une validation au moment de la planification**). Sans le montage, chaque redémarrage
  ou redéploiement de pod efface silencieusement l'identité accumulée de l'agent.
- **`max_instance_count` est validé à 1.** L'état d'Hermes est SQLite, qui a
  un modèle à un seul rédacteur — un deuxième réplica concurrent corrompt la base de données. La
  fondation déploie en outre des applications basées sur NFS avec la stratégie `Recreate`,
  de sorte que les mises à jour n'exécutent jamais brièvement deux pods sur le volume.
- **Le serveur API compatible OpenAI écoute sur le port 8642** et nécessite le
  `API_SERVER_KEY` auto-généré comme jeton de porteur.
- **Les sondes sont par défaut des écoutes de port TCP** — le serveur API nécessite une authentification, donc
  une sonde HTTP contre celui-ci renverrait 401 et bloquerait le déploiement.
- **Le tableau de bord web (port 9119, authentification de base) n'est pas exposé par le Service** —
  accédez-y avec `kubectl port-forward`.
- **`API_SERVER_KEY` est injecté comme un Secret Kubernetes explicite** plutôt que
  via SecretSync, qui peut matérialiser une valeur vide lors du premier déploiement avant
  que la réplication de Secret Manager ne soit terminée. Tous les autres secrets sont pris en charge par SecretSync.
- **Au moins une clé de fournisseur de modèle est requise lors du déploiement initial**
  (`anthropic_api_key`, ou `enable_openai` + `openai_api_key`) ; une vérification au moment de la planification
  avertit lorsqu'aucune n'est fournie.
- **Pas de jobs d'initialisation, pas de bootstrap de base de données** — le premier démarrage initialise uniquement
  `/opt/data` sur le partage NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Hermes {#a-gke-autopilot--the-hermes-workload}

Le pod de passerelle Hermes est planifié sur Autopilot, qui facture le CPU/la mémoire
que le pod demande réellement. Les réplicas sont fixés à un ; les signaux intéressants
sont la disponibilité du pod, les redémarrages et le montage du volume NFS.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Hermes pour
  les pods et les événements ; Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl describe pod -n "$NAMESPACE" <pod>            # events: probes, mounts
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour Autopilot, les types de charges de travail et le cycle de vie du déploiement.

### B. Stockage partagé NFS — l'identité de l'agent {#b-nfs-shared-storage--the-agents-identity}

L'intégralité de l'état de l'agent (base de données de configuration SQLite, clés API, sessions, compétences apprises, mémoires) réside sur le serveur NFS auto-géré partagé provisionné par
`Services_GCP` (`create_network_filesystem = true`), monté à `/opt/data` dans
le pod. La VM NFS doit être `RUNNING` avant que ce module ne soit déployé — la découverte
la trouve par étiquette.

- **Console :** Compute Engine → Instances de VM (la VM du serveur NFS).
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  # Confirm the mount inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /opt/data
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /opt/data
  ```

Le partage et ses données sont **détenus par Services_GCP** — la destruction du déploiement Hermes
ne supprime pas l'état de l'agent sur l'exportation NFS.

### C. Secret Manager {#c-secret-manager}

Cinq secrets peuvent exister par déploiement : `ANTHROPIC_API_KEY` (fourni par l'opérateur),
`API_SERVER_KEY` (hexadécimal auto-généré de 64 caractères — le jeton de porteur de l'API de passerelle),
`HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` (auto-généré), et éventuellement
`OPENAI_API_KEY` et `TELEGRAM_BOT_TOKEN`. Ils apparaissent dans l'espace de noms comme
des Secrets Kubernetes (SecretSync pour la plupart ; un Secret explicite pour
`API_SERVER_KEY`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hermes"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secrets -n "$NAMESPACE"
  ```

Les variables d'identification vides lors d'un déploiement de mise à jour conservent la version `latest` stockée. Voir [App_GKE](App_GKE.md) pour l'intégration de SecretSync.

### D. Artifact Registry — l'image mise en miroir {#d-artifact-registry--the-mirrored-image}

L'image officielle `nousresearch/hermes-agent:<version>` est mise en miroir dans
Artifact Registry avant le déploiement (`enable_image_mirroring = true`) afin que les nœuds
ne tirent jamais de Docker Hub. Il n'y a **pas d'étape Cloud Build** — il s'agit d'un module
pré-construit. Les images mises en miroir sont tirées avec `imagePullPolicy: Always`.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --filter="package~hermes"
  ```

### E. Réseau et ingress {#e-networking--ingress}

La passerelle est exposée par défaut via un service LoadBalancer externe, avec
une IP statique réservée afin que l'adresse survive aux redéploiements. Le serveur API applique
sa propre authentification par jeton de porteur, de sorte que le point de terminaison public est
intentionnel ; un domaine personnalisé avec un certificat géré peut être superposé via l'API Gateway.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE vers Cloud Monitoring. Le
test de disponibilité est **désactivé par défaut** — le serveur API nécessite une authentification, donc un
test de disponibilité non authentifié échouerait toujours.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Hermes {#3-hermes-application-behaviour}

- **Initialisation du répertoire de données au premier démarrage.** L'ENTRYPOINT de l'image est
  `/init` de s6-overlay, qui démarre en tant que root, `chown` le volume `/opt/data`
  (le nouveau répertoire NFS) à l'utilisateur non-root `hermes`, puis abandonne les privilèges
  et démarre la passerelle (`container_args = ["gateway", "run"]` — la
  commande par défaut de l'image est l'interface CLI interactive, la passerelle doit donc être démarrée explicitement).
- **Pas de job d'initialisation de base de données.** Hermes crée sa propre base de données de configuration SQLite sous
  `/opt/data` au premier démarrage ; il n'y a rien à amorcer et
  `initialization_jobs` est vide. `database_type = "NONE"` et
  `enable_redis = false` sont codés en dur dans l'appel de la Fondation.
- **L'accès à l'API nécessite le `API_SERVER_KEY`.** Le point de terminaison compatible OpenAI sur
  le port 8642 s'authentifie avec un jeton de porteur :
  ```bash
  KEY=$(gcloud secrets versions access latest --secret=<api-server-key-secret> --project "$PROJECT")
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:8642/v1/models"
  ```
  (Le Service mappe son port au port du conteneur ; vérifiez `kubectl get svc` pour
  le port exposé.)
- **Tableau de bord via port-forward.** Le tableau de bord web intégré (gestion des clés API,
  configuration de profil) s'exécute sur le port 9119 derrière une authentification de base et n'est
  pas exposé par le Service. Accédez-y localement :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 9119:9119
  # then open http://localhost:9119 — user `admin`, password from Secret Manager
  ```
- **Configuration du connecteur (Telegram).** Définissez `enable_telegram = true` et fournissez
  `telegram_bot_token` (depuis @BotFather). Le connecteur Telegram d'Hermes
  **interroge longuement en sortie** — aucun webhook, routeur ou URL de rappel public n'est nécessaire.
  Une validation au moment de la planification rejette `enable_telegram = true` avec un jeton vide.
  D'autres connecteurs (Discord, Slack, WhatsApp, Signal) sont configurés via la
  carte `environment_variables` de l'opérateur.
- **Les mises à jour de version utilisent `Recreate`.** Étant donné que l'application est basée sur NFS, la
  fondation remplace le pod par un arrêt puis un démarrage au lieu d'un déploiement progressif — une brève interruption de
  disponibilité pendant les mises à jour est attendue et protège la base de données SQLite d'un
  chevauchement de deux rédacteurs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Hermes sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet, Identité et Identifiants {#group-1--project-identity--credentials}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `anthropic_api_key` | `""` | Clé principale du fournisseur de modèle, injectée en tant que `ANTHROPIC_API_KEY`. Requise lors du déploiement initial (ou utilisez OpenAI) ; omettez lors des mises à jour pour conserver la version stockée. |
| `api_server_key` | `""` (auto) | Jeton de porteur pour le serveur API compatible OpenAI. Hexadécimal auto-généré de 64 caractères lorsqu'il est vide. |
| `enable_openai` / `openai_api_key` | `false` / `""` | Fournisseur secondaire facultatif, injecté en tant que `OPENAI_API_KEY`. |
| `enable_dashboard` | `true` | Exécute le tableau de bord du port 9119 en cours de processus ; accessible via `kubectl port-forward`. |
| `dashboard_username` / `dashboard_password` | `admin` / `""` (auto) | Authentification de base du tableau de bord ; mot de passe auto-généré dans Secret Manager. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hermes` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `nousresearch/hermes-agent` ; épingler à un tag de version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources` | `2000m` / `2Gi` | Limites de CPU et de mémoire pour le conteneur de la passerelle. |
| `min_instance_count` | `1` | Maintenir à 1 pour éviter les démarrages à froid pour les sessions d'agent. |
| `max_instance_count` | `1` | **Validé à 1** — SQLite à rédacteur unique sur le NFS partagé. |
| `container_port` | `8642` | Port du serveur API compatible OpenAI de la passerelle. |
| `timeout_seconds` | `3600` | Les sessions d'agent peuvent être de longue durée. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle sans étape de build. |
| `enable_image_mirroring` | `true` | Mettre en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configuration supplémentaire ; les variables gérées par le module (`API_SERVER_*`, `HERMES_DASHBOARD*`) ont la priorité. Utilisez-les pour les identifiants de connecteur Discord/Slack/WhatsApp/Signal ou les points de terminaison de fournisseur (par exemple, OpenRouter). |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager existant. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe par défaut ; le serveur API applique l'authentification par jeton de porteur. |
| `session_affinity` | `ClientIP` | Routage persistant (réplica unique, donc principalement sans objet). |
| `termination_grace_period_seconds` | `60` | Temps pour que les sessions d'agent actives se terminent lors de l'arrêt. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 10s, 36 tentatives | Écoute de port TCP — sûre quelle que soit l'authentification du serveur API ; marge pour le montage NFS et l'initialisation au premier démarrage. |
| `liveness_probe` | TCP, délai de 30s | Écoute de port TCP. |
| `uptime_check_config` | désactivé | Un test de disponibilité non authentifié échouerait toujours contre le serveur API authentifié. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Requis — validé.** L'identité entière de l'agent réside sous `/opt/data`. |
| `nfs_mount_path` | `/opt/data` | Le répertoire de données fixe de l'image ; le partage NFS est monté directement par-dessus. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Montages GCSFuse auxiliaires uniquement — ne jamais pointer vers `/opt/data` (SQLite est dangereux sur GCSFuse). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Connecteurs Hermes {#group-15--hermes-connectors}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_telegram` | `false` | Provisionne le secret du jeton du bot Telegram et injecte `TELEGRAM_BOT_TOKEN`. |
| `telegram_bot_token` | `""` | Jeton du bot de @BotFather ; requis (validé) lorsque `enable_telegram = true`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Configuration de domaine personnalisé de l'API Gateway avec SSL géré (nécessite `application_domains`). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Miroirs de convention inertes : la base de données (groupe 16), Redis (miroirs du groupe 15),
SQL personnalisé (groupe 18) et les variables `enable_cloudsql_volume` sont déclarées pour
la parité de convention mais désactivées en dur dans `main.tf` — Hermes n'a pas de base de données et
pas de Redis.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL pour atteindre le serveur API de la passerelle. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `cron_jobs` | Noms des jobs de configuration et planifiés (vides par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsqu'une charge de travail StatefulSet est sélectionnée). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le point de terminaison du cluster était lisible et si les charges de travail Kubernetes ont été déployées (faux lors du premier apply d'un nouveau cluster inline — réexécutez apply). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment de la planification.** Le `validation.tf` de ce module et le
> moteur de fondation [App_GKE](App_GKE.md) valident les valeurs *et les combinaisons* au
> moment de la planification — `max_instance_count > 1`, `enable_nfs = false`, un connecteur Telegram
> sans son jeton, ou OpenAI activé sans clé échouent tous la
> **planification** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (validé) | Critique | Un deuxième réplica concurrent écrit dans la même base de données SQLite sur NFS — la violation du rédacteur unique corrompt l'état entier de l'agent. |
| `enable_nfs` | `true` (validé) | Critique | Sans le montage NFS, `/opt/data` est un disque de pod éphémère — chaque redémarrage / redéploiement efface silencieusement l'identité de l'agent (configuration, sessions, compétences, mémoires). |
| `gcs_volumes` à `/opt/data` | jamais | Critique | GCSFuse manque de verrouillage POSIX et de renommages atomiques ; SQLite sur GCSFuse se corrompt. Gardez l'état sur NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `anthropic_api_key` (ou paire OpenAI) | défini au premier déploiement | Élevé | Sans aucune clé de fournisseur, l'agent ne peut pas exécuter un seul tour. |
| VM NFS non `RUNNING` | attendre avant de déployer | Élevé | La découverte ne trouve aucun serveur → le module crée un NFS inline ou le montage échoue ; le pod reste en `ContainerCreating`. |
| `startup_probe` / `liveness_probe` | TCP (par défaut) | Moyen | Une sonde HTTP contre le serveur API authentifié renvoie 401/403 indéfiniment — le pod ne devient jamais prêt et le déploiement se bloque. |
| `min_instance_count` | `1` | Moyen | GKE n'a pas de mise à l'échelle à zéro, mais une mise à l'échelle manuelle laisse les connecteurs hors ligne. |
| `application_version` | épingler un tag de version | Moyen | `latest` se résout à nouveau par exécution de miroir ; le comportement peut changer lors du redéploiement. |
| `enable_telegram` sans jeton | bloqué | Faible | La validation au moment de la planification le rejette ; le connecteur ne peut pas démarrer sans le jeton du bot. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Hermes
partagée avec la variante Cloud Run est décrite dans
**[Hermes_Common](Hermes_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Agent Hermes sur GKE Autopilot](../labs/Hermes_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Agent Hermes sur Google Cloud Run](Hermes_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hermes Common — Configuration d'application partagée](Hermes_Common.md) — la configuration partagée par les deux cibles de déploiement.
