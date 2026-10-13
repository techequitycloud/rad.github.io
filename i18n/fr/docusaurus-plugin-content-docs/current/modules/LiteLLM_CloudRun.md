---
title: "LiteLLM sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LiteLLM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LiteLLM_CloudRun.md @ e69407af sha256:a35fd658319b -->
# LiteLLM sur Google Cloud Run {#litellm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LiteLLM_CloudRun.png" alt="LiteLLM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LiteLLM est un proxy LLM open source et une passerelle IA qui fournit une API
unifiée compatible OpenAI pour plus de 100 fournisseurs, y compris OpenAI,
Anthropic, Google Gemini, Azure OpenAI, AWS Bedrock et Ollama. Les
organisations l'utilisent pour centraliser le suivi des dépenses IA, gérer les
clés API virtuelles, appliquer des limites de débit et obtenir une visibilité
complète sur l'utilisation des modèles. Ce module déploie LiteLLM sur **Cloud
Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LiteLLM et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide
de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte LiteLLM sur RAD, et comment cela se compare {#what-litellm-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de LiteLLM sur RAD coûte environ 77 $ US par mois dans votre propre projet, sans facturation par requête.** RAD facture 75 crédits une fois par déploiement dans votre propre projet (67,5 crédits, 10 % de moins, dans un projet géré par RAD), plus le temps de build. LiteLLM se déploie également sur GKE Autopilot pour environ 129 $ US par mois — consultez le [guide GKE](LiteLLM_GKE.md) si vous avez besoin qu'il y soit exécuté à la place. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **77 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **34 crédits par jour**, soit environ 1 020 par mois (environ 102,00 $ US au prix de la recharge, moins sur un plan) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (chaud) | 20 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 77 $ US** |

### Comment cela se compare {#how-it-compares}

- **Portkey**, une passerelle LLM hébergée offrant un ensemble de
  fonctionnalités similaires d'API unifiée et de suivi des coûts, coûte
  **49 $ US par mois sur son plan Production**, couvrant 100 000 requêtes
  enregistrées par mois, avec une utilisation au-delà facturée par tranches de
  9 $ US par 100 000 requêtes.
- Le module LiteLLM de RAD coûte environ 77 $ US par mois dans votre propre
  projet — plus que Portkey à faible volume, mais il n'y a pas de facturation
  par requête, et chaque invite, réponse et clé API du fournisseur reste dans
  l'infrastructure que vous contrôlez plutôt que de passer par la passerelle
  d'un tiers.
- Comparaison autogérée : son service Cloud Run de 1 vCPU / 2 Gio est proche
  d'un Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois) ou d'un droplet DigitalOcean 2
  vCPU/4 Go (24 $/mois) — mais vous exécutez alors PostgreSQL, les correctifs
  de sécurité et la disponibilité de la passerelle vous-même ; Cloud SQL,
  Secret Manager et la surveillance gérés par RAD couvrent cela.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LiteLLM s'exécute dans **un projet que RAD gère pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à LiteLLM dont vous n'avez besoin qu'occasionnellement
— évaluation, environnement de démonstration, charge de travail saisonnière ou
intermittente — que de l'exécuter en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie
  d'abord sa facturation, puis demande à Google de supprimer le projet. Google
  ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà dissociée, rien n'est facturé pendant
  qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas
  la base de données, aucune VM ou la ressource de calcul une par une —
  l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette
  mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais
  les frais de module à nouveau. Pour LiteLLM derrière Services_GCP (une base
  de données Postgres) et Project_GCP, cela représente environ **une poignée de
  crédits (moins de 1 $ US)** au total, contre environ 80 crédits (8,00 $ US)
  que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 77 $ US.** Déployez LiteLLM, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez
  terminé. Vous ne payez que les frais de module une fois, les builds, et le
  temps réel où il était actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas seulement un
  projet dont RAD gère la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
  qui convient à la plupart des utilisations d'évaluation). Google indique que
  la plupart des services fonctionnent à nouveau pleinement dans les 36 heures
  suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé LiteLLM et que vous
  souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou
  un bucket en dehors du projet) avant de la supprimer. Pour une installation
  par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 80 crédits (8,00 $ US) au total. La suppression ne permet
  d'économiser de l'argent que si LiteLLM reste inutilisé assez longtemps pour
  compenser ce coût de redéploiement par rapport à son propre coût
  d'exécution — environ **4 jours ou plus**, à la fois dans votre propre
  projet (environ 2,56 $ US par jour) et dans un projet géré par RAD (34
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  LiteLLM, il s'agit de la base de données. Ils ne s'arrêtent que si rien
  d'autre dans le projet ne les utilise, donc la suppression de cette
  application alors que quelque chose d'autre partage le projet n'économise que
  la partie calcul de cette application.
- **Conservez vos données d'abord.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de la supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [Portkey](https://portkey.ai/pricing).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LiteLLM s'exécute en tant que conteneur proxy basé sur Python sur Cloud Run v2.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service proxy Python, 1 vCPU / 2 Gio par défaut, facturation basée sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — l'ORM Prisma de LiteLLM utilise PostgreSQL pour les clés virtuelles et le suivi des dépenses |
| Stockage d'objets | Cloud Storage | Facultatif — aucun bucket créé par défaut |
| Cache | Redis | Facultatif — réduit la latence et le coût des requêtes LLM identiques répétées |
| Secrets | Secret Manager | Clé principale et clé de sel auto-générées ; clés API du fournisseur LLM injectées au moment de l'exécution |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app`, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma de LiteLLM nécessite
  PostgreSQL pour la gestion des clés virtuelles et le suivi des dépenses ;
  changer le moteur empêche le démarrage.
- **Une image de conteneur personnalisée est construite par Cloud Build.**
  L'image intègre un `entrypoint.sh` qui assemble `DATABASE_URL` à partir des
  variables d'environnement `DB_*` injectées par la fondation au moment
  de l'exécution.
- **`LITELLM_MASTER_KEY` et `LITELLM_SALT_KEY` sont auto-générées** et stockées dans
  Secret Manager. La clé de sel ne doit jamais être renouvelée après l'émission
  de clés virtuelles — toutes les clés virtuelles existantes deviendraient
  définitivement invalides.
- **`STORE_MODEL_IN_DB = "true"` est défini automatiquement**, permettant la gestion des
  modèles d'exécution et l'interface utilisateur d'administration sans
  redémarrage des conteneurs.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements
  multi-instances afin de partager les compteurs de limites de débit et les
  caches de réponses.
- **La sonde de démarrage cible `/health/readiness`**, qui valide la
  connectivité de la base de données et confirme que les migrations Prisma sont
  terminées avant que le service ne soit marqué comme prêt.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms des services et des ressources sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LiteLLM {#a-cloud-run--the-litellm-service}

LiteLLM s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LiteLLM stocke toutes les clés virtuelles, les journaux d'utilisation, les
enregistrements de coûts et les règles de routage des modèles dans une instance
Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le
**proxy d'authentification Cloud SQL** sur un socket Unix (pas d'IP publique).
Lors du premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket de stockage n'est créé par défaut. Les buckets peuvent être
déclarés via `storage_buckets` et montés via GCS Fuse en utilisant `gcs_volumes` —
par exemple, pour livrer un `config.yaml` au conteneur sans reconstruire
l'image.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache des réponses facultative de LiteLLM et
les compteurs de limites de débit partagés. Lorsque `enable_redis = true`, les
variables d'environnement `REDIS_HOST`, `REDIS_PORT` et (facultativement)
`REDIS_PASSWORD` sont injectées automatiquement dans le service.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

`LITELLM_MASTER_KEY` (la clé API d'administration principale, préfixée `sk-`)
et `LITELLM_SALT_KEY` (utilisée pour hacher les clés virtuelles) sont générées
automatiquement et stockées dans Secret Manager. Les clés API du fournisseur
LLM sont injectées en référençant des secrets préexistants via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent
la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LiteLLM {#3-litellm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur LiteLLM avant le
  démarrage du service. Il est idempotent et se connecte à Cloud SQL via le
  socket Unix du proxy d'authentification.
- **Migrations Prisma au démarrage.** LiteLLM exécute ses migrations ORM
  Prisma à chaque démarrage d'instance, de sorte que la mise à niveau de la
  version applique automatiquement les modifications de schéma. La sonde de
  démarrage attend que `/health/readiness` renvoie 200, confirmant que les
  migrations sont terminées avant de router le trafic vers le service.
- **Interface utilisateur d'administration.** L'interface utilisateur
  d'administration de LiteLLM est disponible à l'adresse `/ui` sur
  l'URL du service. Authentifiez-vous avec la `LITELLM_MASTER_KEY` (récupérez-la
  depuis Secret Manager). Depuis l'interface utilisateur, vous pouvez ajouter
  des modèles, créer des clés virtuelles, définir des budgets et afficher des
  tableaux de bord d'utilisation — le tout sans redéployer le service.
- **Ajout de clés de fournisseur LLM.** Les clés API du fournisseur ne sont
  pas gérées par ce module. Fournissez-les au moment du déploiement via
  `secret_environment_variables` (mappant chaque variable d'environnement à un secret
  Secret Manager préexistant), ou ajoutez-les après le déploiement via
  l'interface utilisateur d'administration ou le point de terminaison API
  `/model/new` en utilisant la clé principale.
- **Gestion des clés virtuelles.** Utilisez l'API `/key/generate` avec la
  clé principale pour émettre des clés virtuelles par équipe ou par utilisateur
  avec des limites de débit et des budgets de dépenses. Ces clés sont stockées
  dans PostgreSQL et salées avec `LITELLM_SALT_KEY`.

  ```bash
  # Retrieve the master key then create a virtual key:
  MASTER_KEY=$(gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT")
  curl -X POST "https://<service-url>/key/generate" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d '{"key_alias": "team-a", "max_budget": 10.0}'
  ```
- **IAP et appels API programmatiques.** IAP (`enable_iap = true`) nécessite un
  flux OAuth de navigateur et bloque les appels API LLM directs. N'utilisez IAP
  que si vous restreignez l'accès à l'interface utilisateur d'administration ;
  pour une utilisation de passerelle API, préférez `ingress_settings =
  "internal"` avec VPN ou
  authentification mutuelle.
- **Points de terminaison de santé.** `/health/readiness` valide la
  connectivité de la base de données et l'achèvement des migrations Prisma ;
  `/health/liveliness` confirme que le processus proxy est en cours
  d'exécution. Ceux-ci sont utilisés respectivement comme sondes de démarrage et
  de vivacité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
LiteLLM sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `litellm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `LiteLLM AI Gateway` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `main-stable` | Tag de version de l'image LiteLLM ; épingler à une version spécifique pour la stabilité en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; ne pas réduire en dessous de 2 Gio — LiteLLM plante par manque de mémoire au démarrage en dessous de cette valeur. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut — LiteLLM est un proxy sans état sans travail de fond en cours. |
| `min_instance_count` | `1` | Doit rester ≥ 1. Les jobs planifiés de LiteLLM (y compris la réinitialisation du budget) ne s'exécutent que tant qu'une instance est active ; à 0, ils s'arrêtent lorsque Cloud Run réduit le service. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `container_port` | `4000` | Port natif de LiteLLM. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run ; la génération 2 est requise pour NFS et la sortie VPC directe. |
| `timeout_seconds` | `600` | Durée maximale de la requête ; augmenter pour les appels d'inférence LLM de longue durée (max 3600). |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions de socket Unix. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service ; définissez sur `internal` pour une utilisation de passerelle API uniquement VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy (bloque les appels API directs). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Paramètres supplémentaires non secrets. Les variables LiteLLM principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utilisez pour injecter les clés API du fournisseur LLM. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket créé par défaut. |
| `enable_nfs` | `false` | NFS n'est pas requis pour LiteLLM ; activer uniquement pour la livraison de fichiers de configuration partagés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse pour la livraison de fichiers de configuration. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier ; LiteLLM nécessite PostgreSQL 15. |
| `db_name` | `litellm_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `litellm_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré de LiteLLM_Common. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents pour les tâches de maintenance ou de nettoyage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | Sonde HTTP ; valide la connectivité de la base de données et les migrations Prisma avant de marquer le service comme prêt. |
| `liveness_probe` | `/health/liveliness` | Sonde HTTP ; confirme que le processus proxy est en cours d'exécution. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring contre `/health/liveliness` ; activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la mise en cache des réponses et les compteurs de limites de débit partagés. |
| `redis_host` | `""` | Point de terminaison Redis ; requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
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
| `database_type` | `POSTGRES_15` | Critique | LiteLLM nécessite PostgreSQL ; changer le moteur casse l'ORM Prisma et empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy est requis pour la connectivité de la base de données ; le désactiver entraîne l'échec de Prisma au démarrage. |
| `LITELLM_SALT_KEY` | auto-généré, jamais renouvelé | Critique | La rotation de la clé de sel invalide toutes les clés virtuelles précédemment émises ; tous les consommateurs d'API perdent l'accès immédiatement. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les clés virtuelles et les données de dépenses. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `ingress_settings` | restreindre pour la production | Critique | `"all"` expose publiquement le point de terminaison de la clé principale ; utilisez `"internal"` pour les déploiements de passerelle API uniquement VPC. |
| `LITELLM_MASTER_KEY` | auto-généré | Élevé | Traiter comme une information d'identification ; sa rotation rompt toutes les intégrations existantes détenant la clé jusqu'à ce qu'elles soient mises à jour. |
| `enable_redis` | `true` pour multi-instance | Élevé | Sans Redis, les compteurs de limites de débit sont par instance et non partagés ; les quotas ne sont pas appliqués sur les réplicas. |
| `redis_host` | défini lorsque Redis est activé | Élevé | Un hôte vide avec `enable_redis = true` provoque des erreurs de connexion à chaque requête. |
| `min_instance_count` | `1` | Élevé | À `0`, les réinitialisations de budget et les autres jobs planifiés de LiteLLM s'arrêtent lorsque l'instance est récupérée ; les démarrages à froid ajoutent également une latence de 20 à 40 s pour les services dépendants. |
| `timeout_seconds` | `600` | Élevé | L'inférence de grands modèles linguistiques peut prendre des minutes ; un délai d'attente trop court provoque des erreurs 504 sur les modèles lents. |
| `enable_iap` | `false` pour les points de terminaison API | Élevé | IAP bloque tous les appels API programmatiques directs ; n'utilisez IAP que si vous accédez exclusivement à l'interface utilisateur d'administration. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS et la sortie VPC directe sont uniquement de génération 2 ; la rétrogradation rompt le réseau. |
| `application_version` | épingler pour la production | Moyen | LiteLLM publie fréquemment ; les versions non épinglées peuvent modifier le schéma Prisma ou casser les formats de clés virtuelles. |
| `NUM_WORKERS` | `1` (augmenter pour le débit) | Moyen | Un seul worker sérialise toutes les requêtes ; augmenter à 2-4 et mettre à l'échelle `cpu_limit` proportionnellement pour les passerelles à fort trafic. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_auto_password_rotation` | `false` sauf si prêt | Moyen | L'activation sans `rotation_propagation_delay_sec` adéquat peut provoquer une condition de concurrence où le service redémarre avant que le nouveau mot de passe ne se propage. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à LiteLLM partagée avec la variante GKE est décrite
dans **[LiteLLM_Common](LiteLLM_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : LiteLLM sur Cloud Run](../labs/LiteLLM_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LiteLLM sur GKE Autopilot](LiteLLM_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [LiteLLM Common — Configuration d'application partagée](LiteLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md), [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) dans la solution **Assistant IA privé**.
