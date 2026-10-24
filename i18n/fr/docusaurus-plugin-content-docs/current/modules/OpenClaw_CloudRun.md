---
title: "OpenClaw sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'OpenClaw sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenClaw_CloudRun.md @ 1665a43e sha256:521674725421 -->

# OpenClaw sur Google Cloud Run {#openclaw-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenClaw_CloudRun.png" alt="OpenClaw sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenClaw est une passerelle d'agent IA multi-tenant conçue spécifiquement pour des
déploiements d'agents isolés et persistants. Elle permet aux équipes d'exécuter des
assistants IA par tenant, basés sur des modèles Anthropic, avec des espaces de travail
GCS dédiés et une intégration optionnelle aux canaux Telegram ou Slack — le tout sans
état partagé entre les agents. Ce module déploie OpenClaw sur **Cloud Run v2** sur la
base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'OpenClaw utilise et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application Cloud Run — identité de service,
ingestion et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte OpenClaw sur RAD, et comment cela se compare {#what-openclaw-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'OpenClaw sur RAD coûte environ 69 US$ par mois, les frais de module étant facturés une seule fois en crédits RAD.** Si vous avez besoin qu'OpenClaw reste actif en permanence, qu'il s'adapte à plusieurs pods ou qu'il fonctionne avec d'autres charges de travail Kubernetes, consultez le [guide GKE](OpenClaw_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **OpenClaw**, qui est open source, il n'y a donc pas de frais de licence par
utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (8 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **69 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 par mois (environ 78 US$ au prix de la recharge, 62 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel.
Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 69 US$** |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour OpenClaw lui-même**, la comparaison
  honnête est donc un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ
  24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute
  Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et plus petite
  que les boîtes de référence ci-dessous ferait également l'affaire ; les chiffres sont
  présentés pour une comparaison équivalente.
- OpenClaw est une passerelle d'agent IA multi-tenant sur mesure sans équivalent SaaS
  prêt à l'emploi à comparer. L'alternative réaliste est de construire vous-même la même
  isolation par tenant (espaces de travail séparés, secrets, intégrations de canaux) sur
  un VPS ou un Kubernetes géré, ce qui représente un effort d'ingénierie
  matériellement plus important que le déploiement en un clic de RAD, en plus de
  nécessiter votre propre PostgreSQL géré.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui
  patchez le système d'exploitation, faites tourner les sauvegardes et maintenez la base
  de données (le cas échéant) en bonne santé. Cloud SQL, Secret Manager et la
  surveillance gérés par RAD s'en chargent pour vous, ce qui est le véritable argument
  en faveur de RAD par rapport à une boîte moins chère — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenClaw s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du
projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux
à un OpenClaw dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation,
un projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à
  la suppression d'un module, cela ne détruit pas la base de données ou la ressource de
  calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête
  simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours,
  le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le
  projet et de rattacher son compte de facturation, puis vous demande d'exécuter
  **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a
  été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
  facture plus jamais les frais de module. Cela coûte environ une poignée de crédits
  (moins de 1 US$) au total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 69 US$.**
  Déployez OpenClaw, utilisez-le un certain temps, supprimez le projet. Restaurez-le la
  prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à
  nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les
  builds, et le temps pendant lequel OpenClaw était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que
  RAD gère uniquement pour la facturation), et vous le restaurez vous-même dans les 30
  jours — après cela, Google le supprime définitivement. La restauration est admise
  comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours
  dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la
  plupart des utilisations d'étude et de démo). Google indique que la plupart des
  services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
  restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas**
  protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé OpenClaw et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors
  du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 80 crédits (8 US$) dans votre propre projet, ou 72 crédits dans un projet
  géré par RAD. La suppression permet d'économiser de l'argent une fois qu'OpenClaw
  serait autrement inutilisé pendant environ 3 jours ou plus dans votre propre projet
  (environ 2,29 US$ par jour), ou environ 3 jours ou plus dans un projet géré par RAD
  (26 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute
  VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le
  projet ne les utilise, donc la suppression d'OpenClaw alors que quelque chose d'autre
  partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
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
  pause et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez
chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

OpenClaw s'exécute comme un conteneur Node.js sur Cloud Run v2 (Gen2). Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 (Gen2) | Service Node.js, 1 vCPU / 1 GiB par défaut, CPU toujours alloué |
| Stockage de l'espace de travail | Cloud Storage (GCS Fuse) | Bucket d'espace de travail par tenant monté à `/data` via GCS Fuse |
| Identifiants IA | Secret Manager | Clé API Anthropic et jeton de passerelle toujours stockés ; secrets Telegram et Slack optionnels |
| Ingestion | URL Cloud Run / Équilibrage de charge Cloud | Public (`all`) par défaut ; LB HTTPS externe + domaine personnalisé optionnel |
| Secrets | Secret Manager | Tous les identifiants injectés à l'exécution ; texte en clair jamais dans la configuration |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** OpenClaw est une passerelle Node.js avec état
  entièrement supportée par GCS Fuse à `/data`. Cloud SQL et Redis ne sont jamais
  provisionnés.
- **Le CPU est toujours alloué.** `cpu_always_allocated = true` est requis. Les connexions WebSocket et les
  opérations d'agent asynchrones échouent en cas de limitation du CPU. Ne pas définir
  sur `false`.
- **L'environnement d'exécution Gen2 est requis.** Les montages de volume GCS Fuse ne
  sont pas disponibles en Gen1 et échoueront silencieusement.
- **L'image de conteneur personnalisée est toujours construite.** Le module superpose un
  `entrypoint.sh` à l'image `ghcr.io/openclaw/openclaw` en amont.
- **L'espace de travail GCS à `/data` est toujours monté.** Un bucket `<prefix>-storage` dédié
  est toujours provisionné et monté. L'état persistant de l'agent y réside lors des
  redémarrages de conteneur.
- **`OPENCLAW_STATE_DIR` est sur le disque local.** La mise en scène npm et le répertoire de
  configuration XDG sont redirigés vers `/tmp/openclaw` pour éviter les limitations de liens
  physiques de GCS Fuse au démarrage.
- **`min_instance_count = 0` par défaut (mise à l'échelle à zéro).** Définir sur `1` pour les
  déploiements d'agents sensibles à la latence afin d'éviter des démarrages à froid de
  15 à 20 s.
- **`max_instance_count = 1` par tenant.** OpenClaw est avec état ; plusieurs instances pour le même
  tenant divisent l'état entre les réplicas à moins qu'un routage persistant ne soit en
  place.
- **L'ingestion par défaut est `all` (accès public direct).** Définir `ingress_settings = "internal"`
  pour restreindre le service au trafic VPC lorsque vous le placez derrière un routeur
  OpenClaw.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenClaw {#a-cloud-run--the-openclaw-service}

OpenClaw s'exécute comme un service Cloud Run v2 sur l'environnement d'exécution Gen2.
Le CPU est toujours alloué pour prendre en charge les connexions WebSocket et les
opérations d'agent asynchrones. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — espace de travail GCS Fuse {#b-cloud-storage--gcs-fuse-workspace}

Tout l'état durable de l'agent est stocké dans un bucket Cloud Storage dédié et monté
dans le service à `/data` par GCS Fuse. La disposition de l'espace de travail est la
suivante :

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
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage GCS Fuse, les options CMEK et
le cycle de vie du bucket.

### C. Secret Manager — identifiants {#c-secret-manager--credentials}

La clé API Anthropic et le jeton de passerelle sont toujours stockés dans Secret
Manager. Lorsque l'intégration Telegram ou Slack est activée, les jetons de bot et les
secrets de webhook/signature y sont également stockés. Tous les identifiants sont
injectés dans le service à l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the Anthropic key (initial deploy only; manage via Secret Manager thereafter):
  gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"
  # Retrieve the gateway token (needed to register clients):
  gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingestion {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, ouvert au trafic Internet
public (`ingress_settings = "all"`). Définissez `ingress_settings = "internal"` pour le restreindre au trafic VPC
lorsque vous le placez derrière un routeur OpenClaw. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques
d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenClaw {#3-openclaw-application-behaviour}

- **Pas de job de configuration de base de données.** OpenClaw ne nécessite pas de Cloud
  SQL et pas de job d'initialisation. L'état de l'agent réside entièrement sur GCS ; le
  premier démarrage du conteneur crée automatiquement les répertoires de l'espace de
  travail via `entrypoint.sh`.
- **Configuration régénérée à chaque démarrage.** `entrypoint.sh` réécrit toujours `openclaw.json`
  dans `$OPENCLAW_STATE_DIR`, garantissant que les variables d'environnement gérées par Terraform
  (clés API, jeton de passerelle, paramètres de canal) l'emportent sur toute valeur
  obsolète précédemment persistée sur GCS.
- **Synchronisation du dépôt de compétences (optionnel).** Lorsque `skills_repo_url` est défini,
  `entrypoint.sh` effectue un clone ou une mise à jour superficielle du dépôt dans `/data/workspace/skill-library`
  à chaque démarrage du conteneur. La synchronisation n'est pas fatale — la passerelle
  démarre même si le clone échoue. Vérifiez les entrées `skill-library` dans Cloud Logging
  pour vérifier l'état de la synchronisation.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `GET /health`
  sur le port 8080. La sonde de démarrage alloue environ 2 minutes pour le montage GCS
  Fuse et le démarrage de Node.js.
- **Telegram et Slack.** Lorsque `enable_telegram` est défini, le jeton du bot est injecté en
  tant que `TELEGRAM_BOT_TOKEN`. Lorsque `enable_slack` est défini, le jeton du bot et le jeton au
  niveau de l'application sont injectés en tant que `SLACK_BOT_TOKEN` et `SLACK_APP_TOKEN`, et le
  point d'entrée connecte l'agent à Slack via le **mode Socket** : un WebSocket sortant
  qui ne nécessite pas d'ingestion publique ni de routeur. Slack est livré en tant que
  plugin `@openclaw/slack` séparé, que le point d'entrée installe à chaque démarrage. L'accès
  est fermé par défaut : les messages directs uniquement des ID de membre dans `SLACK_ALLOW_FROM`,
  les canaux uniquement des ID dans `SLACK_CHANNELS` (avec mention), tous deux passés via
  `environment_variables`. Le secret du webhook Telegram et le secret de signature Slack optionnel
  sont stockés dans Secret Manager pour un service de routeur compagnon et ne sont pas
  injectés dans le conteneur de l'agent.
- **Mise à l'échelle à zéro et démarrages à froid.** Avec `min_instance_count = 0`, les événements
  webhook Telegram/Slack arrivant pendant un démarrage à froid (15-20 s) peuvent être
  perdus. Définissez `min_instance_count = 1` pour les déploiements d'agents en production.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour OpenClaw sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `anthropic_api_key` | _(requis lors du premier déploiement)_ | Clé API Anthropic. Stockée dans Secret Manager et injectée en tant que `ANTHROPIC_API_KEY`. Omettre lors des mises à jour pour conserver la valeur stockée. Sensible. |
| `gateway_token` | _(généré automatiquement)_ | Jeton d'authentification de la passerelle. Un jeton hexadécimal sécurisé de 64 caractères est généré s'il est laissé vide. Stocké dans Secret Manager en tant que `OPENCLAW_GATEWAY_TOKEN`. Sensible. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openclaw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `OpenClaw Gateway` | Nom convivial affiché dans la console. |
| `description` | `OpenClaw AI Gateway - Serverless multi-tenant AI agent gateway on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag d'image OpenClaw utilisé comme argument de build `BASE_IMAGE`. Épingler à une version spécifique pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. Dimensionné pour une utilisation légère/typique (pic observé ~400Mi) ; augmenter à `2Gi` pour des sessions d'agent concurrentes plus lourdes. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro (démarrage à froid de 15 à 20 s). Définir ≥ `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Maintenir à `1` par tenant pour éviter l'état partagé. Augmenter uniquement avec le routage persistant. |
| `container_port` | `8080` | Port sur lequel la passerelle OpenClaw écoute. Doit correspondre à la variable d'environnement `PORT`. |
| `execution_environment` | `gen2` | Gen2 **requis** pour GCS Fuse. Ne pas changer en `gen1`. |
| `cpu_always_allocated` | `true` | Requis pour les connexions WebSocket et les opérations asynchrones. Ne pas définir sur `false`. |
| `timeout_seconds` | `3600` | Durée maximale de la requête. Les sessions d'agent sont de longue durée ; 3600 s est le maximum. |
| `enable_cloudsql_volume` | `false` | OpenClaw n'utilise pas Cloud SQL. Laisser `false`. |
| `traffic_split` | `[]` | Allocation de trafic Canary/blue-green. Toutes les entrées doivent totaliser 100. |
| `max_revisions_to_retain` | `7` | Anciennes révisions à conserver après chaque déploiement. |

### Groupe 5 — Accès et contrôle d'ingestion {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal` pour VPC uniquement (recommandé derrière un routeur) ; `all` pour un accès public direct. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routage de sortie VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables gérées par le module (`OPENCLAW_STATE_DIR`, `NODE_ENV`, etc.) ont toujours la priorité. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager existant. Les identifiants principaux sont gérés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation (30 jours). |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron pour la sauvegarde automatisée de l'espace de travail (UTC). |
| `backup_retention_days` | `7` | Jours de rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_format` | options de restauration | Importer une sauvegarde de l'espace de travail lors du déploiement. `backup_format` par défaut à `tar`. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires définis dans `storage_buckets`. Le bucket de l'espace de travail est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket d'espace de travail auto-provisionné. |
| `enable_nfs` | `false` | OpenClaw utilise GCS Fuse pour l'état. NFS n'est pas requis et est désactivé par défaut. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le volume `openclaw-data` à `/data` est toujours ajouté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw n'a pas de job d'initialisation par défaut. Utiliser pour l'amorçage personnalisé de l'espace de travail. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, seuil de 24 tentatives | Alloue environ 2 minutes pour le montage GCS Fuse et le démarrage de Node.js. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Redémarre le conteneur si la passerelle ne répond plus. |
| `uptime_check_config` | `{ enabled = false, path = "/health" }` | Vérification de la disponibilité de Cloud Monitoring. Désactivé par défaut ; activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 15 — Configuration OpenClaw {#group-15--openclaw-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `skills_repo_url` | `""` | URL GitHub d'un dépôt de compétences partagé. Cloné dans `/data/workspace/skill-library` à chaque démarrage de conteneur. Laisser vide pour ignorer. |
| `skills_repo_ref` | `main` | Référence Git (branche, tag ou SHA) à extraire. |
| `enable_telegram` | `false` | Provisionner un secret de jeton de bot Telegram et injecter `TELEGRAM_BOT_TOKEN`. Nécessite `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Jeton de bot Telegram de @BotFather. Sensible. |
| `telegram_webhook_secret` | `""` | Secret de validation de webhook pour le routeur (non injecté dans l'agent). Générer avec `openssl rand -hex 32`. Sensible. |
| `enable_slack` | `false` | Connecter l'agent à Slack via le mode Socket (WebSocket sortant — pas d'ingestion ni de routeur). Provisionne les secrets Slack et injecte `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`. Nécessite `slack_bot_token` et `slack_app_token`. |
| `slack_bot_token` | `""` | Jeton de bot Slack (`xoxb-...`). Sensible. |
| `slack_app_token` | `""` | Jeton au niveau de l'application Slack (`xapp-...`, portée `connections:write`) pour le mode Socket. Sensible. |
| `slack_signing_secret` | `""` | Optionnel. Secret de signature Slack pour un routeur d'URL de requête HTTP uniquement (non injecté ; le mode Socket ne l'utilise pas). Sensible. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `anthropic_api_key` | Définir lors du premier déploiement | Critique | Sans clé valide, l'agent démarre mais toutes les requêtes IA échouent avec des erreurs 401. |
| Cohérence `gateway_token` | Généré automatiquement ou défini une fois | Critique | La rotation du jeton dans Secret Manager sans redéployer le service entraîne le rejet de toutes les requêtes client jusqu'à ce que le service soit redéployé. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne prend pas en charge GCS Fuse ; le montage de l'espace de travail échoue silencieusement. |
| `cpu_always_allocated` | `true` | Élevé | La limitation du CPU interrompt les connexions WebSocket et les opérations d'agent asynchrones. |
| `telegram_bot_token` / `slack_bot_token` | défini lorsque l'intégration est activée | Élevé | Un jeton vide entraîne l'échec de tous les appels API ; les messages sont perdus. |
| `telegram_webhook_secret` / `slack_signing_secret` | défini lorsque l'intégration est activée | Élevé | Une valeur vide désactive la vérification de la signature, permettant l'injection de faux webhooks. |
| `min_instance_count` | `1` pour les agents de production | Élevé | `0` signifie que les événements webhook de Telegram/Slack sont perdus pendant le démarrage à froid (15-20 s). |
| `skills_repo_url` | URL accessible ou vide | Élevé | Une URL inaccessible entraîne l'échec du clone git au démarrage, redémarrant le conteneur. |
| `skills_repo_ref` | référence existante | Élevé | Une branche ou un tag inexistant entraîne l'échec du clone à chaque démarrage. |
| `max_instance_count` | `1` par tenant | Élevé | Plusieurs instances pour le même tenant divisent l'état de l'agent entre les réplicas. |
| `enable_iap` | activer pour l'administration | Moyen | La passerelle est autrement accessible à son URL `run.app`. Les points de terminaison webhook Telegram/Slack ne peuvent pas s'authentifier avec l'identité Google — assurez-vous qu'ils ne sont pas derrière IAP. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la conformité ; une purge accidentelle du bucket entraîne une perte permanente de l'état de l'agent. |
| `enable_vpc_sc` sans `organization_id` | défini explicitement | Moyen | VPC-SC est silencieusement ignoré, laissant les identifiants sans protection périmétrique. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise
à l'échelle et concurrence, ingestion et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
OpenClaw partagée avec la variante GKE est décrite dans
**[OpenClaw_Common](OpenClaw_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : OpenClaw sur Cloud Run](../labs/OpenClaw_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenClaw sur GKE Autopilot](OpenClaw_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [OpenClaw Common — Configuration d'application partagée](OpenClaw_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md), [Hermes Agent sur Google Cloud Run](Hermes_CloudRun.md) dans la solution **AI Agent Workspace**.
