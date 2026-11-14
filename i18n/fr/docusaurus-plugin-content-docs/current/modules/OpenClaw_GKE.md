---
title: "OpenClaw sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'OpenClaw sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenClaw_GKE.md @ 40c83c3f sha256:a93956c4c8ac -->

# OpenClaw sur GKE Autopilot {#openclaw-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenClaw_GKE.png" alt="OpenClaw sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenClaw est une passerelle d'agents IA mutualisée, conçue spécifiquement pour des
déploiements d'agents isolés et persistants. Elle permet aux équipes d'exécuter des
assistants IA par locataire, basés sur des modèles Anthropic, avec des espaces de travail
GCS dédiés et une intégration optionnelle aux canaux Telegram ou Slack — le tout sans
état partagé entre les agents. Ce module déploie OpenClaw sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'OpenClaw utilise et sur la manière de les
explorer et de les opérer depuis la Google Cloud Console et la ligne de commande. Pour les
mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte OpenClaw sur RAD, et comparaison {#what-openclaw-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'OpenClaw sur RAD coûte environ 129–202 $ US par mois, avec les frais de module facturés une seule fois en crédits RAD.** GKE Autopilot convient à OpenClaw qui doit rester actif, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](OpenClaw_CloudRun.md) exécute le même OpenClaw pour environ 69 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **OpenClaw**, qui est open source, il n'y a donc pas de frais de licence par
utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **129 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **135 crédits par jour**, soit environ 4 050 par mois (environ 405 $ US au prix de la recharge ; estimé à partir des prix catalogue Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre du projet propre suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore assez d'historique GKE géré par RAD pour le mesurer, donc la confirmation de déploiement ne le cite pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 129 $ US** (environ 202 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comparaison {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour OpenClaw lui-même**, donc la comparaison honnête est un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et plus petite que les boîtiers de référence ci-dessous ferait également l'affaire ; les chiffres sont présentés pour une comparaison équivalente.
- OpenClaw est une passerelle d'agents IA mutualisée sur mesure sans équivalent SaaS prêt à l'emploi à comparer. L'alternative réaliste est de construire vous-même la même isolation par locataire (espaces de travail séparés, secrets, intégrations de canaux) sur un VPS ou un Kubernetes géré, ce qui représente un effort d'ingénierie nettement plus important que le déploiement en un clic de RAD, en plus de nécessiter votre propre PostgreSQL géré.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui corrigez le système d'exploitation, faites tourner les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL géré, Secret Manager et la surveillance de RAD s'en occupent pour vous, ce qui est le véritable argument en faveur de RAD par rapport à une boîte moins chère — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenClaw s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet
et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à OpenClaw
dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet
saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration. Il ne faut donc pas se fier à la restauration comme moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la
  suppression d'un module, cela ne détruit pas la base de données, le cluster ou la
  ressource de calcul un par un — l'ensemble du projet, et tout ce qu'il contient,
  s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et
  de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais
  de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque
  déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 405
  $ US par mois pour le maintenir en fonctionnement.** Déployez OpenClaw, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en
  avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé.
  Vous ne payez les frais de module qu'une seule fois et le temps pendant lequel OpenClaw
  était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous
  apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration est admise
  comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours
  dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des
  utilisations d'étude et de démo conviennent). Google indique que la plupart des services
  sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse
  dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé OpenClaw et que vous souhaitez conserver ce travail,
  copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
  supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet,
ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont
  inclus) : 110 crédits (11,00 $ US) dans votre propre projet, ou 99 crédits dans un projet
  géré par RAD. La suppression permet d'économiser de l'argent une fois qu'OpenClaw
  resterait inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ
  4,31 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD (135 crédits
  par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM
  de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet
  ne les utilise, donc la suppression d'OpenClaw alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul propre à cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
  sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant dispose d'OpenClaw dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute OpenClaw
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement
  avec le client. Si le portefeuille est faible, la facturation est suspendue et les
  données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la propriété du client.
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
| Secrets | Secret Manager | Tous les identifiants injectés au démarrage du pod ; texte en clair jamais dans la configuration |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** OpenClaw est une passerelle Node.js avec état
  entièrement basée sur GCS Fuse à `/data`. Cloud SQL et Redis ne sont jamais
  provisionnés.
- **L'image de conteneur personnalisée est toujours construite.** Le module superpose un
  `entrypoint.sh` à l'image amont `ghcr.io/openclaw/openclaw`. L'argument de build
  `BASE_IMAGE` est épinglé à `application_version`.
- **L'espace de travail GCS à `/data` est toujours monté.** Un bucket
  `<prefix>-storage` dédié est toujours provisionné et monté par le pilote CSI GCS Fuse.
  L'état persistant de l'agent réside ici lors des redémarrages de pod.
- **`OPENCLAW_STATE_DIR` est sur le disque local.** La mise en scène npm et le répertoire de
  configuration XDG sont redirigés vers `/tmp/openclaw` pour éviter les limitations de
  liens physiques de GCS Fuse pendant le démarrage.
- **`min_instance_count = 1` par défaut.** Maintient l'agent chaud afin que les événements de
  webhook de Telegram ou Slack ne soient pas perdus lors d'un démarrage à froid.
- **L'affinité de session est `ClientIP`.** Garantit que les sessions WebSocket d'un
  utilisateur sont acheminées de manière cohérente vers le même pod lorsque plus d'un
  réplica est en cours d'exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenClaw {#a-gke-autopilot--the-openclaw-workload}

Les pods OpenClaw sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  OpenClaw pour voir les pods, les événements et l'utilisation des ressources. Kubernetes
  Engine → Services et Ingress affiche le point de terminaison du service.
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
les pods à `/data` par le pilote CSI GCS Fuse. La disposition de l'espace de
travail est la suivante :

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

- **Console :** Kubernetes Engine → Services et Ingress ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud Armor et les détails des
IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
sont acheminées vers Cloud Monitoring. Un test de disponibilité optionnel et des règles
d'alerte sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenClaw {#3-openclaw-application-behaviour}

- **Pas de job de configuration de base de données.** OpenClaw ne nécessite pas de Cloud
  SQL ni de job d'initialisation. L'état de l'agent réside entièrement sur GCS ; le
  premier démarrage du pod crée automatiquement les répertoires de l'espace de travail via
  `entrypoint.sh`.
- **Configuration régénérée à chaque démarrage.** `entrypoint.sh` réécrit toujours
  `openclaw.json` dans `$OPENCLAW_STATE_DIR`, garantissant que les variables
  d'environnement gérées par Terraform (clés API, jeton de passerelle, paramètres de
  canal) l'emportent sur toute valeur obsolète précédemment persistée sur GCS.
- **Synchronisation du dépôt de compétences (facultatif).** Lorsque `skills_repo_url` est
  défini, `entrypoint.sh` effectue un clone superficiel ou une mise à jour du dépôt dans
  `/data/workspace/skill-library` à chaque démarrage de pod. La synchronisation n'est pas fatale — la
  passerelle démarre même si le clone échoue. Inspectez la synchronisation sur un pod en
  cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data/workspace/skill-library
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /health` sur le port 8080. La sonde de démarrage autorise jusqu'à environ 3
  minutes (36 × 5 s) pour que npm prépare les paquets de plugins groupés avant que la
  passerelle ne soit déclarée non saine.
- **Affinité de session.** Le service Kubernetes utilise l'affinité `ClientIP` par
  défaut afin que la connexion WebSocket d'un utilisateur soit acheminée de manière
  cohérente vers le même pod lorsque plusieurs réplicas sont déployés.
- **Telegram et Slack.** Lorsque `enable_telegram` est défini, le jeton du bot est injecté
  en tant que `TELEGRAM_BOT_TOKEN`. Lorsque `enable_slack` est défini, le jeton du bot et le
  jeton au niveau de l'application sont injectés en tant que `SLACK_BOT_TOKEN` et
  `SLACK_APP_TOKEN`, et le point d'entrée connecte l'agent à Slack via le **mode Socket** :
  un WebSocket sortant qui ne nécessite pas d'ingress public ni de routeur. Slack est
  livré en tant que plugin `@openclaw/slack` séparé, que le point d'entrée installe à
  chaque démarrage. L'accès est fermé en cas d'échec : les messages directs uniquement des
  ID de membre dans `SLACK_ALLOW_FROM`, les canaux uniquement des ID dans `SLACK_CHANNELS`
  (filtrés par mention), tous deux passés via `environment_variables`. Le secret du webhook
  Telegram et le secret de signature Slack facultatif sont stockés dans Secret Manager
  pour un service de routeur compagnon et ne sont pas injectés dans le conteneur de
  l'agent.

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
| `anthropic_api_key` | _(obligatoire au premier déploiement)_ | Clé API Anthropic. Stockée dans Secret Manager et injectée en tant que `ANTHROPIC_API_KEY`. Omettre lors des mises à jour pour conserver la valeur stockée. Sensible. |
| `gateway_token` | _(auto-généré)_ | Jeton d'authentification de la passerelle. Un jeton hexadécimal sécurisé de 64 caractères est généré s'il est laissé vide. Stocké dans Secret Manager en tant que `OPENCLAW_GATEWAY_TOKEN`. Sensible. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openclaw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `OpenClaw Gateway` | Nom convivial affiché dans la Console. |
| `description` | `OpenClaw AI Gateway - Multi-tenant AI agent gateway on GKE Autopilot` | Brève description de l'objectif de l'application. |
| `application_version` | `latest` | Tag d'image OpenClaw utilisé comme argument de build `BASE_IMAGE`. Épingler à une version spécifique pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | Limites de CPU et de mémoire. Minimum 2 vCPU / 2 Gio recommandé pour les charges de travail d'agent. |
| `min_instance_count` | `1` | Nombre minimum de réplicas de pod. Garder ≥ 1 pour que les événements de webhook ne soient pas perdus lors du démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximum de réplicas de pod. OpenClaw est avec état — utiliser 1 par locataire sauf si un routage de session persistant est utilisé. |
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
| `gke_cluster_name` | `""` | Nom du cluster GKE. Découvre automatiquement le cluster géré par Services_GCP si vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Auto-généré à partir du préfixe de ressource si vide. |
| `workload_type` | `null` | `Deployment` pour les réplicas sans état basés sur GCS ; `StatefulSet` pour l'identité de pod persistante. |
| `service_type` | `LoadBalancer` | `ClusterIP` pour un accès interne uniquement ; `LoadBalancer` pour un accès externe direct. |
| `session_affinity` | `ClientIP` | Routage persistant pour la cohérence des sessions WebSocket entre les réplicas. |
| `termination_grace_period_seconds` | `60` | Période de grâce pour que les sessions d'agent actives se terminent avant la terminaison du pod. |
| `network_tags` | `[]` | Tags réseau de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer un PVC pour StatefulSet. OpenClaw utilise normalement GCS — activer uniquement lorsque les performances du disque local sont requises. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. |
| `stateful_pvc_mount_path` | `/pvc-data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID du fsGroup dans le contexte de sécurité du pod ; `0` le laisse non défini. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les nombres de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, seuil de 36 tentatives | Permet environ 3 minutes pour le démarrage de npm et le montage de GCS Fuse. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Redémarre le pod si la passerelle ne répond plus. |
| `uptime_check_config` | `{ enabled = false }` | Désactivé par défaut pour les services `ClusterIP` (non accessibles de l'extérieur). |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw n'a pas de job d'initialisation par défaut. Utiliser pour l'amorçage personnalisé de l'espace de travail. |
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
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires définis dans `storage_buckets`. Le bucket de l'espace de travail est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket d'espace de travail auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le volume `openclaw-data` à `/data` est toujours ajouté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Configuration OpenClaw {#group-15--openclaw-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `skills_repo_url` | `""` | URL GitHub d'un dépôt de compétences partagé. Cloné dans `/data/workspace/skill-library` à chaque démarrage de pod. Laisser vide pour ignorer. |
| `skills_repo_ref` | `main` | Référence Git (branche, tag ou SHA) à extraire. |
| `enable_telegram` | `false` | Provisionner un secret de jeton de bot Telegram et injecter `TELEGRAM_BOT_TOKEN`. Nécessite `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Jeton de bot Telegram de @BotFather. Sensible. |
| `telegram_webhook_secret` | `""` | Secret de validation de webhook pour le routeur (non injecté dans l'agent). Générer avec `openssl rand -hex 32`. Sensible. |
| `enable_slack` | `false` | Connecter l'agent à Slack via le mode Socket (WebSocket sortant — pas d'ingress ni de routeur). Provisionne les secrets Slack et injecte `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`. Nécessite `slack_bot_token` et `slack_app_token`. |
| `slack_bot_token` | `""` | Jeton de bot Slack (`xoxb-...`). Sensible. |
| `slack_app_token` | `""` | Jeton au niveau de l'application Slack (`xapp-...`, portée `connections:write`) pour le mode Socket. Sensible. |
| `slack_signing_secret` | `""` | Facultatif. Secret de signature Slack pour un routeur d'URL de requête HTTP uniquement (non injecté ; le mode Socket ne l'utilise pas). Sensible. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron pour la sauvegarde automatisée de l'espace de travail (UTC). |
| `backup_retention_days` | `7` | Jours de rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Importer une sauvegarde de l'espace de travail lors du déploiement. `backup_format` par défaut à `tar`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle Kubernetes avec SSL pour les noms d'hôte personnalisés. Requis pour IAP. |
| `application_domains` | `[]` | Noms d'hôte personnalisés à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant OpenClaw. Nécessite `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé. Sensible. |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` / `admin_ip_ranges` | _(défini)_ | CIDR de niveau d'accès / mode simulation / CIDR d'administrateur. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques aux étapes (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre la passerelle OpenClaw. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
| `cron_jobs` | Noms des CronJobs créés. |
| `statefulset_name` | Nom du StatefulSet (lorsque `workload_type = "StatefulSet"`). |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — un second apply est requis. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `anthropic_api_key` | Défini lors du premier déploiement | Critique | Sans clé valide, l'agent démarre mais toutes les requêtes AI échouent avec des erreurs 401. |
| Cohérence `gateway_token` | Généré automatiquement ou défini une fois | Critique | La rotation du jeton dans Secret Manager sans redémarrer les pods entraîne le rejet de toutes les requêtes client jusqu'à ce que les pods soient recyclés. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `telegram_bot_token` / `slack_bot_token` | défini lorsque l'intégration est activée | Élevé | Un jeton vide entraîne l'échec de tous les appels API ; les messages sont supprimés. |
| `telegram_webhook_secret` / `slack_signing_secret` | défini lorsque l'intégration est activée | Élevé | Une valeur vide désactive la vérification de la signature, permettant l'injection de faux webhooks. |
| `min_instance_count` | `1` | Élevé | `0` signifie que les événements webhook de Telegram/Slack sont supprimés pendant le démarrage à froid (généralement 30 à 60 s pour l'initialisation du pod GKE). |
| `skills_repo_url` | URL accessible ou vide | Élevé | Une URL inaccessible entraîne l'échec du clone git au démarrage, plaçant le pod en CrashLoopBackOff. |
| `skills_repo_ref` | référence existante | Élevé | Une branche ou une balise inexistante entraîne l'échec du clone à chaque démarrage. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les déploiements multi-réplicas répartissent l'état WebSocket entre les pods. |
| `enable_iap` | activer pour l'administration | Moyen | La passerelle est autrement accessible publiquement. Les points de terminaison webhook Telegram/Slack ne peuvent pas s'authentifier avec l'identité Google — assurez-vous qu'ils ne sont pas derrière IAP. |
| `stateful_pvc_enabled` | `false` | Moyen | OpenClaw utilise GCS. Les PVC ajoutent un disque local inutilisé et peuvent bloquer la replanification. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la conformité ; une purge accidentelle du bucket entraîne une perte permanente de l'état de l'agent. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `enable_vpc_sc` sans `organization_id` | définir explicitement | Moyen | VPC-SC est ignoré silencieusement, laissant les identifiants sans protection périmétrique. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes,
et mise en miroir des images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à OpenClaw
partagée avec la variante Cloud Run est décrite dans
**[OpenClaw_Common](OpenClaw_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : OpenClaw sur GKE Autopilot](../labs/OpenClaw_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenClaw sur Google Cloud Run](OpenClaw_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenClaw Common — Configuration d'application partagée](OpenClaw_Common.md) — la configuration partagée par les deux cibles de déploiement.
