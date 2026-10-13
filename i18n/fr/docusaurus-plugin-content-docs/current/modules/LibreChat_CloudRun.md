---
title: "LibreChat sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LibreChat sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LibreChat_CloudRun.md @ e69407af sha256:71ec201cfd61 -->

# LibreChat sur Google Cloud Run {#librechat-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LibreChat_CloudRun.png" alt="LibreChat sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LibreChat est une interface de chat IA open source avec plus de 20 000 étoiles sur GitHub qui
réplique et étend l'expérience ChatGPT à plus de 20 fournisseurs de LLM (OpenAI, Anthropic,
Google Gemini, Mistral, Groq, Ollama et bien d'autres). Ce module déploie LibreChat sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LibreChat et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité de service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, contrôles de service VPC, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte LibreChat sur RAD, et comment cela se compare {#what-librechat-costs-on-rad-and-how-that-compares}

**LibreChat sur le module Cloud Run de RAD coûte environ 46 $ US par mois dans un projet
Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).**
LibreChat est gratuit et open source, sans base de données propre dans ce module — les
conversations et les paramètres résident sur le serveur de fichiers partagé — vous ne payez
donc que pour le calcul et les fournisseurs de LLM que vous connectez, facturés séparément.
Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et
restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 46 $ US deviennent
quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **46 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **21 crédits par jour**, soit environ 630 par mois (environ 63 $ US au prix de la recharge, 50 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par
chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (chaud) | 26,28 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 46 $ US** |

### Comment cela se compare {#how-it-compares}

- **Il n'existe pas de SaaS LibreChat hébergé officiel** — c'est une interface utilisateur
  alternative à ChatGPT auto-hébergée par conception, il n'y a donc pas de prix fournisseur
  à comparer.
- **Dimensionné à 2 vCPU/2 GiB plus un serveur de fichiers partagé, un Hetzner CPX22 ou
  DigitalOcean 2 vCPU/4 Go Droplet (environ 24 $/mois)** est moins cher en espèces — mais
  vous gérez alors vous-même le stockage de fichiers, les sauvegardes et les correctifs de
  sécurité, et les appels aux fournisseurs de LLM sont facturés séparément dans tous les cas.
- Les identifiants gérés par RAD (Secret Manager) et les sauvegardes sont les plus importants
  lorsque plusieurs personnes partagent une instance LibreChat plutôt qu'une seule personne
  l'exécutant sur un ordinateur portable.
- Voir le [guide GKE](LibreChat_GKE.md) pour un déploiement qui reste disponible pour toute
  une organisation.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LibreChat s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet
et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à LibreChat
dont vous n'avez besoin qu'occasionnellement — un projet de cours, une démo, une évaluation
de courte durée — que de l'exécuter en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est
  déjà dissociée, rien n'est facturé pendant cette attente. Contrairement à la suppression
  d'un module, cela ne supprime pas les VM ou le calcul propre de LibreChat un par un —
  l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas un rebuild.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas un rebuild, et une mise à jour ne facture plus jamais les frais de module.
  Pour LibreChat derrière un petit Services_GCP et Project_GCP, cela représente **une poignée
  de crédits (moins de 1 $ US)** au total, contre les 80 crédits que coûte un redéploiement
  complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez
  et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours
  — après cela, Google le supprime définitivement. La restauration est admise comme la
  création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le
  seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des usages
  d'étude et de démonstration). Google indique que la plupart des services sont à nouveau
  entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes
  de LibreChat sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est
  **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé LibreChat et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
  projet) avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Ce module maintient Cloud Run "chaud" (au moins une instance allouée) plutôt que de se mettre
à l'échelle à zéro, de sorte qu'une partie de son coût est déjà continue. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la
fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et
de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  80 crédits (8,00 $ US), car RAD recrée le projet et les services partagés avant LibreChat.
  La suppression ne permet d'économiser de l'argent que si LibreChat devait rester inutilisé
  pendant environ six jours ou plus, à la fois dans votre propre projet (environ 1,52 $ US
  par jour) et dans un projet géré par RAD (21 crédits par jour).
- **Supprimez tout ce que LibreChat utilise.** La majeure partie du coût d'exécution est
  généralement la VM de fichier/cache partagée. Elle ne s'arrête que si rien d'autre dans le
  projet ne l'utilise, donc la suppression de LibreChat alors que quelque chose d'autre
  partage le projet n'économise que la partie calcul propre de LibreChat.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket
  à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
  sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session LibreChat pour une
  classe. Chaque participant obtient LibreChat dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places à l'avance, soit chaque participant paie la sienne. Tout
  est supprimé à la fin de la session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute LibreChat
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement
  avec le client. Si le portefeuille est faible, la facturation est suspendue et les données
  sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin de
  l'engagement, le partenaire transfère le projet, et les déploiements deviennent la propriété
  du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et l'estimation quotidienne de 21 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la
fenêtre de récupération de 30 jours et ce qu'il dit sur les objets Cloud Storage sans
suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un
chiffre.

## 1. Vue d'ensemble {#1-overview}

LibreChat s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement connecte un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | MongoDB (sidecar `mongo:7` intégré par défaut) | Cloud SQL n'est pas utilisé ; la compatibilité MongoDB de Firestore est une alternative optionnelle |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléchargements de fichiers, plus des buckets supplémentaires optionnels |
| Secrets | Secret Manager | Clés JWT, clés de chiffrement des identifiants et URI MongoDB auto-générés |
| Cache et sessions | Redis (optionnel) | Requis pour les déploiements multi-instances afin de maintenir la cohérence des sessions |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de Cloud SQL.** LibreChat utilise MongoDB. Par défaut, `mongodb_uri` pointe vers un
  **sidecar `mongo:7` intégré** (`mongodb://127.0.0.1:27017/LibreChat`), ajouté comme une entrée `additional_containers` dans le même
  service Cloud Run, avec son répertoire de données sur le volume NFS partagé (`/data/db`).
  L'API compatible MongoDB de Firestore s'authentifie mais supprime les commandes de démarrage
  de LibreChat, elle n'est donc **pas** la valeur par défaut — effacez `mongodb_uri` à `""`
  (et définissez `firestore_mongodb_host`, ou laissez les deux vides pour la découverte automatique) pour
  opter pour Firestore à la place.
- **Le sidecar MongoDB rend le service singleton.** Parce que ses données résident sur NFS à
  un seul chemin, `min_instance_count = max_instance_count = 1` par défaut. Pointez vers un MongoDB externe (Atlas, auto-hébergé
  ou Firestore) pour passer à l'échelle au-delà d'une instance.
- **La base de données Firestore n'est jamais supprimée lors de la destruction (lorsqu'elle
  est utilisée).** Si vous optez pour le provisionnement automatique de Firestore, la base de
  données est conservée pour éviter la perte de données ; supprimez-la manuellement si elle
  n'est plus nécessaire.
- **Les secrets JWT et d'identifiants sont auto-générés** lors du premier déploiement et
  stockés dans Secret Manager. La rotation de `CREDS_KEY` ou `CREDS_IV` après que les
  utilisateurs ont enregistré des identifiants de fournisseur d'IA rend tous les identifiants
  stockés indéchiffrables.
- **La mise à l'échelle à zéro est désactivée par défaut** (`min_instance_count = 1`). Les démarrages à
  froid de LibreChat peuvent prendre 15 à 30 secondes en raison de la connexion MongoDB et du
  chargement des ressources.
- **Redis est désactivé par défaut.** Activez-le pour tout déploiement avec plus d'une
  instance — sans Redis, l'état de session est isolé par instance et les utilisateurs perdent
  leurs sessions lors des événements de mise à l'échelle.
- **Le délai d'attente est de 600 secondes par défaut.** Les réponses IA de longue durée via
  le streaming SSE nécessitent un délai d'attente généreux.
- **`max_instance_count` est par défaut `1`** dans la variante Cloud Run. Le déploiement par
  défaut intègre un sidecar MongoDB dont le répertoire de données réside sur un seul volume
  NFS partagé ; plusieurs instances écrivant dans le même répertoire de données peuvent
  provoquer une corruption. Lorsque vous pointez vers un MongoDB externe, augmentez cette
  limite librement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de
ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LibreChat {#a-cloud-run--the-librechat-service}

LibreChat s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de
requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. MongoDB — la base de données LibreChat {#b-mongodb--the-librechat-database}

LibreChat stocke tout l'historique des chats, les comptes utilisateurs et la configuration
dans MongoDB. Par défaut, un conteneur officiel `mongo:7` s'exécute comme un **sidecar
intégré** dans le même service Cloud Run (`additional_containers`), accessible par le conteneur principal
à `127.0.0.1:27017`, avec son répertoire de données (`/data/db`) sur le volume NFS partagé.
Alternativement, effacez `mongodb_uri` à `""` pour opter pour une **base de données
Firestore ENTERPRISE avec compatibilité MongoDB** (auto-découverte ou créée), ou pointez
`mongodb_uri` vers MongoDB Atlas ou toute instance MongoDB auto-hébergée accessible depuis le VPC.

- **Console :** Cloud Run → le détail de la révision du service affiche le conteneur sidecar
  `mongo`. Firestore → sélectionnez la base de données (lorsque le mode Firestore est
  utilisé ; l'ID correspond à `firestore_mongodb_database`, par défaut `LibreChat`).
- **CLI :**
  ```bash
  # Inspect the sidecar and its NFS-backed data directory:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" --format=json | jq '.spec.template.spec.containers'
  # If using Firestore mode:
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Récupérez l'URI MongoDB de Secret Manager pour vérifier la connectivité :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — téléchargements de fichiers {#c-cloud-storage--file-uploads}

`LibreChat_Common` provisionne un bucket Cloud Storage **`librechat-uploads`** dédié aux téléchargements de
fichiers utilisateur partagés dans le chat (images, documents). Le compte de service de la
charge de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets → recherchez le bucket avec le suffixe `uploads`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages NFS, GCS Fuse et les options CMEK.

### D. Secret Manager — secrets d'application auto-générés {#d-secret-manager--auto-generated-application-secrets}

LibreChat nécessite plusieurs secrets cryptographiques qui sont générés automatiquement lors
du premier déploiement et ne sont jamais exposés en texte clair.

| Suffixe du secret | Variable d'environnement | Objectif |
|---|---|---|
| `creds-key` | `CREDS_KEY` | Clé AES-GCM hexadécimale de 32 octets pour les identifiants de fournisseur enregistrés |
| `creds-iv` | `CREDS_IV` | IV AES-GCM hexadécimal de 16 octets — associé à `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Signe les jetons d'accès utilisateur |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Signe les jetons d'actualisation de longue durée |
| `mongo-uri` | `MONGO_URI` | Chaîne de connexion MongoDB |

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cache Redis (optionnel) {#e-redis-cache-optional}

Redis prend en charge la gestion des sessions de LibreChat et la mise en file d'attente des
messages en temps réel. Il est requis lorsque plus d'une instance est en cours d'exécution —
sans lui, chaque instance a un état de session en mémoire isolé et les utilisateurs perdent
leurs sessions lors des événements de mise à l'échelle.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les
paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées
à Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte
optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LibreChat {#3-librechat-application-behaviour}

- **Pas de job de migration de base de données.** LibreChat migre automatiquement son schéma
  MongoDB au premier démarrage ; aucun job d'initialisation séparé n'est nécessaire.
- **Sidecar MongoDB intégré par défaut.** `mongodb_uri` est par défaut `mongodb://127.0.0.1:27017/LibreChat`, pointant
  vers un conteneur officiel `mongo:7` ajouté comme entrée `additional_containers` dans le même
  service Cloud Run ; son répertoire de données réside sur le volume NFS partagé, c'est
  pourquoi le service est par défaut un singleton `min = max = 1`.
- **Provisionnement automatique de Firestore (optionnel).** Définissez `mongodb_uri = ""` pour
  l'activer : lorsque `mongodb_uri` est vide et qu'aucun `firestore_mongodb_host` n'est défini, le module
  découvre ou crée une base de données Firestore ENTERPRISE avec compatibilité MongoDB. Un
  utilisateur SCRAM est provisionné automatiquement. La base de données n'est jamais détruite
  avec le module.
- **Clés API du fournisseur d'IA.** LibreChat se connecte aux API des fournisseurs d'IA
  (OpenAI, Anthropic, etc.) au moment de la requête. Injectez les clés du fournisseur via
  `secret_environment_variables`, qui fait référence aux secrets Secret Manager préexistants. Ne passez pas
  les clés comme de simples `environment_variables` — elles apparaîtraient dans les métadonnées de
  révision de Cloud Run et les logs d'audit GCP.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/`
  (la racine de LibreChat), qui renvoie HTTP 200 une fois l'application entièrement
  initialisée et connectée à MongoDB. La sonde de démarrage a un seuil d'échec généreux pour
  permettre l'établissement de la connexion MongoDB au premier démarrage.
- **Continuité SSE et WebSocket.** LibreChat utilise les événements envoyés par le serveur
  (SSE) pour le streaming des réponses IA. Assurez-vous que `timeout_seconds` est suffisamment élevé
  (600 s par défaut) pour éviter de tronquer les longues réponses IA en cours de flux.
- **Enregistrement des utilisateurs.** L'auto-enregistrement est activé par défaut. Définissez
  `allow_registration = false` après avoir créé le compte administrateur initial pour empêcher les
  inscriptions non autorisées sur les déploiements publics.
- **Variables d'environnement injectées automatiquement.** Les suivantes sont toujours
  définies par le module et n'ont pas besoin d'être fournies manuellement :

  | Variable | Valeur | Objectif |
  |---|---|---|
  | `HOST` | `0.0.0.0` | Liaison sur toutes les interfaces à l'intérieur du conteneur |
  | `NODE_ENV` | `production` | Optimisations de production |
  | `TRUST_PROXY` | `1` | Express lit `X-Forwarded-For` correctement derrière l'entrée Cloud Run |
  | `APP_TITLE` | `var.app_title` | Titre de l'en-tête de l'interface utilisateur |
  | `DOMAIN_CLIENT` / `DOMAIN_SERVER` | URL du service | URI de redirection OAuth et liens e-mail |
  | `ALLOW_REGISTRATION` | `var.allow_registration` | Indicateur d'auto-enregistrement |

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour LibreChat sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `firestore_mongodb_host` | `""` | Hôte du point de terminaison MongoDB de Firestore (remplacement manuel). Laissez vide pour la découverte automatique. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `librechat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LibreChat AI Chat` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image LibreChat — **épingler à une version spécifique en production**. |
| `mongodb_uri` | `mongodb://127.0.0.1:27017/LibreChat` | URI de connexion MongoDB (sensible). Par défaut, le sidecar `mongo:7` intégré. Définissez sur `""` pour utiliser le provisionnement automatique de Firestore, ou fournissez un URI MongoDB/Atlas externe. |
| `app_title` | `LibreChat` | Titre affiché dans l'en-tête de l'interface utilisateur LibreChat et l'onglet du navigateur. |
| `allow_registration` | `true` | Autoriser les nouveaux utilisateurs à s'auto-enregistrer. **Définissez `false` après la création du compte administrateur initial.** |
| `allow_social_login` | `false` | Activer les fournisseurs de connexion sociale OAuth. Nécessite la configuration de l'application OAuth dans `librechat.yaml`. |
| `allow_social_registration` | `null` | Autoriser la création de compte via la connexion sociale. Par défaut, la valeur de `allow_social_login`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | `prebuilt` (GHCR) ou `custom` (Cloud Build). |
| `container_image` | `ghcr.io/danny-avila/librechat` | URI de l'image du conteneur. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par instance ; 2 vCPU / 2 GiB minimum. |
| `container_port` | `3080` | Port HTTP natif de LibreChat. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `600` | Durée maximale de la requête ; augmentez pour les backends LLM lents ou les longues réponses IA. |
| `min_instance_count` | `1` | Instances minimales. Gardez ≥ 1 pour éviter les démarrages à froid et les flux SSE interrompus. |
| `max_instance_count` | `1` | Instances maximales. **Gardez à `1` lorsque vous utilisez le sidecar MongoDB intégré.** |
| `enable_cloudsql_volume` | `false` | **Doit rester `false`.** LibreChat n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image GHCR vers Artifact Registry — évite les limites de débit. |
| `traffic_split` | `[]` | Allocation de trafic canary / bleu-vert entre les révisions. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` — internet public ; `internal` — VPC uniquement ; `internal-and-cloud-load-balancing` — via HTTPS LB. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables LibreChat principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. **Utilisez ceci pour les clés API du fournisseur d'IA.** |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde NFS automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Instance NFS {#group-9--nfs-instance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. Nécessite `enable_cloud_armor = true`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS supplémentaires. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket de téléchargements auto-provisionné. |
| `enable_nfs` | `true` | Volume Filestore partagé ; **requis par le sidecar MongoDB intégré** (stocke `/data/db`). Désactiver uniquement lors de l'utilisation d'un MongoDB externe. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Base de données / MongoDB {#group-12--database--mongodb}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixe — ne pas modifier.** LibreChat n'utilise pas Cloud SQL. |
| `firestore_mongodb_database` | `LibreChat` | ID de la base de données Firestore / nom de la base de données MongoDB. |
| `firestore_mongodb_username` | `""` | Nom d'utilisateur SCRAM pour l'authentification Firestore. |
| `firestore_mongodb_password` | `""` | Mot de passe SCRAM (sensible). Auto-généré s'il n'est pas défini. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide — LibreChat migre automatiquement MongoDB au démarrage. Ajoutez des tâches de configuration personnalisées si nécessaire. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler (nettoyage des données, réchauffement du cache, etc.). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `{ path="/", initial_delay_seconds=30, failure_threshold=10 }` | Sonde HTTP permettant le temps de connexion MongoDB et de chargement des ressources. |
| `liveness_probe` / `health_check_config` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Sonde de vivacité ciblant le chemin racine de LibreChat. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la gestion des sessions. **Requis pour les déploiements multi-instances.** |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket de téléchargements). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration qui ont été exécutés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CREDS_KEY` / `CREDS_IV` (auto-généré) | défini une fois | Critique | Clés AES-GCM pour les identifiants de fournisseur d'IA enregistrés. La rotation après que les utilisateurs ont enregistré des clés détruit tous les identifiants stockés — chaque utilisateur doit ressaisir ses clés API. |
| `mongodb_uri` | laisser par défaut (sidecar) ou définir explicitement | Critique | LibreChat nécessite MongoDB. Le sidecar `mongo:7` intégré par défaut a besoin de NFS activé pour son répertoire de données ; effacer `mongodb_uri` à `""` avec une configuration Firestore/Atlas cassée fait planter le conteneur au démarrage et ne sert aucun trafic. |
| `enable_cloudsql_volume` | `false` | Critique | Doit rester `false`. L'activation injecte un sidecar Cloud SQL Auth Proxy inutile. |
| `database_type` | `NONE` | Critique | La définition sur un moteur SQL provisionne une instance Cloud SQL inutilisée à un coût supplémentaire. |
| `secret_environment_variables` (clés IA) | utiliser des secrets | Critique | Les clés de fournisseur d'IA passées comme de simples `environment_variables` sont visibles dans les métadonnées de révision de Cloud Run et les logs d'audit GCP. Utilisez toujours les références Secret Manager. |
| `allow_registration` | `false` après la configuration | Élevé | L'enregistrement ouvert sur un déploiement public permet à quiconque de créer un compte. Désactivez après la création de l'administrateur ou restreignez avec IAP. |
| `enable_redis` | `true` pour multi-instance | Élevé | Sans Redis, chaque instance a un état de session en mémoire isolé ; les utilisateurs perdent leurs sessions lors des événements de mise à l'échelle. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true`. S'il est vide, LibreChat ne peut pas se connecter à Redis. |
| `max_instance_count` | `1` avec MongoDB intégré | Élevé | Plusieurs instances écrivant dans le même répertoire de données MongoDB basé sur NFS peuvent corrompre la base de données. N'augmentez que lors de l'utilisation d'un MongoDB externe. |
| `enable_nfs` | `true` avec MongoDB intégré | Élevé | Le sidecar MongoDB intégré stocke son répertoire de données (`/data/db`) sur NFS. La désactivation de NFS supprime le stockage durable et les données MongoDB sont perdues au redémarrage. |
| `timeout_seconds` | `600` | Élevé | Le streaming SSE pour les longues réponses IA peut dépasser plusieurs minutes. Un délai d'attente insuffisant tronque les réponses en cours de flux. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro interrompt tous les flux SSE en cours et provoque une latence de démarrage à froid au réveil. |
| `JWT_SECRET` (auto-généré) | défini une fois | Élevé | La rotation invalide toutes les sessions actives simultanément. Planifiez la rotation pendant une fenêtre de maintenance. |
| `application_version` | version épinglée | Moyen | `latest` peut introduire des modifications de schéma MongoDB ou des incompatibilités d'API lors de mises à niveau non planifiées. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | LibreChat est autrement directement accessible depuis l'internet public avec seulement la connexion au niveau de l'application pour le protéger. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS ne sont pas pris en charge en gen1. Utilisez toujours gen2 pour les déploiements compatibles NFS. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à LibreChat
partagée avec la variante GKE est décrite dans **[LibreChat_Common](LibreChat_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : LibreChat sur Cloud Run](../labs/LibreChat_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LibreChat sur GKE Autopilot](LibreChat_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [LibreChat Common — Configuration d'application partagée](LibreChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
