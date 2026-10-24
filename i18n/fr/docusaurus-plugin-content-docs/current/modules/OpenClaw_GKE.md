---
title: "OpenClaw sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'OpenClaw sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenClaw_GKE.md @ e69407af sha256:0e7fa80c1ab2 -->

# OpenClaw sur GKE Autopilot {#openclaw-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenClaw_GKE.png" alt="OpenClaw sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenClaw est une passerelle d'agents IA multi-locataires conçue spécifiquement pour des
déploiements d'agents isolés et persistants. Elle permet aux équipes d'exécuter des
assistants IA par locataire, basés sur des modèles Anthropic, avec des espaces de travail
GCS dédiés et une intégration optionnelle aux canaux Telegram ou Slack — le tout sans
état partagé entre les agents. Ce module déploie OpenClaw sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par OpenClaw et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et le cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte OpenClaw sur RAD et comment cela se compare {#what-openclaw-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'OpenClaw sur RAD coûte environ 129–202 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à OpenClaw qui doit rester opérationnel, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](OpenClaw_CloudRun.md) exécute le même OpenClaw pour environ 69 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **OpenClaw**, qui est open source, il n'y a donc pas de frais de licence par
utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **129 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Facturé à l'heure en crédits ; RAD publie **105 crédits par jour**, soit environ 3 150 par mois (environ 315 $ US au prix de la recharge, 252 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 129 $ US** (environ 202 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour OpenClaw lui-même**, donc la comparaison honnête est un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et plus petite que les boîtiers de référence ci-dessous ferait également l'affaire ; les chiffres sont présentés pour une comparaison équivalente.
- OpenClaw est une passerelle d'agents IA multi-locataires sur mesure sans équivalent SaaS prêt à l'emploi. L'alternative réaliste est de construire vous-même la même isolation par locataire (espaces de travail séparés, secrets, intégrations de canaux) sur un VPS ou un Kubernetes géré, ce qui représente un effort d'ingénierie nettement plus important que le déploiement en un clic de RAD, en plus de la nécessité de votre propre PostgreSQL géré.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui appliquez les correctifs au système d'exploitation, faites tourner les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent cela pour vous, ce qui est le véritable argument en faveur de RAD par rapport à une boîte moins chère — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenClaw s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du
projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à
OpenClaw dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un
projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à
  la suppression d'un seul module, cela ne détruit pas la base de données, le cluster ou
  la ressource de calcul un par un — l'ensemble du projet, et tout ce qu'il contient,
  s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours,
  le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le
  projet et de rattacher son compte de facturation, puis vous demande d'exécuter
  **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a
  été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
  facture plus jamais les frais de module. Cela coûte environ une poignée de crédits
  (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 129 $
  US.** Déployez OpenClaw, utilisez-le pendant un certain temps, supprimez le projet.
  Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module
  une seule fois, les builds, et le temps pendant lequel OpenClaw était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même
  dans les 30 jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés doit
  toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient
  à la plupart des utilisations d'étude et de démo). Google indique que la plupart des
  services sont entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas**
  protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il
  ait disparu dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé OpenClaw et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors
  du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 115 crédits (11,50 $ US) dans votre propre projet, ou 104 crédits dans un
  projet géré par RAD. La suppression permet d'économiser de l'argent si OpenClaw devait
  rester inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 4,31
  $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD (105 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM
  de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le
  projet ne les utilise, donc la suppression d'OpenClaw alors que quelque chose d'autre
  partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière
  sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant reçoit OpenClaw dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute OpenClaw
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle
  directement avec le client. Si le portefeuille est faible, la facturation est mise en
  pause et les données sont conservées, afin que personne ne reçoive de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

OpenClaw s'exécute comme une charge de travail de passerelle Node.js sur GKE Autopilot. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique |
| Stockage de l'espace de travail | Cloud Storage (GCS Fuse) | Bucket d'espace de travail par locataire monté à `/data` via le pilote CSI GCS Fuse |
| Identifiants IA | Secret Manager | Clé API Anthropic et jeton de passerelle toujours stockés ; secrets Telegram et Slack optionnels |
| Ingress | Cloud Load Balancing | `LoadBalancer` par défaut (IP externe publique) ; `ClusterIP` ou un domaine personnalisé disponible |
| Secrets | Secret Manager | Tous les identifiants injectés au démarrage du pod ; le texte en clair n'apparaît jamais dans la configuration |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** OpenClaw est une passerelle Node.js avec état
  entièrement supportée par GCS Fuse à `/data`. Cloud SQL et Redis ne sont jamais
  provisionnés.
- **L'image de conteneur personnalisée est toujours construite.** Le module superpose un
  `entrypoint.sh` à l'image amont `ghcr.io/openclaw/openclaw`. L'argument de build `BASE_IMAGE` est
  épinglé à `application_version`.
- **L'espace de travail GCS à `/data` est toujours monté.** Un bucket `<prefix>-storage`
  dédié est toujours provisionné et monté par le pilote CSI GCS Fuse. L'état persistant
  de l'agent y réside après les redémarrages de pod.
- **`OPENCLAW_STATE_DIR` est sur disque local.** La mise en scène npm et le répertoire de
  configuration XDG sont redirigés vers `/tmp/openclaw` pour éviter les limitations de liens
  physiques de GCS Fuse pendant le démarrage.
- **`min_instance_count = 1` par défaut.** Maintient l'agent actif afin que les événements de webhook de
  Telegram ou Slack ne soient pas perdus lors d'un démarrage à froid.
- **L'affinité de session est `ClientIP`.** Garantit que les sessions WebSocket d'un
  utilisateur sont systématiquement acheminées vers le même pod lorsque plusieurs réplicas
  sont en cours d'exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenClaw {#a-gke-autopilot--the-openclaw-workload}

Les pods OpenClaw sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail OpenClaw
  pour voir les pods, les événements et l'utilisation des ressources. Kubernetes Engine →
  Services & Ingress affiche le point de terminaison du service.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Deployment vs StatefulSet).

### B. Cloud Storage — espace de travail GCS Fuse {#b-cloud-storage--gcs-fuse-workspace}

Tout l'état durable de l'agent est stocké dans un bucket Cloud Storage dédié et monté dans
les pods à `/data` par le pilote CSI GCS Fuse. La disposition de l'espace de travail est :

```
<prefix>-storage/
├── workspace/              ← agent workspace (/data/workspace)
│   └── skill-library/      ← shared skills repo (when skills_repo_url is set)
├── agents/main/agent/      ← agent state directory
└── ...
```

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `<prefix>-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<prefix>-storage/
  # Confirm the bucket is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
  ```

Voir [App_GKE](App_GKE.md) pour GCS Fuse CSI, les options CMEK et le cycle de vie des
buckets.

### C. Secret Manager — identifiants {#c-secret-manager--credentials}

La clé API Anthropic et le jeton de passerelle sont toujours stockés dans Secret Manager.
Lorsque l'intégration Telegram ou Slack est activée, les jetons de bot et les secrets de
webhook/signature y sont également stockés. Tous les identifiants sont injectés au
démarrage du pod ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the Anthropic key (initial deploy only; manage via Secret Manager thereafter):
  gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"
  # Retrieve the gateway token (needed to register clients):
  gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée en tant que service `LoadBalancer` avec une IP
externe publique. Définissez `service_type = "ClusterIP"` pour un accès interne uniquement (généralement
derrière un service de routeur OpenClaw), ou activez un domaine personnalisé via l'API
Kubernetes Gateway pour un accès externe direct sur un nom d'hôte stable.

- **Console :** Kubernetes Engine → Services & Ingress ; réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud Armor et
les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
sont acheminées vers Cloud Monitoring. Une vérification de disponibilité optionnelle et
des politiques d'alerte sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenClaw {#3-openclaw-application-behaviour}

- **Pas de job de configuration de base de données.** OpenClaw ne nécessite pas de Cloud
  SQL ni de job d'initialisation. L'état de l'agent réside entièrement sur GCS ; le
  premier démarrage du pod crée automatiquement les répertoires de l'espace de travail
  via `entrypoint.sh`.
- **Configuration régénérée à chaque démarrage.** `entrypoint.sh` réécrit toujours
  `openclaw.json` dans `$OPENCLAW_STATE_DIR`, garantissant que les variables d'environnement gérées
  par Terraform (clés API, jeton de passerelle, paramètres de canal) l'emportent sur
  toutes les valeurs obsolètes précédemment persistées sur GCS.
- **Synchronisation du référentiel de compétences (facultatif).** Lorsque `skills_repo_url` est
  défini, `entrypoint.sh` effectue un clone superficiel ou une mise à jour du référentiel
  dans `/data/workspace/skill-library` à chaque démarrage de pod. La synchronisation n'est pas fatale — la
  passerelle démarre même si le clone échoue. Inspectez la synchronisation sur un pod en
  cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data/workspace/skill-library
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /health` sur le port 8080. La sonde de démarrage autorise jusqu'à environ 3 minutes
  (36 × 5 s) pour que npm mette en scène les paquets de plugins groupés avant que la
  passerelle ne soit déclarée non saine.
- **Affinité de session.** Le service Kubernetes utilise l'affinité `ClientIP` par
  défaut afin que la connexion WebSocket d'un utilisateur soit systématiquement acheminée
  vers le même pod lorsque plusieurs réplicas sont déployés.
- **Telegram et Slack.** Lorsque `enable_telegram` est défini, le jeton du bot est injecté en
  tant que `TELEGRAM_BOT_TOKEN`. Lorsque `enable_slack` est défini, le jeton du bot et le jeton au
  niveau de l'application sont injectés en tant que `SLACK_BOT_TOKEN` et `SLACK_APP_TOKEN`, et le
  point d'entrée connecte l'agent à Slack via le **mode Socket** : un WebSocket sortant
  qui ne nécessite pas d'ingress public ni de routeur. Slack est livré en tant que plugin
  séparé `@openclaw/slack`, que le point d'entrée installe à chaque démarrage. L'accès est
  fermé en cas d'échec : les messages directs uniquement des ID de membre dans
  `SLACK_ALLOW_FROM`, les canaux uniquement des ID dans `SLACK_CHANNELS` (avec mention), les deux
  passant par `environment_variables`. Le secret du webhook Telegram et le secret de signature Slack
  optionnel sont stockés dans Secret Manager pour un service de routeur compagnon et ne
  sont pas injectés dans le conteneur de l'agent.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour OpenClaw sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et
ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `anthropic_api_key` | _(obligatoire lors du premier déploiement)_ | Clé API Anthropic. Stockée dans Secret Manager et injectée en tant que `ANTHROPIC_API_KEY`. Omettre lors des mises à jour pour conserver la valeur stockée. Sensible. |
| `gateway_token` | _(auto-généré)_ | Jeton d'authentification de la passerelle. Un jeton hexadécimal sécurisé de 64 caractères est généré s'il est laissé vide. Stocké dans Secret Manager en tant que `OPENCLAW_GATEWAY_TOKEN`. Sensible. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openclaw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `OpenClaw Gateway` | Nom convivial affiché dans la console. |
| `description` | `OpenClaw AI Gateway - Multi-tenant AI agent gateway on GKE Autopilot` | Brève description de l'objectif de l'application. |
| `application_version` | `latest` | Tag d'image OpenClaw utilisé comme argument de build `BASE_IMAGE`. Épinglez à une version spécifique pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | Limites de CPU et de mémoire. Minimum 2 vCPU / 2 Gio recommandé pour les charges de travail d'agents. |
| `min_instance_count` | `1` | Nombre minimum de réplicas de pods. Gardez ≥ 1 pour que les événements de webhook ne soient pas perdus lors du démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximum de réplicas de pods. OpenClaw est avec état — utilisez 1 par locataire, sauf si vous utilisez le routage de session persistante. |
| `container_port` | `8080` | Port sur lequel la passerelle OpenClaw écoute. Doit correspondre à la variable d'environnement `PORT`. |
| `timeout_seconds` | `3600` | Délai d'expiration de la requête. Les sessions d'agent sont de longue durée ; 3600 s est le maximum. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite vers Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources (désactive HPA). |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables gérées par le module (`OPENCLAW_STATE_DIR`, `NODE_ENV`, etc.) ont toujours la priorité. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager existant. Les identifiants principaux sont gérés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE. Découvre automatiquement le cluster géré par Services_GCP s'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Auto-généré à partir du préfixe de ressource s'il est vide. |
| `workload_type` | `null` | `Deployment` pour les réplicas sans état basés sur GCS ; `StatefulSet` pour l'identité de pod persistante. |
| `service_type` | `LoadBalancer` | `ClusterIP` pour un accès interne uniquement ; `LoadBalancer` pour un accès externe direct. |
| `session_affinity` | `ClientIP` | Routage persistant pour la cohérence des sessions WebSocket entre les réplicas. |
| `termination_grace_period_seconds` | `60` | Période de grâce pour que les sessions d'agent actives se terminent avant la terminaison du pod. |
| `network_tags` | `[]` | Tags réseau de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — Configuration de StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC pour StatefulSet. OpenClaw utilise normalement GCS — activez uniquement si les performances du disque local sont requises. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. |
| `stateful_pvc_mount_path` | `/pvc-data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_headless_service` | `null` | Crée un service sans tête pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID du fsGroup dans le contexte de sécurité du pod ; `0` le laisse non défini. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, seuil de 36 tentatives | Permet environ 3 minutes pour le démarrage de npm et le montage de GCS Fuse. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Redémarre le pod si la passerelle ne répond plus. |
| `uptime_check_config` | `{ enabled = false }` | Désactivé par défaut pour les services `ClusterIP` (non accessibles de l'extérieur). |
| `alert_policies` | `[]` | Politiques d'alerte métriques optionnelles. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw n'a pas de job d'initialisation par défaut. Utilisez-le pour l'amorçage personnalisé de l'espace de travail. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, archivage de l'espace de travail). |
| `additional_services` | `[]` | Services sidecar ou compagnons (par exemple, un routeur OpenClaw). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | OpenClaw utilise GCS Fuse pour l'état. NFS n'est pas requis et est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS. Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets supplémentaires définis dans `storage_buckets`. Le bucket de l'espace de travail est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket d'espace de travail auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le volume `openclaw-data` à `/data` est toujours ajouté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Configuration OpenClaw {#group-15--openclaw-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `skills_repo_url` | `""` | URL GitHub d'un référentiel de compétences partagé. Cloné dans `/data/workspace/skill-library` à chaque démarrage de pod. Laissez vide pour ignorer. |
| `skills_repo_ref` | `main` | Référence Git (branche, tag ou SHA) à extraire. |
| `enable_telegram` | `false` | Provisionne un secret de jeton de bot Telegram et injecte `TELEGRAM_BOT_TOKEN`. Nécessite `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Jeton de bot Telegram de @BotFather. Sensible. |
| `telegram_webhook_secret` | `""` | Secret de validation de webhook pour le routeur (non injecté dans l'agent). Générer avec `openssl rand -hex 32`. Sensible. |
| `enable_slack` | `false` | Connecte l'agent à Slack via le mode Socket (WebSocket sortant — pas d'ingress ni de routeur). Provisionne les secrets Slack et injecte `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`. Nécessite `slack_bot_token` et `slack_app_token`. |
| `slack_bot_token` | `""` | Jeton de bot Slack (`xoxb-...`). Sensible. |
| `slack_app_token` | `""` | Jeton au niveau de l'application Slack (`xapp-...`, portée `connections:write`) pour le mode Socket. Sensible. |
| `slack_signing_secret` | `""` | Facultatif. Secret de signature Slack pour un routeur d'URL de requête HTTP uniquement (non injecté ; le mode Socket ne l'utilise pas). Sensible. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron pour la sauvegarde automatisée de l'espace de travail (UTC). |
| `backup_retention_days` | `7` | Jours de rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Importe une sauvegarde de l'espace de travail lors du déploiement. `backup_format` par défaut à `tar`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle Kubernetes avec SSL pour les noms d'hôtes personnalisés. Requis pour IAP. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant OpenClaw. Nécessite `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé. Sensible. |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` / `admin_ip_ranges` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run) / CIDR d'administration. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre la passerelle OpenClaw. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et référentiel Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
| `cron_jobs` | Noms des CronJobs créés. |
| `statefulset_name` | Nom du StatefulSet (lorsque `workload_type = "StatefulSet"`). |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Référentiel GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — un second apply est requis. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `anthropic_api_key` | Défini lors du premier déploiement | Critique | Sans clé valide, l'agent démarre mais toutes les requêtes AI échouent avec des erreurs 401. |
| `gateway_token` cohérence | Auto-généré ou défini une fois | Critique | La rotation du jeton dans Secret Manager sans redémarrer les pods entraîne le rejet de toutes les requêtes client jusqu'au recyclage des pods. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `telegram_bot_token` / `slack_bot_token` | défini lorsque l'intégration est activée | Élevé | Un jeton vide entraîne l'échec de tous les appels API ; les messages sont supprimés. |
| `telegram_webhook_secret` / `slack_signing_secret` | défini lorsque l'intégration est activée | Élevé | Une valeur vide désactive la vérification de signature, permettant l'injection de faux webhooks. |
| `min_instance_count` | `1` | Élevé | `0` signifie que les événements webhook de Telegram/Slack sont supprimés pendant le démarrage à froid (généralement 30 à 60 s pour l'initialisation du pod GKE). |
| `skills_repo_url` | URL accessible ou vide | Élevé | Une URL inaccessible entraîne l'échec du git clone au démarrage, plaçant le pod en CrashLoopBackOff. |
| `skills_repo_ref` | référence existante | Élevé | Une branche ou une balise inexistante entraîne l'échec du clone à chaque démarrage. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les déploiements multi-réplicas répartissent l'état WebSocket entre les pods. |
| `enable_iap` | activer pour l'administration | Moyen | La passerelle est autrement accessible publiquement. Les points de terminaison webhook Telegram/Slack ne peuvent pas s'authentifier avec l'identité Google — assurez-vous qu'ils ne sont pas derrière IAP. |
| `stateful_pvc_enabled` | `false` | Moyen | OpenClaw utilise GCS. Les PVC ajoutent un disque local inutilisé et peuvent bloquer le rééchelonnement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la conformité ; une purge accidentelle du bucket entraîne une perte permanente de l'état de l'agent. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `enable_vpc_sc` sans `organization_id` | définir explicitement | Moyen | VPC-SC est silencieusement ignoré, laissant les identifiants sans protection périmétrique. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes,
et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à OpenClaw
partagée avec la variante Cloud Run est décrite dans
**[OpenClaw_Common](OpenClaw_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : OpenClaw sur GKE Autopilot](../labs/OpenClaw_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenClaw sur Google Cloud Run](OpenClaw_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [OpenClaw Common — Configuration d'application partagée](OpenClaw_Common.md) — la configuration partagée par les deux cibles de déploiement.
